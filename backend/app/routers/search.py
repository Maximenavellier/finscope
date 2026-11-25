from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.market import FxRateResponse, SearchResponse
from app.services.market_data import market_data_service

router = APIRouter(prefix="/api", tags=["search-fx"])


@router.get("/fx/eurusd", response_model=FxRateResponse)
def get_eurusd(
    refresh: bool = Query(False),
    force: bool = Query(False),
    db: Session = Depends(get_db),
):
    return market_data_service.get_eurusd_rate(db, refresh=(refresh or force))


@router.get("/fx/rate", response_model=FxRateResponse)
def get_fx_rate(
    from_currency: str = Query(..., alias="from", min_length=2, max_length=8),
    to_currency: str = Query("EUR", alias="to", min_length=2, max_length=8),
    refresh: bool = Query(False),
    force: bool = Query(False),
    db: Session = Depends(get_db),
):
    return market_data_service.get_fx_rate(
        db, from_currency, to_currency, refresh=(refresh or force)
    )


@router.get("/search", response_model=SearchResponse)
def search_assets(
    q: str = Query("", max_length=80),
    limit: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    results = market_data_service.search_assets(db, q, limit=limit)
    return {"query": q, "results": results}
