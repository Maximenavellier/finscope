import logging
import threading
from datetime import datetime, timedelta
from typing import Any, Optional

import httpx
import yfinance as yf
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_db
from app.db.models import MarketCache
from app.schemas.market import SystemStatusResponse
from app.services.cache_service import cache_service
from app.services.market_data import market_data_service
from app.services.sec_edgar import SEC_HEADERS
from app.utils.math_utils import utc_now

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/system", tags=["system"])

_status_lock = threading.Lock()
_cached_status: Optional[tuple[datetime, dict[str, Any]]] = None
_STATUS_TTL = timedelta(minutes=60)


def _probe_providers() -> list[dict[str, Any]]:
    settings = get_settings()
    providers: list[dict[str, Any]] = []

    # 1. Yahoo Finance
    try:
        tk = yf.Ticker("EURUSD=X")
        px = getattr(tk.fast_info, "last_price", None)
        providers.append(
            {
                "id": "yfinance",
                "name": "Yahoo Finance",
                "status": "ok" if px else "error",
                "detail": "Cours & fondamentaux actifs" if px else "Réponse vide",
            }
        )
    except Exception as exc:
        providers.append(
            {
                "id": "yfinance",
                "name": "Yahoo Finance",
                "status": "error",
                "detail": str(exc)[:80],
            }
        )

    # 2. SEC EDGAR
    try:
        with httpx.Client(timeout=5.0, headers=SEC_HEADERS) as client:
            r = client.get("https://www.sec.gov/files/company_tickers.json")
            if r.status_code == 200:
                providers.append(
                    {
                        "id": "sec_edgar",
                        "name": "SEC EDGAR (US)",
                        "status": "ok",
                        "detail": "Historique 16-20 trimestres US actif",
                    }
                )
            else:
                providers.append(
                    {
                        "id": "sec_edgar",
                        "name": "SEC EDGAR (US)",
                        "status": "error",
                        "detail": f"HTTP {r.status_code}",
                    }
                )
    except Exception:
        providers.append(
            {
                "id": "sec_edgar",
                "name": "SEC EDGAR (US)",
                "status": "error",
                "detail": "Inaccessible",
            }
        )

    # 3. Finnhub
    if not settings.FINNHUB_API_KEY:
        providers.append(
            {
                "id": "finnhub",
                "name": "Finnhub",
                "status": "missing",
                "detail": "Clé non configurée (fallback yfinance actif)",
            }
        )
    else:
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(
                    "https://finnhub.io/api/v1/stock/profile2",
                    params={"symbol": "AAPL", "token": settings.FINNHUB_API_KEY},
                )
                if r.status_code == 200:
                    data = r.json()
                    ok = isinstance(data, dict) and bool(data.get("ticker"))
                    providers.append(
                        {
                            "id": "finnhub",
                            "name": "Finnhub",
                            "status": "ok" if ok else "error",
                            "detail": "Clé valide (peers, logos, consensus)"
                            if ok
                            else "Clé invalide ou réponse vide",
                        }
                    )
                elif r.status_code in {401, 403, 429}:
                    providers.append(
                        {
                            "id": "finnhub",
                            "name": "Finnhub",
                            "status": "error",
                            "detail": f"Erreur clé/quota (HTTP {r.status_code})",
                        }
                    )
                else:
                    providers.append(
                        {
                            "id": "finnhub",
                            "name": "Finnhub",
                            "status": "error",
                            "detail": f"HTTP {r.status_code}",
                        }
                    )
        except Exception:
            providers.append(
                {
                    "id": "finnhub",
                    "name": "Finnhub",
                    "status": "error",
                    "detail": "Erreur réseau",
                }
            )

    # 4. Financial Modeling Prep (FMP)
    if not settings.FMP_API_KEY:
        providers.append(
            {
                "id": "fmp",
                "name": "FMP",
                "status": "missing",
                "detail": "Clé non configurée (fallback yfinance/SEC actif)",
            }
        )
    elif market_data_service.is_fmp_rate_limited():
        rem_min = market_data_service.fmp_rate_limit_remaining_minutes()
        providers.append(
            {
                "id": "fmp",
                "name": "FMP",
                "status": "error",
                "detail": f"Quota atteint (HTTP 429) — pause {rem_min} min (fallback yfinance/SEC actif)",
            }
        )
    else:
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(
                    "https://financialmodelingprep.com/stable/analyst-estimates",
                    params={
                        "symbol": "AAPL",
                        "period": "annual",
                        "limit": 1,
                        "apikey": settings.FMP_API_KEY,
                    },
                )
                if r.status_code == 200:
                    data = r.json()
                    ok = isinstance(data, list) and len(data) > 0
                    providers.append(
                        {
                            "id": "fmp",
                            "name": "FMP",
                            "status": "ok" if ok else "error",
                            "detail": "Clé valide (prévisions, surprises CA/BPA, segments)"
                            if ok
                            else "Réponse vide",
                        }
                    )
                elif r.status_code == 429:
                    market_data_service.mark_fmp_rate_limited(hours=2.0)
                    providers.append(
                        {
                            "id": "fmp",
                            "name": "FMP",
                            "status": "error",
                            "detail": "Quota atteint (HTTP 429) — pause 2h (fallback yfinance/SEC actif)",
                        }
                    )
                elif r.status_code in {401, 402, 403}:
                    providers.append(
                        {
                            "id": "fmp",
                            "name": "FMP",
                            "status": "error",
                            "detail": f"Quota ou endpoint restreint (HTTP {r.status_code})",
                        }
                    )
                else:
                    providers.append(
                        {
                            "id": "fmp",
                            "name": "FMP",
                            "status": "error",
                            "detail": f"HTTP {r.status_code}",
                        }
                    )
        except Exception:
            providers.append(
                {
                    "id": "fmp",
                    "name": "FMP",
                    "status": "error",
                    "detail": "Erreur réseau",
                }
            )

    return providers


@router.get("/status", response_model=SystemStatusResponse)
def get_system_status(
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    global _cached_status
    now = utc_now()
    cache_entries = db.query(MarketCache).count()

    with _status_lock:
        if not refresh and _cached_status is not None:
            cached_at, cached_payload = _cached_status
            if now - cached_at < _STATUS_TTL:
                return {**cached_payload, "cache_entries_count": cache_entries}

    providers = _probe_providers()
    payload = {
        "providers": providers,
        "cache_entries_count": cache_entries,
        "checked_at": now.isoformat(),
    }
    with _status_lock:
        _cached_status = (now, payload)
    return payload


@router.post("/cache/clear")
def clear_system_cache(
    prefix: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    global _cached_status
    q = db.query(MarketCache)
    if prefix and prefix.strip():
        q = q.filter(MarketCache.cache_key.startswith(prefix.strip()))
    deleted = q.delete(synchronize_session=False)
    db.commit()
    cache_service.clear_memory(db, prefix)
    with _status_lock:
        _cached_status = None
    market_data_service.reset_fmp_rate_limit()
    return {"cleared": int(deleted or 0)}
