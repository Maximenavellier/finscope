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


def test_l1_memory_cache_avoids_db_queries_and_isolates_binds(db_session, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.db.database import Base

    svc = CacheService()
    svc.set(db_session, "quote:NVDA", "quote", {"price": 150.0})

    # L1 hit must NOT invoke db_session.get(MarketCache, ...)
    def _fail_db_get(*args, **kwargs):
        raise AssertionError("DB should not be queried on L1 cache hit")

    monkeypatch.setattr(db_session, "get", _fail_db_get)
    l1_hit = svc.get(db_session, "quote:NVDA")
    assert l1_hit is not None
    assert l1_hit.payload == {"price": 150.0}

    # Separate SQLite engine/bind must be isolated in L1
    engine2 = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine2)
    Session2 = sessionmaker(autocommit=False, autoflush=False, bind=engine2)
    with Session2() as db2:
        assert svc.get(db2, "quote:NVDA") is None
        svc.set(db2, "quote:NVDA", "quote", {"price": 999.0})
        assert svc.get(db2, "quote:NVDA").payload == {"price": 999.0}
    Base.metadata.drop_all(bind=engine2)
    engine2.dispose()

    # Original bind retains its own cached payload, and clear_memory evicts L1
    assert svc.get(db_session, "quote:NVDA").payload == {"price": 150.0}
    evicted = svc.clear_memory(db_session, "quote:")
    assert evicted >= 1
    # After clear_memory, db_session.get is needed again (raises AssertionError from our mock)
    try:
        svc.get(db_session, "quote:NVDA")
        raise AssertionError("Expected DB lookup after clear_memory")
    except AssertionError as exc:
        assert "DB should not be queried" in str(exc)
