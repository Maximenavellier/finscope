from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.portfolio import (
    WatchlistItemCreate,
    WatchlistItemEnriched,
    WatchlistItemUpdate,
    WatchlistResponse,
)
from app.services.market_data import normalize_ticker
from app.services.portfolio_service import portfolio_service

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


@router.get("", response_model=WatchlistResponse)
def get_watchlist(
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    return portfolio_service.get_watchlist(db, refresh=refresh)


@router.post(
    "",
    response_model=WatchlistItemEnriched,
    status_code=status.HTTP_201_CREATED,
)
def upsert_watchlist_item(
    body: WatchlistItemCreate,
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.upsert_watchlist_item(db, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{item_id}", response_model=WatchlistItemEnriched)
def update_watchlist_item(
    item_id: int,
    body: WatchlistItemUpdate,
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.update_watchlist_item(db, item_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/by-ticker/{ticker}")
def delete_watchlist_by_ticker(
    ticker: str,
    db: Session = Depends(get_db),
):
    sym = normalize_ticker(ticker)
    try:
        portfolio_service.delete_watchlist_by_ticker(db, sym)
        return {"deleted": True, "ticker": sym}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{item_id}")
def delete_watchlist_item(
    item_id: int,
    db: Session = Depends(get_db),
):
    try:
        portfolio_service.delete_watchlist_item(db, item_id)
        return {"deleted": True, "id": item_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
