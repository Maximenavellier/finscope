from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import models  # noqa: F401
from app.db.database import Base
from app.services.market_data import seed_assets_metadata
from app.services.peers_service import (
    build_peers_summary,
    compute_deltas,
    compute_sector_averages,
    peers_service,
    update_peer_override,
)


def _mock_ticker_for(sym: str):
    profiles = {
        "NVDA": (200.0, 25.0, 20.0, 1.1, 0.74, 0.60, 0.54, 0.90, 5e12, 130e9, 70e9),
        "AMD": (150.0, 40.0, 28.0, 1.6, 0.52, 0.14, 0.10, 0.08, 2.4e11, 25e9, 2.5e9),
        "AVGO": (180.0, 35.0, 26.0, 1.5, 0.64, 0.36, 0.25, 0.25, 8.5e11, 50e9, 12e9),
        "INTC": (25.0, 500.0, 45.0, 9.0, 0.38, -0.02, -0.05, -0.03, 1.0e11, 52e9, -2e9),  # Outlier PE=500
        "QCOM": (165.0, 18.0, 15.0, 1.3, 0.56, 0.28, 0.24, 0.38, 1.8e11, 39e9, 9.5e9),
    }
    price, pe, fpe, peg, gm, om, nm, roe, mcap, rev, ni = profiles.get(
        sym, (100.0, 20.0, 18.0, 1.4, 0.50, 0.20, 0.15, 0.20, 1e11, 20e9, 3e9)
    )
    dates = pd.date_range(end="2026-11-20", periods=60, freq="B")
    hist = pd.DataFrame(
        {
            "Open": np.full(len(dates), price),
            "High": np.full(len(dates), price),
            "Low": np.full(len(dates), price),
            "Close": np.full(len(dates), price),
            "Volume": np.full(len(dates), 1_000_000),
            "Stock Splits": np.zeros(len(dates)),
        },
        index=dates,
    )
    cols = pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31"])
    fin = pd.DataFrame(
        {
            cols[0]: [rev, rev * gm, rev * om, ni, rev * (om + 0.04), max(0.1, ni / 1e9), 1e9],
            cols[1]: [rev * 0.85, rev * 0.85 * gm, rev * 0.85 * om, ni * 0.8, rev * 0.85 * (om + 0.04), max(0.1, ni * 0.8 / 1e9), 1e9],
            cols[2]: [rev * 0.70, rev * 0.70 * gm, rev * 0.70 * om, ni * 0.65, rev * 0.70 * (om + 0.04), max(0.1, ni * 0.65 / 1e9), 1e9],
        },
        index=[
            "Total Revenue",
            "Gross Profit",
            "Operating Income",
            "Net Income",
            "EBITDA",
            "Diluted EPS",
            "Diluted Average Shares",
        ],
    )
    bs = pd.DataFrame(
        {c: [10e9, 5e9, 30e9, 20e9, 10e9] for c in cols},
        index=["Cash And Cash Equivalents", "Total Debt", "Stockholders Equity", "Current Assets", "Current Liabilities"],
    )
    cf = pd.DataFrame(
        {c: [max(1e9, ni * 1.05), -1e9] for c in cols},
        index=["Operating Cash Flow", "Capital Expenditure"],
    )
    return SimpleNamespace(
        info={
            "longName": f"{sym} Corp",
            "quoteType": "EQUITY",
            "currency": "USD",
            "sector": "Technology",
            "industry": "Semiconductors",
            "currentPrice": price,
            "previousClose": price * 0.99,
            "marketCap": mcap,
            "sharesOutstanding": 1e9,
            "trailingPE": pe if pe > 0 else None,
            "forwardPE": fpe,
            "pegRatio": peg,
            "grossMargins": gm,
            "operatingMargins": om,
            "profitMargins": nm,
            "returnOnEquity": roe,
        },
        fast_info=SimpleNamespace(last_price=price, previous_close=price * 0.99, market_cap=mcap, currency="USD"),
        history=lambda **kwargs: hist,
        financials=fin,
        balance_sheet=bs,
        cashflow=cf,
        quarterly_financials=pd.DataFrame(),
        quarterly_balance_sheet=pd.DataFrame(),
        quarterly_cashflow=pd.DataFrame(),
        revenue_estimate=pd.DataFrame(),
        earnings_estimate=pd.DataFrame(),
    )


def test_compute_sector_averages_clips_outliers_and_inverts_deltas():
    peer_rows = [
        {"ticker": "A", "pe": 20.0, "net_margin": 0.20, "rev_growth_1y": 0.15, "score_valuation": 60, "score_growth": 60, "score_quality": 65, "score_health": 70},
        {"ticker": "B", "pe": 30.0, "net_margin": 0.10, "rev_growth_1y": 0.05, "score_valuation": 50, "score_growth": 50, "score_quality": 55, "score_health": 60},
        {"ticker": "OUT", "pe": 500.0, "net_margin": 0.15, "rev_growth_1y": 0.10},  # PE=500 clipped!
        {"ticker": "NEG", "pe": -20.0, "net_margin": 0.15, "rev_growth_1y": 0.10},  # PE=-20 clipped!
    ]
    avgs = compute_sector_averages(peer_rows)
    assert avgs["pe"] == pytest.approx(25.0)
    assert avgs["net_margin"] == pytest.approx(0.15)

    company_row = {"pe": 20.0, "net_margin": 0.10, "rev_growth_1y": 0.25}
    deltas = compute_deltas(company_row, avgs)
    # Lower PE than average (20 vs 25 = -20%) -> better
    assert deltas["pe"]["status"] == "better"
    assert deltas["pe"]["diff_pct"] == pytest.approx(-20.0)
    # Lower net margin (10% vs 15% = -5 pts) -> worse
    assert deltas["net_margin"]["status"] == "worse"
    assert deltas["net_margin"]["diff_pts"] == pytest.approx(-5.0)

    sentence = build_peers_summary(deltas)
    assert isinstance(sentence, str) and len(sentence) > 15


def test_peer_overrides_and_parallel_file_sqlite_fetch(tmp_path, monkeypatch):
    db_file = tmp_path / "peers_parallel.db"
    eng = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False, "timeout": 15})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    Base.metadata.create_all(bind=eng)

    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: _mock_ticker_for(sym))

    with TestingSession() as db:
        seed_assets_metadata(db)
        ov = update_peer_override(db, "NVDA", "INTC", "EXCLUDE")
        assert "INTC" in ov["excluded"]
        ov2 = update_peer_override(db, "NVDA", "TXN", "ADD")
        assert "TXN" in ov2["added"]

        res = peers_service.get_peers_comparison(
            db,
            "NVDA",
            session_factory=TestingSession,
        )
        assert res["available"] is True
        peer_tickers = [p["ticker"] for p in res["peers"]]
        assert "TXN" in peer_tickers
        assert "INTC" not in peer_tickers
        assert res["company"]["ticker"] == "NVDA"
        assert res["radar"]["company"]["quality"] is not None
        assert len(res["summary_sentence"]) > 10

        # Reset overrides
        ov_reset = update_peer_override(db, "NVDA", None, "RESET")
        assert ov_reset["added"] == []
        assert ov_reset["excluded"] == []

    eng.dispose()
