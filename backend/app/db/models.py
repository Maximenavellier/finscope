from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.utils.math_utils import utc_now


class Asset(Base):
    __tablename__ = "assets"

    ticker: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    asset_type: Mapped[str] = mapped_column(String(16), nullable=False, default="EQUITY", index=True)
    exchange: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    region: Mapped[str] = mapped_column(String(16), nullable=False, default="US", index=True)
    pea_eligible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    industry: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    logo_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    market_cap: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    forward_pe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    p_fcf: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    peg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rev_growth_1y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rev_growth_3y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    eps_growth_1y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gross_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    op_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    roe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_debt_ebitda: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    score_global: Mapped[Optional[float]] = mapped_column(Float, nullable=True, index=True)
    score_valuation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_growth: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_quality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_health: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class MarketCache(Base):
    __tablename__ = "market_cache"

    cache_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    asset_type: Mapped[str] = mapped_column(String(16), nullable=False, default="EQUITY")
    asset_type_override: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    envelope: Mapped[str] = mapped_column(String(16), nullable=False, default="CTO")
    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pru: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    invested_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(16), nullable=False, default="EUR")
    purchase_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    fees_eur: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class PortfolioSale(Base):
    __tablename__ = "portfolio_sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    asset_type: Mapped[str] = mapped_column(String(16), nullable=False, default="EQUITY")
    envelope: Mapped[str] = mapped_column(String(16), nullable=False, default="CTO")
    quantity_sold: Mapped[float] = mapped_column(Float, nullable=False)
    pru_eur: Mapped[float] = mapped_column(Float, nullable=False)
    sell_price_eur: Mapped[float] = mapped_column(Float, nullable=False)
    sell_price_input: Mapped[float] = mapped_column(Float, nullable=False)
    sell_currency: Mapped[str] = mapped_column(String(16), nullable=False, default="EUR")
    proceeds_eur: Mapped[float] = mapped_column(Float, nullable=False)
    cost_basis_eur: Mapped[float] = mapped_column(Float, nullable=False)
    realized_pnl_eur: Mapped[float] = mapped_column(Float, nullable=False)
    realized_pnl_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sale_date: Mapped[str] = mapped_column(String(16), nullable=False)
    is_full_sale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class PortfolioLot(Base):
    __tablename__ = "portfolio_lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    quantity_added: Mapped[float] = mapped_column(Float, nullable=False)
    price_input: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(16), nullable=False, default="EUR")
    price_eur: Mapped[float] = mapped_column(Float, nullable=False)
    amount_eur: Mapped[float] = mapped_column(Float, nullable=False)
    fees_eur: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tx_date: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    target_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_currency: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class PeerOverride(Base):
    __tablename__ = "peer_overrides"
    __table_args__ = (UniqueConstraint("ticker", "peer_ticker", name="uq_peer_override_ticker_peer"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    peer_ticker: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)


class UserSetting(Base):
    __tablename__ = "user_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class ScoreSnapshot(Base):
    __tablename__ = "score_snapshots"
    __table_args__ = (UniqueConstraint("ticker", "snapshot_date", name="uq_score_snapshot_ticker_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    snapshot_date: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    score_global: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_valuation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_growth: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_quality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_health: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
