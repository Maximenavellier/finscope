import threading
import weakref
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import MarketCache
from app.utils.math_utils import ensure_utc, sanitize_for_json, utc_now

_sqlite_write_lock = threading.RLock()
_active_cache_services: weakref.WeakSet["CacheService"] = weakref.WeakSet()


def _is_sqlite_session(db: Session) -> bool:
    try:
        bind = db.get_bind()
        return getattr(getattr(bind, "dialect", None), "name", "") == "sqlite"
    except Exception:
        return False


@dataclass
class CacheEntry:
    payload: Any
    updated_at: datetime
    is_stale: bool
    age_seconds: int


class CacheService:
    """Two-tier cache: bounded L1 in-memory LRU + DB-backed multi-TTL JSON L2."""

    MAX_L1_ENTRIES = 512
    QUOTE_CATEGORIES = {"quote", "fx"}
    LONG_LIVED_CATEGORIES = {"fundamentals", "segments", "surprises"}
    FUNDAMENTAL_CATEGORIES = {
        "fundamentals",
        "surprises",
        "segments",
        "peers",
        "peers_list",
        "prices",
        "overview",
    }

    def __init__(self) -> None:
        self._l1_lock = threading.RLock()
        self._l1: OrderedDict[tuple[int, str], tuple[Any, datetime, datetime]] = OrderedDict()
        _active_cache_services.add(self)

    @staticmethod
    def _bind_id(db: Session) -> int:
        try:
            bind = db.get_bind()
            return id(getattr(bind, "engine", bind))
        except Exception:
            return 0

    def _put_l1(self, bind_id: int, key: str, payload: Any, updated_at: datetime, expires_at: datetime) -> None:
        comp_key = (bind_id, key)
        with self._l1_lock:
            self._l1[comp_key] = (payload, updated_at, expires_at)
            self._l1.move_to_end(comp_key)
            while len(self._l1) > self.MAX_L1_ENTRIES:
                self._l1.popitem(last=False)

    def _evict_l1_key(self, bind_id: int, key: str) -> None:
        with self._l1_lock:
            self._l1.pop((bind_id, key), None)

    def clear_memory(self, db: Optional[Session] = None, prefix: Optional[str] = None) -> int:
        bind_id = self._bind_id(db) if db is not None else None
        cleaned_prefix = prefix.strip() if prefix and prefix.strip() else None
        removed = 0
        with self._l1_lock:
            keys_to_drop = [
                k
                for k in list(self._l1.keys())
                if (bind_id is None or k[0] == bind_id)
                and (cleaned_prefix is None or k[1].startswith(cleaned_prefix))
            ]
            for k in keys_to_drop:
                self._l1.pop(k, None)
                removed += 1
        return removed

    def ttl_for_category(self, category: str) -> int:
        settings = get_settings()
        if category in self.QUOTE_CATEGORIES:
            return max(60, settings.CACHE_TTL_QUOTE_MINUTES * 60)
        if category in self.LONG_LIVED_CATEGORIES:
            return max(7 * 86400, settings.CACHE_TTL_FUNDAMENTALS_HOURS * 3600)
        return max(300, settings.CACHE_TTL_FUNDAMENTALS_HOURS * 3600)

    def get(self, db: Session, key: str, allow_stale: bool = False) -> Optional[CacheEntry]:
        now = utc_now()
        bind_id = self._bind_id(db)
        comp_key = (bind_id, key)

        with self._l1_lock:
            l1_hit = self._l1.get(comp_key)
            if l1_hit is not None:
                self._l1.move_to_end(comp_key)

        if l1_hit is not None:
            payload, updated_at, expires_at = l1_hit
            is_stale = now >= expires_at
            if is_stale and not allow_stale:
                return None
            age_seconds = max(0, int((now - updated_at).total_seconds()))
            return CacheEntry(
                payload=payload,
                updated_at=updated_at,
                is_stale=is_stale,
                age_seconds=age_seconds,
            )

        row = db.get(MarketCache, key)
        if row is None:
            return None

        updated_at = ensure_utc(row.updated_at) or now
        expires_at = ensure_utc(row.expires_at) or now
        self._put_l1(bind_id, key, row.payload, updated_at, expires_at)

        is_stale = now >= expires_at
        if is_stale and not allow_stale:
            return None

        age_seconds = max(0, int((now - updated_at).total_seconds()))
        return CacheEntry(
            payload=row.payload,
            updated_at=updated_at,
            is_stale=is_stale,
            age_seconds=age_seconds,
        )

    def set(
        self,
        db: Session,
        key: str,
        category: str,
        payload: Any,
        ttl_seconds: Optional[int] = None,
    ) -> datetime:
        sanitized = sanitize_for_json(payload)
        now = utc_now()
        ttl = ttl_seconds if ttl_seconds is not None else self.ttl_for_category(category)
        expires_at = now + timedelta(seconds=max(1, ttl))

        if _is_sqlite_session(db):
            with _sqlite_write_lock:
                self._write_cache_row(db, key, category, sanitized, now, expires_at)
        else:
            self._write_cache_row(db, key, category, sanitized, now, expires_at)

        self._put_l1(self._bind_id(db), key, sanitized, now, expires_at)
        return now

    @staticmethod
    def _write_cache_row(
        db: Session,
        key: str,
        category: str,
        sanitized: Any,
        now: datetime,
        expires_at: datetime,
    ) -> None:
        row = db.get(MarketCache, key)
        if row is None:
            row = MarketCache(
                cache_key=key,
                category=category,
                payload=sanitized,
                updated_at=now,
                expires_at=expires_at,
            )
            db.add(row)
        else:
            row.category = category
            row.payload = sanitized
            row.updated_at = now
            row.expires_at = expires_at

        db.commit()

    def invalidate(self, db: Session, prefix: str) -> int:
        if _is_sqlite_session(db):
            with _sqlite_write_lock:
                count = (
                    db.query(MarketCache)
                    .filter(MarketCache.cache_key.startswith(prefix))
                    .delete(synchronize_session=False)
                )
                db.commit()
        else:
            count = (
                db.query(MarketCache)
                .filter(MarketCache.cache_key.startswith(prefix))
                .delete(synchronize_session=False)
            )
            db.commit()
        self.clear_memory(db, prefix)
        return int(count or 0)


@event.listens_for(MarketCache, "after_update")
@event.listens_for(MarketCache, "after_delete")
def _evict_l1_on_direct_orm_change(_mapper: Any, connection: Any, target: MarketCache) -> None:
    bind_id = id(getattr(connection, "engine", connection))
    key = getattr(target, "cache_key", None)
    if not key:
        return
    for svc in list(_active_cache_services):
        svc._evict_l1_key(bind_id, key)


cache_service = CacheService()
