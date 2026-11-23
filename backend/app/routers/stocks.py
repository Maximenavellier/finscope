from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.market import (
    AnalystsResponse,
    FundamentalsResponse,
    PriceHistoryResponse,
    SegmentsResponse,
    StockInfoResponse,
    SurprisesResponse,
)
from app.schemas.scoring import (
    FairValueRequest,
    FairValueResponse,
    PeerOverrideRequest,
    PeerOverridesResponse,
    PeersComparisonResponse,
    StockOverviewResponse,
)
from app.services.cache_service import cache_service
from app.services.market_data import market_data_service, normalize_ticker
from app.services.peers_service import peers_service, update_peer_override
from app.services.scoring_engine import (
    get_cached_sector_averages,
    persist_asset_scores,
    score_equity,
    score_etf,
)
from app.services.decision_engine import detect_red_flags
from app.services.valuation_engine import calculate_fair_value, compute_default_fair_value

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


def _with_per_share_fields(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for rec in records:
        item = dict(rec)
        shares = item.get("shares_outstanding")
        if shares and shares > 0:
            if item.get("cash") is not None and item.get("cash_per_share") is None:
                item["cash_per_share"] = item["cash"] / shares
            if item.get("total_debt") is not None and item.get("total_debt_per_share") is None:
                item["total_debt_per_share"] = item["total_debt"] / shares
        enriched.append(item)
    return enriched


@router.get("/{ticker}/info", response_model=StockInfoResponse)
def get_stock_info(
    ticker: str,
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        return market_data_service.get_quote_and_info(db, ticker, refresh=refresh)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{ticker}/prices", response_model=PriceHistoryResponse)
def get_stock_prices(
    ticker: str,
    period: str = Query("MAX"),
    currency: Optional[str] = Query(None),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        return market_data_service.get_price_history(
            db,
            ticker,
            period=period,
            currency=currency,
            refresh=refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{ticker}/fundamentals", response_model=FundamentalsResponse)
def get_stock_fundamentals(
    ticker: str,
    frequency: str = Query("annual"),
    per_share: bool = Query(False),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        data = market_data_service.get_fundamentals(db, ticker, refresh=refresh)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    freq_norm = "quarterly" if frequency.strip().lower() == "quarterly" else "annual"
    annual = _with_per_share_fields(data.get("annual") or [])
    quarterly = _with_per_share_fields(data.get("quarterly") or [])
    raw_ttm = data.get("ttm")
    ttm = _with_per_share_fields([raw_ttm])[0] if isinstance(raw_ttm, dict) else None
    series = quarterly if freq_norm == "quarterly" else annual

    return {
        **data,
        "frequency": freq_norm,
        "per_share": per_share,
        "series": series,
        "annual": annual,
        "quarterly": quarterly,
        "ttm": ttm,
    }


@router.get("/{ticker}/analysts", response_model=AnalystsResponse)
def get_stock_analysts(
    ticker: str,
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        return market_data_service.get_analysts(db, ticker, refresh=refresh)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{ticker}/surprises", response_model=SurprisesResponse)
def get_stock_surprises(
    ticker: str,
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        return market_data_service.get_surprises(db, ticker, refresh=refresh)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{ticker}/segments", response_model=SegmentsResponse)
def get_stock_segments(
    ticker: str,
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        return market_data_service.get_segments(db, ticker, refresh=refresh)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{ticker}/overview", response_model=StockOverviewResponse)
def get_stock_overview(
    ticker: str,
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    sym = normalize_ticker(ticker)
    if refresh:
        cache_service.invalidate(db, f"peers:{sym}")
    try:
        quote = market_data_service.get_quote_and_info(db, sym, refresh=refresh)
        if quote.get("asset_type") == "ETF":
            price_history = market_data_service.get_price_history(
                db, sym, period="MAX", refresh=refresh
            )
            scores = score_etf(quote, price_history)
            fair_value = compute_default_fair_value(quote, {"available": False})
            red_flags: list[dict[str, Any]] = []
        else:
            fundamentals = market_data_service.get_fundamentals(db, sym, refresh=refresh)
            sector_avg = get_cached_sector_averages(
                db, quote.get("sector"), quote.get("industry"), sym
            )
            scores = score_equity(quote, fundamentals, sector_averages=sector_avg)
            fair_value = compute_default_fair_value(quote, fundamentals)
            red_flags = detect_red_flags(quote, fundamentals)

        persist_asset_scores(db, sym, scores)
        return {
            "info": quote,
            "scores": scores,
            "fair_value": fair_value,
            "red_flags": red_flags,
            "updated_at": quote["updated_at"],
            "is_stale": bool(quote.get("is_stale", False)),
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{ticker}/fair-value", response_model=FairValueResponse)
def calculate_stock_fair_value(
    ticker: str,
    body: FairValueRequest,
    db: Session = Depends(get_db),
):
    try:
        quote = market_data_service.get_quote_and_info(db, ticker, refresh=False)
        fundamentals = market_data_service.get_fundamentals(db, ticker, refresh=False)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    defaults = compute_default_fair_value(quote, fundamentals)
    annual = fundamentals.get("annual") or []
    latest = annual[-1] if annual else {}

    metric_used = body.metric_used or defaults.get("metric_used") or "EPS"
    base_metric: Optional[float] = None
    if metric_used == "FCF":
        base_metric = latest.get("fcf_per_share")
    else:
        base_metric = latest.get("eps")
        if (base_metric is None or base_metric <= 0) and quote.get("price") and quote.get("pe"):
            if quote["pe"] > 0:
                base_metric = quote["price"] / quote["pe"]

    if base_metric is None or base_metric <= 0:
        base_metric = defaults.get("base_metric_per_share")
        metric_used = defaults.get("metric_used") or metric_used

    result = calculate_fair_value(
        current_price=quote.get("price"),
        base_metric_per_share=base_metric,
        expected_growth_pct=body.expected_growth_pct,
        exit_multiple=body.exit_multiple,
        required_return_pct=body.required_return_pct,
        horizon_years=body.horizon_years,
        metric_used=metric_used,
    )
    result["default_growth_pct"] = defaults.get("default_growth_pct")
    result["default_exit_multiple"] = defaults.get("default_exit_multiple")
    result["default_required_return_pct"] = defaults.get("default_required_return_pct")
    return result


@router.get("/{ticker}/peers", response_model=PeersComparisonResponse)
def get_stock_peers(
    ticker: str,
    extra: Optional[str] = Query(None),
    exclude: Optional[str] = Query(None),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    extra_list = [s.strip() for s in extra.split(",") if s.strip()] if extra else None
    exclude_list = [s.strip() for s in exclude.split(",") if s.strip()] if exclude else None
    try:
        return peers_service.get_peers_comparison(
            db,
            ticker,
            extra=extra_list,
            exclude=exclude_list,
            refresh=refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{ticker}/peers/overrides", response_model=PeerOverridesResponse)
def put_stock_peer_override(
    ticker: str,
    body: PeerOverrideRequest,
    db: Session = Depends(get_db),
):
    try:
        return update_peer_override(db, ticker, body.peer_ticker, body.action)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
