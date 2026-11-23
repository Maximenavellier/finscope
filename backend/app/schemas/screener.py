from typing import Literal, Optional
from pydantic import BaseModel, Field


class ScreenerItem(BaseModel):
    ticker: str
    name: str
    asset_type: str = "EQUITY"
    region: str = "US"
    pea_eligible: bool = False
    sector: Optional[str] = None
    industry: Optional[str] = None
    logo_url: Optional[str] = None
    currency: Optional[str] = None
    price: Optional[float] = None
    market_cap: Optional[float] = None
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
    updated_at: Optional[str] = None


class ScreenerResponse(BaseModel):
    total: int
    scored_count: int
    universe_count: int
    sectors: list[str] = Field(default_factory=list)
    items: list[ScreenerItem] = Field(default_factory=list)
    page: int = 1
    page_size: int = 50


class SeedJobStartRequest(BaseModel):
    only_missing: bool = True
    batch_size: int = Field(4, ge=1, le=10)
    delay_seconds: float = Field(1.2, ge=0.0, le=10.0)
    limit: Optional[int] = Field(None, ge=1, le=200)


class SeedStatusResponse(BaseModel):
    status: Literal["idle", "running", "completed", "error"]
    total: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    current_batch: int = 0
    total_batches: int = 0
    progress_pct: float = 0.0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    last_error: Optional[str] = None
    failed_tickers: list[str] = Field(default_factory=list)
