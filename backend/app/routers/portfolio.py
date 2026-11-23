from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.portfolio import (
    DcaPlanRequest,
    DcaPlanResponse,
    DcaSettings,
    OpportunityRadarResponse,
    PortfolioBackupPayload,
    PortfolioCashUpdate,
    PortfolioDashboardResponse,
    PortfolioPerformanceResponse,
    PortfolioPositionCreate,
    PortfolioPositionItem,
    PortfolioPositionUpdate,
    PortfolioReinforceRequest,
    PortfolioRestoreResponse,
    PortfolioSellRequest,
    PortfolioSellResponse,
    ProjectionDefaultsResponse,
    ProjectionRequest,
    ProjectionResponse,
)
from app.services.decision_engine import simulate_wealth_projection
from app.services.portfolio_service import portfolio_service

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("", response_model=PortfolioDashboardResponse)
def get_portfolio_dashboard(
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    return portfolio_service.get_portfolio_dashboard(db, refresh=refresh)


@router.put("/cash", response_model=PortfolioCashUpdate)
def save_portfolio_cash(
    body: PortfolioCashUpdate,
    db: Session = Depends(get_db),
):
    return portfolio_service.save_portfolio_cash(db, body.cash_eur)


@router.get("/performance", response_model=PortfolioPerformanceResponse)
def get_portfolio_performance(
    period: str = Query("1Y"),
    benchmark: str = Query("^GSPC"),
    currency: str = Query("EUR"),
    mode: Literal["real", "backtest"] = Query("real"),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.get_portfolio_performance(
            db,
            period=period,
            benchmark=benchmark,
            currency=currency,
            mode=mode,
            refresh=refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/positions",
    response_model=PortfolioPositionItem,
    status_code=status.HTTP_201_CREATED,
)
def create_portfolio_position(
    body: PortfolioPositionCreate,
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.create_position(db, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/positions/{position_id}", response_model=PortfolioPositionItem)
def update_portfolio_position(
    position_id: int,
    body: PortfolioPositionUpdate,
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.update_position(db, position_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/positions/{position_id}/reinforce", response_model=PortfolioPositionItem)
def reinforce_portfolio_position(
    position_id: int,
    body: PortfolioReinforceRequest,
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.reinforce_position(db, position_id, body)
    except ValueError as exc:
        code = 404 if "introuvable" in str(exc).lower() else 400
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.post("/positions/{position_id}/sell", response_model=PortfolioSellResponse)
def sell_portfolio_position(
    position_id: int,
    body: PortfolioSellRequest,
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.sell_position(db, position_id, body)
    except ValueError as exc:
        code = 404 if "introuvable" in str(exc).lower() else 400
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.delete("/positions/{position_id}")
def delete_portfolio_position(
    position_id: int,
    db: Session = Depends(get_db),
):
    try:
        portfolio_service.delete_position(db, position_id)
        return {"deleted": True, "id": position_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/sales/{sale_id}")
def delete_portfolio_sale(
    sale_id: int,
    db: Session = Depends(get_db),
):
    try:
        portfolio_service.delete_sale(db, sale_id)
        return {"deleted": True, "id": sale_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/radar", response_model=OpportunityRadarResponse)
def get_opportunity_radar(
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    return portfolio_service.get_opportunity_radar(db, refresh=refresh)


@router.get("/dca/settings", response_model=DcaSettings)
def get_dca_settings(db: Session = Depends(get_db)):
    return portfolio_service.get_dca_settings(db)


@router.put("/dca/settings", response_model=DcaSettings)
def save_dca_settings(
    body: DcaSettings,
    db: Session = Depends(get_db),
):
    return portfolio_service.save_dca_settings(db, body)


@router.post("/dca/plan", response_model=DcaPlanResponse)
def build_dca_plan(
    body: DcaPlanRequest,
    db: Session = Depends(get_db),
):
    return portfolio_service.build_dca_plan(db, body)


@router.get("/projections/defaults", response_model=ProjectionDefaultsResponse)
def get_projection_defaults(
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    return portfolio_service.get_projection_defaults(db, refresh=refresh)


@router.post("/projections", response_model=ProjectionResponse)
def compute_projections(body: ProjectionRequest):
    return simulate_wealth_projection(**body.model_dump())


@router.get("/export/csv")
def export_portfolio_csv(
    kind: Literal["positions", "sales"] = Query("positions"),
    db: Session = Depends(get_db),
):
    filename, content = portfolio_service.export_csv(db, kind=kind)
    return Response(
        content=content.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/backup", response_model=PortfolioBackupPayload)
def export_portfolio_backup(db: Session = Depends(get_db)):
    return portfolio_service.export_backup(db)


@router.post("/restore", response_model=PortfolioRestoreResponse)
def restore_portfolio_backup(
    body: PortfolioBackupPayload,
    db: Session = Depends(get_db),
):
    try:
        return portfolio_service.restore_backup(db, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
