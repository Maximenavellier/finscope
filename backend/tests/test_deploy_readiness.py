from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect

from app.config import Settings, get_settings
from app.db.database import Base, create_db_engine, normalize_database_url
from app.main import app


def test_normalize_database_url_for_supabase_and_sqlite():
    assert normalize_database_url("sqlite:///./finscope.db") == "sqlite:///./finscope.db"

    pooler_url = "postgres://postgres.abc:secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres"
    assert (
        normalize_database_url(pooler_url)
        == "postgresql+psycopg://postgres.abc:secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?sslmode=require"
    )

    direct_url = "postgresql://postgres:secret@db.xyz.supabase.co:5432/postgres"
    assert (
        normalize_database_url(direct_url)
        == "postgresql+psycopg://postgres:secret@db.xyz.supabase.co:5432/postgres?sslmode=require"
    )

    local_pg = "postgresql://postgres:secret@localhost:5432/finscope"
    assert normalize_database_url(local_pg) == "postgresql+psycopg://postgres:secret@localhost:5432/finscope"

    explicit_ssl = "postgresql://postgres:secret@db.xyz.supabase.co:5432/postgres?sslmode=verify-full"
    assert (
        normalize_database_url(explicit_ssl)
        == "postgresql+psycopg://postgres:secret@db.xyz.supabase.co:5432/postgres?sslmode=verify-full"
    )


def test_create_db_engine_postgres_and_sqlite():
    pg_engine = create_db_engine("postgres://user:pass@aws-0-eu-west-3.pooler.supabase.com:6543/postgres")
    assert pg_engine.dialect.name == "postgresql"
    assert pg_engine.dialect.driver == "psycopg"
    pg_engine.dispose()

    sq_engine = create_db_engine("sqlite:///:memory:")
    assert sq_engine.dialect.name == "sqlite"
    sq_engine.dispose()


def test_init_db_metadata_tables_complete():
    from app.db import models  # noqa: F401

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    tables = set(inspect(engine).get_table_names())
    expected = {
        "assets",
        "market_cache",
        "portfolio_positions",
        "portfolio_sales",
        "portfolio_lots",
        "watchlist_items",
        "peer_overrides",
        "user_settings",
    }
    assert expected.issubset(tables)
    engine.dispose()


def test_cors_origins_merges_frontend_url():
    s = Settings(
        CORS_ORIGINS="http://localhost:3000, http://127.0.0.1:3000/",
        FRONTEND_URL="https://finscope-prod.vercel.app/, http://localhost:3000",
    )
    assert s.cors_origins_list == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://finscope-prod.vercel.app",
    ]


def test_api_health_exempt_and_pin_verify(monkeypatch):
    monkeypatch.setenv("APP_PIN", "9876")
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            health_res = client.get("/api/health")
            assert health_res.status_code == 200
            assert health_res.json() == {"status": "ok"}

            missing_pin = client.get("/api/auth/verify")
            assert missing_pin.status_code == 401

            wrong_pin = client.get("/api/auth/verify", headers={"X-App-Pin": "0000"})
            assert wrong_pin.status_code == 401

            ok_pin = client.get("/api/auth/verify", headers={"X-App-Pin": "9876"})
            assert ok_pin.status_code == 200
            assert ok_pin.json() == {"authenticated": True}
    finally:
        monkeypatch.delenv("APP_PIN", raising=False)
        get_settings.cache_clear()


def test_api_verify_allows_empty_pin(monkeypatch):
    monkeypatch.setenv("APP_PIN", "")
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            res = client.get("/api/auth/verify")
            assert res.status_code == 200
            assert res.json() == {"authenticated": True}
    finally:
        get_settings.cache_clear()
