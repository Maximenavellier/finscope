from typing import Any, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    db: str
    finnhub_configured: bool
    fmp_configured: bool
    pin_enabled: bool


class FxRateResponse(BaseModel):
    pair: str
    rate: float
    fallback: bool = False
    updated_at: str
    is_stale: bool = False


class SearchAssetItem(BaseModel):
    ticker: str
    name: str
    asset_type: str
    exchange: Optional[str] = None
    region: str = "US"
    pea_eligible: bool = False
    sector: Optional[str] = None
    industry: Optional[str] = None
    logo_url: Optional[str] = None
    price: Optional[float] = None
    score_global: Optional[float] = None


class SearchResponse(BaseModel):
    query: str
    results: list[SearchAssetItem]


class StockInfoResponse(BaseModel):
    ticker: str
    name: str
    asset_type: str
    exchange: Optional[str] = None
    currency: Optional[str] = None
    country: Optional[str] = None
    region: str = "US"
    pea_eligible: bool = False
    sector: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    previous_close: Optional[float] = None
    day_change: Optional[float] = None
    day_change_pct: Optional[float] = None
    change_1y_pct: Optional[float] = None
    market_cap: Optional[float] = None
    enterprise_value: Optional[float] = None
    shares_outstanding: Optional[float] = None
    pe: Optional[float] = None
    forward_pe: Optional[float] = None
    peg: Optional[float] = None
    price_to_book: Optional[float] = None
    ev_to_ebitda: Optional[float] = None
    dividend_yield: Optional[float] = None
    dividend_rate: Optional[float] = None
    ex_dividend_date: Optional[str] = None
    beta: Optional[float] = None
    fifty_two_week_high: Optional[float] = None
    fifty_two_week_low: Optional[float] = None
    analyst_target_price: Optional[float] = None
    recommendation_key: Optional[str] = None
    gross_margin: Optional[float] = None
    op_margin: Optional[float] = None
    net_margin: Optional[float] = None
    roe: Optional[float] = None
    roa: Optional[float] = None
    revenue_growth_info: Optional[float] = None
    earnings_growth_info: Optional[float] = None
    current_ratio_info: Optional[float] = None
    debt_to_equity_info: Optional[float] = None
    total_cash_info: Optional[float] = None
    total_debt_info: Optional[float] = None
    free_cashflow_info: Optional[float] = None
    ebitda_info: Optional[float] = None
    expense_ratio: Optional[float] = None
    total_assets: Optional[float] = None
    fund_family: Optional[str] = None
    category: Optional[str] = None
    next_earnings_date: Optional[str] = None
    days_until_earnings: Optional[int] = None
    fx_to_eur_rate: Optional[float] = None
    price_eur: Optional[float] = None
    updated_at: str
    is_stale: bool = False


class PricePoint(BaseModel):
    date: str
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: float
    volume: Optional[int] = None
    mm50: Optional[float] = None
    mm200: Optional[float] = None


class SplitEvent(BaseModel):
    date: str
    ratio: float


class PriceHistoryResponse(BaseModel):
    ticker: str
    period: str
    native_currency: str
    currency: str
    fx_rate_applied: float = 1.0
    perf_pct: Optional[float] = None
    cagr_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None
    annualized_volatility_pct: Optional[float] = None
    points: list[PricePoint]
    splits: list[SplitEvent] = Field(default_factory=list)
    updated_at: str
    is_stale: bool = False


class FundamentalRecord(BaseModel):
    period_end: str
    fiscal_year: Optional[int] = None
    revenue: Optional[float] = None
    gross_profit: Optional[float] = None
    operating_income: Optional[float] = None
    net_income: Optional[float] = None
    ebitda: Optional[float] = None
    operating_cash_flow: Optional[float] = None
    capex: Optional[float] = None
    free_cash_flow: Optional[float] = None
    eps: Optional[float] = None
    shares_outstanding: Optional[float] = None
    cash: Optional[float] = None
    total_debt: Optional[float] = None
    net_debt: Optional[float] = None
    total_equity: Optional[float] = None
    current_assets: Optional[float] = None
    current_liabilities: Optional[float] = None
    gross_margin: Optional[float] = None
    op_margin: Optional[float] = None
    net_margin: Optional[float] = None
    roe: Optional[float] = None
    roic: Optional[float] = None
    fcf_conversion: Optional[float] = None
    net_debt_ebitda: Optional[float] = None
    debt_to_equity: Optional[float] = None
    current_ratio: Optional[float] = None
    revenue_per_share: Optional[float] = None
    fcf_per_share: Optional[float] = None
    net_income_per_share: Optional[float] = None
    cash_per_share: Optional[float] = None
    total_debt_per_share: Optional[float] = None


class HistoricalMultiple(BaseModel):
    period_end: str
    fiscal_year: Optional[int] = None
    price_at_period_end: Optional[float] = None
    pe: Optional[float] = None
    p_fcf: Optional[float] = None
    ev_ebitda: Optional[float] = None


class DividendAnnualPoint(BaseModel):
    year: int
    dividend_per_share: float


class FundamentalsResponse(BaseModel):
    ticker: str
    available: bool
    reason: Optional[str] = None
    currency: Optional[str] = None
    frequency: str = "annual"
    per_share: bool = False
    series: list[FundamentalRecord] = Field(default_factory=list)
    annual: list[FundamentalRecord] = Field(default_factory=list)
    quarterly: list[FundamentalRecord] = Field(default_factory=list)
    ttm: Optional[FundamentalRecord] = None
    dividends_annual: list[DividendAnnualPoint] = Field(default_factory=list)
    estimates: dict[str, Any] = Field(default_factory=dict)
    historical_multiples: list[HistoricalMultiple] = Field(default_factory=list)
    historical_years_count: int = 0
    updated_at: str
    is_stale: bool = False


class SurprisePoint(BaseModel):
    period: str
    date: str
    estimated: Optional[float] = None
    actual: Optional[float] = None
    surprise_pct: Optional[float] = None


class SurprisesResponse(BaseModel):
    ticker: str
    available: bool
    revenue_estimates_available: bool = False
    eps: list[SurprisePoint] = Field(default_factory=list)
    revenue: list[SurprisePoint] = Field(default_factory=list)
    updated_at: str
    is_stale: bool = False


class SegmentSlice(BaseModel):
    name: str
    revenue: float
    share_pct: float


class SegmentHistoryPoint(BaseModel):
    period: str
    segments: dict[str, float]


class MarginPoint(BaseModel):
    period: str
    gross_margin: Optional[float] = None
    op_margin: Optional[float] = None
    net_margin: Optional[float] = None


class SegmentsResponse(BaseModel):
    ticker: str
    segments_available: bool = False
    segments: list[SegmentSlice] = Field(default_factory=list)
    segment_history: list[SegmentHistoryPoint] = Field(default_factory=list)
    margins_available: bool = False
    margins_annual: list[MarginPoint] = Field(default_factory=list)
    margins_quarterly: list[MarginPoint] = Field(default_factory=list)
    updated_at: str
    is_stale: bool = False


class PriceTargetsSummary(BaseModel):
    current: Optional[float] = None
    high: Optional[float] = None
    mean: Optional[float] = None
    median: Optional[float] = None
    low: Optional[float] = None
    upside_high_pct: Optional[float] = None
    upside_mean_pct: Optional[float] = None
    upside_low_pct: Optional[float] = None


class ForecastPoint(BaseModel):
    period: str
    year: Optional[int] = None
    is_actual: bool = False
    high: Optional[float] = None
    avg: Optional[float] = None
    low: Optional[float] = None
    num_analysts: Optional[int] = None


class CagrSummary(BaseModel):
    high: Optional[float] = None
    avg: Optional[float] = None
    low: Optional[float] = None


class AnalystConsensus(BaseModel):
    strong_buy: int = 0
    buy: int = 0
    hold: int = 0
    sell: int = 0
    strong_sell: int = 0
    total: int = 0
    score_out_of_5: Optional[float] = None
    label: Optional[str] = None
    period: Optional[str] = None


class AnalystsResponse(BaseModel):
    ticker: str
    available: bool
    reason: Optional[str] = None
    currency: Optional[str] = None
    price_targets: Optional[PriceTargetsSummary] = None
    revenue_forecasts: list[ForecastPoint] = Field(default_factory=list)
    revenue_cagr: Optional[CagrSummary] = None
    eps_forecasts: list[ForecastPoint] = Field(default_factory=list)
    eps_cagr: Optional[CagrSummary] = None
    consensus: Optional[AnalystConsensus] = None
    updated_at: str
    is_stale: bool = False


class ApiProviderStatus(BaseModel):
    id: str
    name: str
    status: str
    detail: str


class SystemStatusResponse(BaseModel):
    providers: list[ApiProviderStatus] = Field(default_factory=list)
    cache_entries_count: int = 0
    checked_at: str


class StockNewsItem(BaseModel):
    title: str
    publisher: Optional[str] = None
    url: Optional[str] = None
    published_at: Optional[str] = None
    summary: Optional[str] = None


class StockNewsResponse(BaseModel):
    ticker: str
    items: list[StockNewsItem] = Field(default_factory=list)
    updated_at: str
    is_stale: bool = False
