from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, model_validator


class PortfolioPositionCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=32)
    asset_type: Optional[Literal["EQUITY", "ETF"]] = None
    envelope: Literal["PEA", "CTO"] = "CTO"
    quantity: Optional[float] = Field(None, gt=0)
    pru: Optional[float] = Field(None, gt=0)
    invested_amount: Optional[float] = Field(None, gt=0)
    currency: Optional[str] = Field("EUR", max_length=16)
    purchase_date: Optional[str] = Field(None, max_length=16)
    notes: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_sizing(self):
        has_qty_pru = self.quantity is not None and self.pru is not None
        has_amount = self.invested_amount is not None
        if not has_qty_pru and not has_amount:
            raise ValueError("Fournissez (quantité + PRU) ou le montant investi.")
        return self


class PortfolioPositionUpdate(BaseModel):
    asset_type: Optional[Literal["EQUITY", "ETF"]] = None
    envelope: Optional[Literal["PEA", "CTO"]] = None
    quantity: Optional[float] = Field(None, gt=0)
    pru: Optional[float] = Field(None, gt=0)
    invested_amount: Optional[float] = Field(None, gt=0)
    clear_quantity_pru: bool = False
    currency: Optional[str] = Field(None, max_length=16)
    purchase_date: Optional[str] = Field(None, max_length=16)
    notes: Optional[str] = Field(None, max_length=500)


class PortfolioPositionItem(BaseModel):
    id: int
    ticker: str
    name: str
    logo_url: Optional[str] = None
    asset_type: str = "EQUITY"
    sector: Optional[str] = None
    envelope: str
    quantity: Optional[float] = None
    pru: Optional[float] = None
    invested_amount: Optional[float] = None
    currency: str = "EUR"
    purchase_date: Optional[str] = None
    current_price: Optional[float] = None
    asset_currency: Optional[str] = None
    current_value_eur: float = 0.0
    cost_basis_eur: float = 0.0
    pnl_eur: float = 0.0
    pnl_pct: Optional[float] = None
    day_change_eur: Optional[float] = None
    day_change_pct: Optional[float] = None
    perf_1m_eur: Optional[float] = None
    perf_1m_pct: Optional[float] = None
    perf_1y_eur: Optional[float] = None
    perf_1y_pct: Optional[float] = None
    weight_pct: float = 0.0
    score_global: Optional[float] = None
    score_valuation: Optional[float] = None
    notes: Optional[str] = None
    updated_at: str


class PortfolioSellRequest(BaseModel):
    mode: Literal["full", "partial"] = "full"
    sell_percent: Optional[float] = Field(None, gt=0, le=100)
    sell_quantity: Optional[float] = Field(None, gt=0)
    sell_amount: Optional[float] = Field(None, gt=0)
    sell_price: float = Field(..., gt=0)
    sell_currency: Literal["EUR", "USD"] = "EUR"
    sale_date: Optional[str] = Field(None, max_length=16)
    notes: Optional[str] = Field(None, max_length=500)


class PortfolioSaleItem(BaseModel):
    id: int
    ticker: str
    name: str
    asset_type: str = "EQUITY"
    envelope: str
    quantity_sold: float
    pru_eur: float
    sell_price_eur: float
    sell_price_input: float
    sell_currency: str = "EUR"
    proceeds_eur: float
    cost_basis_eur: float
    realized_pnl_eur: float
    realized_pnl_pct: Optional[float] = None
    sale_date: str
    is_full_sale: bool = False
    notes: Optional[str] = None
    created_at: str


class PortfolioSellResponse(BaseModel):
    sale: PortfolioSaleItem
    remaining_position: Optional[PortfolioPositionItem] = None
    position_closed: bool = False


class PortfolioReinforceRequest(BaseModel):
    amount: Optional[float] = Field(None, gt=0)
    quantity: Optional[float] = Field(None, gt=0)
    price: float = Field(..., gt=0)
    currency: Literal["EUR", "USD"] = "EUR"
    purchase_date: Optional[str] = Field(None, max_length=16)
    notes: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_reinforcement(self):
        if self.amount is None and self.quantity is None:
            raise ValueError("Précisez un montant ou une quantité à ajouter.")
        return self


class PortfolioPerformancePoint(BaseModel):
    date: str
    portfolio_base100: float
    benchmark_base100: float
    portfolio_pct: float
    benchmark_pct: float
    portfolio_value: Optional[float] = None
    benchmark_price: Optional[float] = None


class PeriodicReturnItem(BaseModel):
    label: str
    start_date: str
    end_date: str
    portfolio_return_pct: float
    benchmark_return_pct: float
    alpha_pts: float


class PortfolioPerformanceResponse(BaseModel):
    period: str
    benchmark: str
    benchmark_name: str
    currency: str = "EUR"
    calculation_mode: Literal["real", "backtest"] = "backtest"
    calculation_label: str = "Backtest composition actuelle"
    portfolio_perf_pct: Optional[float] = None
    benchmark_perf_pct: Optional[float] = None
    portfolio_cagr_pct: Optional[float] = None
    benchmark_cagr_pct: Optional[float] = None
    elapsed_years: Optional[float] = None
    alpha_pts: Optional[float] = None
    avg_alpha_pts: Optional[float] = None
    annual_returns: list[PeriodicReturnItem] = Field(default_factory=list)
    quarterly_returns: list[PeriodicReturnItem] = Field(default_factory=list)
    points: list[PortfolioPerformancePoint] = Field(default_factory=list)
    positions_included: int = 0
    updated_at: str


class DonutSlice(BaseModel):
    name: str
    value_eur: float
    weight_pct: float


class PortfolioDonuts(BaseModel):
    by_position: list[DonutSlice] = Field(default_factory=list)
    by_envelope: list[DonutSlice] = Field(default_factory=list)
    by_sector: list[DonutSlice] = Field(default_factory=list)


class PortfolioWeightedStats(BaseModel):
    total_value_eur: float = 0.0
    total_cost_eur: float = 0.0
    total_pnl_eur: float = 0.0
    total_pnl_pct: Optional[float] = None
    day_pnl_eur: Optional[float] = None
    day_pnl_pct: Optional[float] = None
    perf_1m_eur: Optional[float] = None
    perf_1m_pct: Optional[float] = None
    perf_1y_eur: Optional[float] = None
    perf_1y_pct: Optional[float] = None
    positions_count: int = 0
    equities_count: int = 0
    etfs_count: int = 0
    equities_weight_pct: float = 0.0
    etfs_weight_pct: float = 0.0
    top5_weight_pct: float = 0.0
    avg_market_cap_eur: Optional[float] = None
    gross_margin: Optional[float] = None
    op_margin: Optional[float] = None
    net_margin: Optional[float] = None
    roe: Optional[float] = None
    roa: Optional[float] = None
    rev_growth_1y: Optional[float] = None
    eps_growth_1y: Optional[float] = None
    net_debt_ebitda: Optional[float] = None
    pe: Optional[float] = None
    forward_pe: Optional[float] = None
    p_fcf: Optional[float] = None
    peg: Optional[float] = None
    avg_score_global: Optional[float] = None
    equities_avg_score_global: Optional[float] = None


class PortfolioDashboardResponse(BaseModel):
    eurusd_rate: float
    stats: PortfolioWeightedStats
    donuts: PortfolioDonuts
    positions: list[PortfolioPositionItem] = Field(default_factory=list)
    sales: list[PortfolioSaleItem] = Field(default_factory=list)
    total_realized_pnl_eur: float = 0.0
    updated_at: str


class WatchlistItemCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=32)
    target_price: Optional[float] = Field(None, gt=0)
    target_currency: Optional[str] = Field(None, max_length=16)
    notes: Optional[str] = Field(None, max_length=500)


class WatchlistItemUpdate(BaseModel):
    target_price: Optional[float] = Field(None, gt=0)
    clear_target: bool = False
    target_currency: Optional[str] = Field(None, max_length=16)
    notes: Optional[str] = Field(None, max_length=500)


class WatchlistItemEnriched(BaseModel):
    id: int
    ticker: str
    name: str
    logo_url: Optional[str] = None
    asset_type: str = "EQUITY"
    region: str = "US"
    pea_eligible: bool = False
    sector: Optional[str] = None
    currency: Optional[str] = None
    current_price: Optional[float] = None
    day_change_pct: Optional[float] = None
    score_global: Optional[float] = None
    score_valuation: Optional[float] = None
    summary_badge: Optional[str] = None
    summary_tone: Optional[str] = None
    target_price: Optional[float] = None
    target_currency: Optional[str] = None
    distance_to_target_pct: Optional[float] = None
    alert_triggered: bool = False
    notes: Optional[str] = None
    created_at: str


class WatchlistResponse(BaseModel):
    items: list[WatchlistItemEnriched] = Field(default_factory=list)
    alerts_count: int = 0
    updated_at: str


class RadarItem(BaseModel):
    ticker: str
    name: str
    logo_url: Optional[str] = None
    asset_type: str = "EQUITY"
    region: str = "US"
    pea_eligible: bool = False
    sector: Optional[str] = None
    currency: Optional[str] = None
    in_portfolio: bool = False
    in_watchlist: bool = False
    envelope: Optional[str] = None
    current_value_eur: Optional[float] = None
    current_price: Optional[float] = None
    day_change_pct: Optional[float] = None
    score_global: Optional[float] = None
    fair_value: Optional[float] = None
    margin_of_safety_pct: Optional[float] = None
    price_vs_fair_value_pct: Optional[float] = None
    distance_52w_high_pct: Optional[float] = None
    next_earnings_date: Optional[str] = None
    days_until_earnings: Optional[int] = None
    red_flags_count: int = 0
    signal: Literal["buy", "watch", "wait", "etf"] = "watch"
    signal_label: str = "À surveiller"
    signal_tone: Literal["emerald", "amber", "coral", "slate"] = "amber"
    attractiveness_score: float = 0.0


class RadarEarningsItem(BaseModel):
    ticker: str
    name: str
    logo_url: Optional[str] = None
    in_portfolio: bool = False
    in_watchlist: bool = False
    next_earnings_date: str
    days_until_earnings: int
    score_global: Optional[float] = None


class OpportunityRadarResponse(BaseModel):
    items: list[RadarItem] = Field(default_factory=list)
    upcoming_earnings: list[RadarEarningsItem] = Field(default_factory=list)
    buy_zone_count: int = 0
    updated_at: str


class DcaSettings(BaseModel):
    monthly_amount_eur: float = Field(400.0, ge=1.0, le=1_000_000.0)
    etf_target_pct: float = Field(70.0, ge=0.0, le=100.0)
    equities_target_pct: float = Field(30.0, ge=0.0, le=100.0)
    default_mode: Literal["standard", "opportunistic"] = "standard"


class DcaPlanRequest(BaseModel):
    amount_eur: float = Field(400.0, ge=1.0, le=10_000_000.0)
    etf_target_pct: float = Field(70.0, ge=0.0, le=100.0)
    mode: Literal["standard", "opportunistic"] = "standard"
    save_settings: bool = False


class DcaAllocationLine(BaseModel):
    ticker: str
    name: str
    bucket: Literal["ETF", "EQUITY"]
    envelope: str = "CTO"
    amount_eur: float
    share_pct: float
    reason: str
    score_global: Optional[float] = None
    margin_of_safety_pct: Optional[float] = None
    source: str = "Portefeuille"


class DcaPlanResponse(BaseModel):
    amount_eur: float
    mode: Literal["standard", "opportunistic"]
    etf_target_pct: float
    equities_target_pct: float
    current_etf_pct: float
    current_equities_pct: float
    projected_etf_pct: float
    projected_equities_pct: float
    etf_budget_eur: float
    equities_budget_eur: float
    opportunistic_triggered: bool = False
    explanations: list[str] = Field(default_factory=list)
    lines: list[DcaAllocationLine] = Field(default_factory=list)


class ProjectionDefaultsResponse(BaseModel):
    initial_pea_value: float = 0.0
    initial_pea_contributions: float = 0.0
    initial_cto_value: float = 0.0
    initial_cto_contributions: float = 0.0
    monthly_contribution: float = 400.0
    pea_share_pct: float = 70.0
    pea_cap_eur: float = 150_000.0
    pea_tax_rate_pct: float = 18.6
    cto_tax_rate_pct: float = 31.4


class ProjectionRequest(BaseModel):
    initial_pea_value: float = Field(0.0, ge=0.0, le=100_000_000.0)
    initial_pea_contributions: float = Field(0.0, ge=0.0, le=100_000_000.0)
    initial_cto_value: float = Field(0.0, ge=0.0, le=100_000_000.0)
    initial_cto_contributions: float = Field(0.0, ge=0.0, le=100_000_000.0)
    monthly_contribution: float = Field(400.0, ge=0.0, le=1_000_000.0)
    pea_share_pct: float = Field(70.0, ge=0.0, le=100.0)
    annual_return_pct: float = Field(8.0, ge=-20.0, le=40.0)
    horizon_years: int = Field(20, ge=1, le=40)
    inflation_pct: float = Field(2.0, ge=0.0, le=15.0)
    pea_tax_rate_pct: float = Field(18.6, ge=0.0, le=60.0)
    cto_tax_rate_pct: float = Field(31.4, ge=0.0, le=60.0)
    pea_cap_eur: float = Field(150_000.0, ge=0.0, le=1_000_000.0)
    index_contributions_to_inflation: bool = True
    career_growth_pct: float = Field(2.0, ge=0.0, le=20.0)


class ProjectionYearPoint(BaseModel):
    year: int
    calendar_year: int
    contributed_eur: float
    pea_contributed_eur: float
    cto_contributed_eur: float
    pea_value_eur: float
    cto_value_eur: float
    gross_value_eur: float
    net_value_eur: float
    net_real_value_eur: float


class ProjectionResponse(BaseModel):
    pea_cap_eur: float
    horizon_years: int
    index_contributions_to_inflation: bool = True
    career_growth_pct: float = 0.0
    final_monthly_contribution_eur: float = 0.0
    final_monthly_contribution_real_eur: float = 0.0
    final_contributed_eur: float
    final_gross_eur: float
    final_net_eur: float
    final_net_real_eur: float
    final_pea_value_eur: float
    final_cto_value_eur: float
    total_taxes_eur: float
    pea_cap_reached_year: Optional[int] = None
    pea_cap_reached_calendar_year: Optional[int] = None
    monthly_rent_4pct_net_eur: float
    monthly_rent_4pct_real_eur: float
    points: list[ProjectionYearPoint] = Field(default_factory=list)


class PortfolioBackupPayload(BaseModel):
    version: int = 1
    exported_at: str
    positions: list[dict[str, Any]] = Field(default_factory=list)
    lots: list[dict[str, Any]] = Field(default_factory=list)
    sales: list[dict[str, Any]] = Field(default_factory=list)
    watchlist: list[dict[str, Any]] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)


class PortfolioRestoreResponse(BaseModel):
    restored: bool = True
    positions_count: int = 0
    lots_count: int = 0
    sales_count: int = 0
    watchlist_count: int = 0
    settings_count: int = 0
