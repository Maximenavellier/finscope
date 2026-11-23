from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

from app.schemas.market import StockInfoResponse


class ScorePillar(BaseModel):
    score: Optional[float] = None
    label: str
    tone: str = "amber"
    explanation: str = ""


class HistoricalAveragesSummary(BaseModel):
    years_count: int = 0
    pe: Optional[float] = None
    p_fcf: Optional[float] = None
    ev_ebitda: Optional[float] = None
    diff_pct: Optional[float] = None


class EtfMetricsSummary(BaseModel):
    ter_pct: Optional[float] = None
    aum: Optional[float] = None
    perf_1y_pct: Optional[float] = None
    perf_3y_pct: Optional[float] = None
    perf_5y_pct: Optional[float] = None
    perf_max_pct: Optional[float] = None
    cagr_3y_pct: Optional[float] = None
    cagr_5y_pct: Optional[float] = None
    cagr_max_pct: Optional[float] = None
    volatility_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None


class ScoresBundle(BaseModel):
    mode: str = "EQUITY"
    global_score: ScorePillar = Field(alias="global")
    valuation: ScorePillar
    growth: ScorePillar
    quality: ScorePillar
    health: ScorePillar
    summary_badge: str
    summary_tone: str
    valuation_verdict: str
    growth_trend: str
    historical_averages: Optional[HistoricalAveragesSummary] = None
    metrics: Optional[dict[str, Any]] = None
    etf_metrics: Optional[EtfMetricsSummary] = None

    model_config = {"populate_by_name": True}


class FairValueRequest(BaseModel):
    expected_growth_pct: float = Field(..., ge=-50.0, le=100.0)
    exit_multiple: float = Field(..., gt=0.0, le=200.0)
    required_return_pct: float = Field(..., ge=0.0, le=50.0)
    horizon_years: int = Field(5, ge=1, le=15)
    metric_used: Optional[Literal["FCF", "EPS"]] = None


class FairValueResponse(BaseModel):
    available: bool
    reason: Optional[str] = None
    current_price: Optional[float] = None
    base_metric_per_share: Optional[float] = None
    metric_used: Optional[str] = None
    expected_growth_pct: Optional[float] = None
    exit_multiple: Optional[float] = None
    required_return_pct: Optional[float] = None
    default_growth_pct: Optional[float] = None
    default_exit_multiple: Optional[float] = None
    default_required_return_pct: Optional[float] = None
    horizon_years: int = 5
    projected_metric_per_share: Optional[float] = None
    terminal_price: Optional[float] = None
    fair_value: Optional[float] = None
    upside_pct: Optional[float] = None
    margin_of_safety_pct: Optional[float] = None
    verdict: str
    verdict_tone: str = "amber"


class RedFlagItem(BaseModel):
    id: str
    title: str
    severity: Literal["high", "medium", "low"] = "medium"
    value_label: Optional[str] = None
    detail: str


class StockOverviewResponse(BaseModel):
    info: StockInfoResponse
    scores: ScoresBundle
    fair_value: FairValueResponse
    red_flags: list[RedFlagItem] = Field(default_factory=list)
    updated_at: str
    is_stale: bool = False


class PeerMetricRow(BaseModel):
    ticker: str
    name: str
    logo_url: Optional[str] = None
    currency: Optional[str] = None
    market_cap: Optional[float] = None
    price: Optional[float] = None
    pe: Optional[float] = None
    forward_pe: Optional[float] = None
    p_fcf: Optional[float] = None
    peg: Optional[float] = None
    rev_growth_1y: Optional[float] = None
    rev_growth_3y: Optional[float] = None
    eps_growth_1y: Optional[float] = None
    gross_margin: Optional[float] = None
    op_margin: Optional[float] = None
    net_margin: Optional[float] = None
    roe: Optional[float] = None
    net_debt_ebitda: Optional[float] = None
    score_global: Optional[float] = None
    score_valuation: Optional[float] = None
    score_growth: Optional[float] = None
    score_quality: Optional[float] = None
    score_health: Optional[float] = None
    is_target: bool = False


class PeerDelta(BaseModel):
    diff_pct: Optional[float] = None
    diff_pts: Optional[float] = None
    status: str = "neutral"


class RadarAxisValues(BaseModel):
    valuation: Optional[float] = None
    growth: Optional[float] = None
    quality: Optional[float] = None
    health: Optional[float] = None


class PeersRadar(BaseModel):
    company: RadarAxisValues
    sector_avg: RadarAxisValues


class PeersComparisonResponse(BaseModel):
    ticker: str
    available: bool
    reason: Optional[str] = None
    company: Optional[PeerMetricRow] = None
    peers: list[PeerMetricRow] = Field(default_factory=list)
    sector_averages: dict[str, Optional[float]] = Field(default_factory=dict)
    deltas: dict[str, PeerDelta] = Field(default_factory=dict)
    radar: Optional[PeersRadar] = None
    summary_sentence: str
    added_overrides: list[str] = Field(default_factory=list)
    excluded_overrides: list[str] = Field(default_factory=list)
    updated_at: str
    is_stale: bool = False


class PeerOverrideRequest(BaseModel):
    peer_ticker: Optional[str] = None
    action: Literal["ADD", "EXCLUDE", "REMOVE", "RESET"]


class PeerOverridesResponse(BaseModel):
    ticker: str
    added: list[str] = Field(default_factory=list)
    excluded: list[str] = Field(default_factory=list)
