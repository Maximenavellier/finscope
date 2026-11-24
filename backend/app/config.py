from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./finscope.db"
    FINNHUB_API_KEY: str = ""
    FMP_API_KEY: str = ""
    APP_PIN: str = ""
    FRONTEND_URL: str = ""
    CORS_ORIGINS: str = "http://localhost:3000"
    CACHE_TTL_QUOTE_MINUTES: int = 30
    CACHE_TTL_FUNDAMENTALS_HOURS: int = 24
    PEER_FETCH_CONCURRENCY: int = 3

    @property
    def cors_origins_list(self) -> list[str]:
        raw_sources = [self.CORS_ORIGINS, self.FRONTEND_URL]
        origins: list[str] = []
        for source in raw_sources:
            for item in source.split(","):
                cleaned = item.strip().rstrip("/")
                if cleaned and cleaned not in origins:
                    origins.append(cleaned)
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
