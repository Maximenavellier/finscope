from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal, get_db, init_db
from app.routers import portfolio, screener, search, stocks, system, watchlist
from app.schemas.market import HealthResponse
from app.services.market_data import seed_assets_metadata


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with SessionLocal() as db:
        seed_assets_metadata(db)
    yield


app = FastAPI(
    title="FinScope API",
    version="0.1.0",
    description="Personal fundamental analysis and investment decision platform backend.",
    lifespan=lifespan,
)


@app.middleware("http")
async def optional_pin_middleware(request: Request, call_next):
    settings = get_settings()
    if (
        settings.APP_PIN
        and request.method != "OPTIONS"
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
    ):
        provided_pin = request.headers.get("X-App-Pin", "")
        if provided_pin != settings.APP_PIN:
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing X-App-Pin"})
    return await call_next(request)


# Register CORSMiddleware after optional_pin_middleware so CORS wraps all responses including 401
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(stocks.router)
app.include_router(portfolio.router)
app.include_router(watchlist.router)
app.include_router(screener.router)
app.include_router(system.router)


@app.get("/api/health", tags=["system"])
def api_health_check():
    """Ultra-lightweight healthcheck for Render & UptimeRobot (exempt from APP_PIN)."""
    return {"status": "ok"}


@app.get("/api/auth/verify", tags=["system"])
def verify_pin():
    """Validate X-App-Pin header when APP_PIN is configured."""
    return {"authenticated": True}


@app.get("/health", response_model=HealthResponse, tags=["system"])
def health_check(db: Session = Depends(get_db)):
    current_settings = get_settings()
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "db": db_status,
        "finnhub_configured": bool(current_settings.FINNHUB_API_KEY),
        "fmp_configured": bool(current_settings.FMP_API_KEY),
        "pin_enabled": bool(current_settings.APP_PIN),
    }
