from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def normalize_database_url(url: str) -> str:
    """Normalize Postgres URLs (Supabase/Render) for psycopg v3 and enforce SSL on remote hosts."""
    trimmed = url.strip()
    if trimmed.startswith("postgres://"):
        trimmed = "postgresql+psycopg://" + trimmed[len("postgres://"):]
    elif trimmed.startswith("postgresql://") and not trimmed.startswith("postgresql+"):
        trimmed = "postgresql+psycopg://" + trimmed[len("postgresql://"):]

    if trimmed.startswith("postgresql+psycopg://"):
        parsed = urlsplit(trimmed)
        host = (parsed.hostname or "").lower()
        is_local = host in {"", "localhost", "127.0.0.1", "::1"}
        query_params = parse_qsl(parsed.query, keep_blank_values=True)
        has_sslmode = any(k.lower() == "sslmode" for k, _ in query_params)
        if not is_local and not has_sslmode:
            query_params.append(("sslmode", "require"))
            trimmed = urlunsplit(
                (parsed.scheme, parsed.netloc, parsed.path, urlencode(query_params), parsed.fragment)
            )
    return trimmed


class Base(DeclarativeBase):
    pass


def create_db_engine(database_url: str | None = None):
    settings = get_settings()
    raw_url = database_url or settings.DATABASE_URL
    normalized_url = normalize_database_url(raw_url)
    kwargs: dict = {"pool_pre_ping": True}
    if normalized_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 15}
    elif normalized_url.startswith("postgresql"):
        # Disable server-side prepared statements for Supabase/PgBouncer Transaction Poolers
        kwargs["connect_args"] = {"prepare_threshold": None}
        kwargs["pool_recycle"] = 300
    return create_engine(normalized_url, **kwargs)


engine = create_db_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Ensure all ORM models are registered on Base.metadata before create_all
    from app.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Safe additive migrations for existing SQLite / PostgreSQL deployments
    inspector = inspect(engine)
    if "portfolio_positions" in inspector.get_table_names():
        existing_cols = {col["name"] for col in inspector.get_columns("portfolio_positions")}
        with engine.begin() as conn:
            if "purchase_date" not in existing_cols:
                conn.execute(text("ALTER TABLE portfolio_positions ADD COLUMN purchase_date VARCHAR(16)"))
            if "asset_type_override" not in existing_cols:
                conn.execute(text("ALTER TABLE portfolio_positions ADD COLUMN asset_type_override VARCHAR(16)"))
