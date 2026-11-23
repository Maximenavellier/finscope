from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import models  # noqa: F401
from app.db.database import Base, get_db
from app.main import app
from app.services.market_data import seed_assets_metadata


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    seed_assets_metadata(db)
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    get_settings.cache_clear()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def isolate_external_apis(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.market_data.fetch_sec_financials", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.market_data.MarketDataService._fmp_get", lambda self, *args, **kwargs: None)
    monkeypatch.setattr("app.services.market_data.MarketDataService._finnhub_get", lambda self, *args, **kwargs: None)
