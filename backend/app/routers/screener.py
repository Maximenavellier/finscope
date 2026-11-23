from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.screener import (
    ScreenerResponse,
    SeedJobStartRequest,
    SeedStatusResponse,
)
from app.services.screener_service import query_screener, screener_seed_manager

router = APIRouter(prefix="/api/screener", tags=["screener"])


@router.get("", response_model=ScreenerResponse)
def get_screener(
    preset: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    asset_type: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    pea_only: Optional[bool] = Query(None),
    sector: Optional[str] = Query(None),
    only_scored: Optional[bool] = Query(None),
    min_global: Optional[float] = Query(None, ge=0, le=100),
    min_valuation: Optional[float] = Query(None, ge=0, le=100),
    min_growth: Optional[float] = Query(None, ge=0, le=100),
    min_quality: Optional[float] = Query(None, ge=0, le=100),
    min_health: Optional[float] = Query(None, ge=0, le=100),
    max_pe: Optional[float] = Query(None, gt=0),
    min_rev_growth_pct: Optional[float] = Query(None),
    max_net_debt_ebitda: Optional[float] = Query(None),
    sort_by: str = Query("score_global"),
    sort_dir: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return query_screener(
        db,
        preset=preset,
        q=q,
        asset_type=asset_type,
        region=region,
        pea_only=pea_only,
        sector=sector,
        only_scored=only_scored,
        min_global=min_global,
        min_valuation=min_valuation,
        min_growth=min_growth,
        min_quality=min_quality,
        min_health=min_health,
        max_pe=max_pe,
        min_rev_growth_pct=min_rev_growth_pct,
        max_net_debt_ebitda=max_net_debt_ebitda,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/seed",
    response_model=SeedStatusResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_screener_seed(
    background_tasks: BackgroundTasks,
    body: Optional[SeedJobStartRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    req = body or SeedJobStartRequest()
    should_run, tickers, job_status = screener_seed_manager.prepare_job(db, req)
    if should_run and tickers:
        background_tasks.add_task(
            screener_seed_manager.run_seed_batches,
            db.get_bind(),
            tickers,
            req.batch_size,
            req.delay_seconds,
            not req.only_missing,
        )
    return job_status


@router.get("/seed/status", response_model=SeedStatusResponse)
def get_screener_seed_status():
    return screener_seed_manager.get_status()
