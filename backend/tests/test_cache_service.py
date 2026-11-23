from datetime import timedelta

from app.db.models import MarketCache
from app.services.cache_service import CacheService
from app.utils.math_utils import utc_now


def test_cache_set_get_and_overwrite(db_session):
    svc = CacheService()
    assert svc.get(db_session, "quote:NVDA") is None

    svc.set(db_session, "quote:NVDA", "quote", {"price": 120.5, "bad": float("nan")})
    hit = svc.get(db_session, "quote:NVDA")
    assert hit is not None
    assert hit.is_stale is False
    assert hit.payload == {"price": 120.5, "bad": None}

    # Overwrite existing key
    svc.set(db_session, "quote:NVDA", "quote", {"price": 135.0})
    hit2 = svc.get(db_session, "quote:NVDA")
    assert hit2 is not None
    assert hit2.payload == {"price": 135.0}


def test_cache_expiry_and_allow_stale(db_session):
    svc = CacheService()
    svc.set(db_session, "quote:AAPL", "quote", {"price": 200.0}, ttl_seconds=60)

    row = db_session.get(MarketCache, "quote:AAPL")
    assert row is not None
    row.expires_at = utc_now() - timedelta(minutes=5)
    db_session.commit()

    assert svc.get(db_session, "quote:AAPL", allow_stale=False) is None
    stale = svc.get(db_session, "quote:AAPL", allow_stale=True)
    assert stale is not None
    assert stale.is_stale is True
    assert stale.payload == {"price": 200.0}


def test_cache_invalidate_prefix(db_session):
    svc = CacheService()
    svc.set(db_session, "prices:NVDA:MAX", "prices", {"ok": 1})
    svc.set(db_session, "quote:NVDA", "quote", {"ok": 2})
    svc.set(db_session, "quote:MSFT", "quote", {"ok": 3})

    deleted = svc.invalidate(db_session, "quote:NVDA")
    assert deleted == 1
    assert svc.get(db_session, "quote:NVDA") is None
    assert svc.get(db_session, "quote:MSFT") is not None
    assert svc.get(db_session, "prices:NVDA:MAX") is not None
