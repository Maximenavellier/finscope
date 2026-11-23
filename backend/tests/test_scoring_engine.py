import json
from datetime import datetime, timedelta

import numpy as np

from app.services.scoring_engine import score_equity, score_etf


def _make_price_series(start_price: float, end_price: float, years: int = 5):
    days = years * 252
    start_dt = datetime(2021, 11, 20)
    closes = np.linspace(start_price, end_price, days)
    points = [
        {"date": (start_dt + timedelta(days=int(i * 365.25 / 252))).strftime("%Y-%m-%d"), "close": float(c)}
        for i, c in enumerate(closes)
    ]
    return {
        "points": points,
        "annualized_volatility_pct": 14.5,
        "max_drawdown_pct": -18.0,
    }


def test_score_equity_undervalued_leader_with_3y_history():
    quote = {
        "ticker": "LEAD",
        "sector": "Technology",
        "industry": "Software - Infrastructure",
        "price": 100.0,
        "market_cap": 100e9,
        "enterprise_value": 95e9,
        "pe": 16.0,
        "forward_pe": 14.0,
        "peg": 0.9,
    }
    fundamentals = {
        "available": True,
        "historical_years_count": 3,
        "historical_multiples": [
            {"period_end": "2023-12-31", "pe": 25.0, "p_fcf": 28.0, "ev_ebitda": 20.0},
            {"period_end": "2024-12-31", "pe": 24.0, "p_fcf": 26.0, "ev_ebitda": 19.0},
            {"period_end": "2025-12-31", "pe": 22.0, "p_fcf": 24.0, "ev_ebitda": 18.0},
        ],
        "annual": [
            {
                "period_end": "2023-12-31",
                "fiscal_year": 2023,
                "revenue": 10e9,
                "eps": 3.5,
                "free_cash_flow": 3.2e9,
                "ebitda": 4.2e9,
            },
            {
                "period_end": "2024-12-31",
                "fiscal_year": 2024,
                "revenue": 12e9,
                "eps": 4.5,
                "free_cash_flow": 4.2e9,
                "ebitda": 5.3e9,
            },
            {
                "period_end": "2025-12-31",
                "fiscal_year": 2025,
                "revenue": 15.5e9,
                "eps": 6.25,
                "free_cash_flow": 6.25e9,
                "ebitda": 7.0e9,
                "gross_margin": 0.76,
                "op_margin": 0.38,
                "net_margin": 0.30,
                "roe": 0.32,
                "roic": 0.28,
                "fcf_conversion": 1.05,
                "net_debt_ebitda": -0.7,
                "debt_to_equity": 0.2,
                "current_ratio": 2.4,
            },
        ],
    }

    res = score_equity(quote, fundamentals, sector_averages={"pe": 26.0, "forward_pe": 22.0, "p_fcf": 28.0})
    assert res["global"]["score"] >= 75.0
    assert res["valuation"]["score"] >= 70.0
    assert res["quality"]["score"] >= 80.0
    assert res["health"]["score"] >= 90.0
    assert "moyenne 3A" in res["valuation_verdict"]
    assert res["summary_badge"] == "Leader sous-évalué"
    assert res["growth_trend"] == "Accélération"
    json.dumps(res, allow_nan=False)


def test_score_equity_expensive_quality_and_risky_growth():
    # Quality >= 70 & Valuation < 45 -> Qualité chère
    expensive_q = {
        "ticker": "LUX",
        "sector": "Consumer Cyclical",
        "industry": "Luxury Goods",
        "price": 100.0,
        "market_cap": 100e9,
        "pe": 45.0,
        "forward_pe": 38.0,
        "peg": 3.8,
    }
    expensive_f = {
        "available": True,
        "historical_years_count": 3,
        "historical_multiples": [
            {"period_end": "2023-12-31", "pe": 24.0, "p_fcf": 25.0},
            {"period_end": "2024-12-31", "pe": 25.0, "p_fcf": 26.0},
            {"period_end": "2025-12-31", "pe": 26.0, "p_fcf": 27.0},
        ],
        "annual": [
            {"period_end": "2023-12-31", "fiscal_year": 2023, "revenue": 10e9, "eps": 2.0, "free_cash_flow": 2.0e9},
            {"period_end": "2024-12-31", "fiscal_year": 2024, "revenue": 11e9, "eps": 2.1, "free_cash_flow": 2.1e9},
            {
                "period_end": "2025-12-31",
                "fiscal_year": 2025,
                "revenue": 12e9,
                "eps": 2.22,
                "free_cash_flow": 2.2e9,
                "gross_margin": 0.72,
                "op_margin": 0.30,
                "net_margin": 0.22,
                "roe": 0.26,
                "roic": 0.22,
                "fcf_conversion": 0.95,
                "net_debt_ebitda": 0.5,
                "debt_to_equity": 0.3,
                "current_ratio": 1.8,
            },
        ],
    }
    res_exp = score_equity(expensive_q, expensive_f, sector_averages={"pe": 22.0, "forward_pe": 20.0})
    assert res_exp["quality"]["score"] >= 70.0
    assert res_exp["valuation"]["score"] < 45.0
    assert res_exp["summary_badge"] == "Qualité chère"

    # Growth >= 70 & Health < 50 -> Croissance à risque
    risky_q = {
        "ticker": "LEVG",
        "sector": "Technology",
        "industry": "Software - Application",
        "price": 50.0,
        "market_cap": 10e9,
        "pe": 22.0,
        "peg": 1.2,
    }
    risky_f = {
        "available": True,
        "historical_years_count": 3,
        "historical_multiples": [
            {"period_end": "2023-12-31", "pe": 22.0},
            {"period_end": "2024-12-31", "pe": 22.0},
            {"period_end": "2025-12-31", "pe": 22.0},
        ],
        "annual": [
            {"period_end": "2023-12-31", "fiscal_year": 2023, "revenue": 1e9, "eps": 1.0, "free_cash_flow": 0.4e9},
            {"period_end": "2024-12-31", "fiscal_year": 2024, "revenue": 1.4e9, "eps": 1.5, "free_cash_flow": 0.6e9},
            {
                "period_end": "2025-12-31",
                "fiscal_year": 2025,
                "revenue": 2.0e9,
                "eps": 2.27,
                "free_cash_flow": 0.9e9,
                "gross_margin": 0.50,
                "op_margin": 0.12,
                "net_margin": 0.08,
                "roe": 0.10,
                "net_debt_ebitda": 4.8,
                "debt_to_equity": 3.2,
                "current_ratio": 0.7,
            },
        ],
    }
    res_risk = score_equity(risky_q, risky_f)
    assert res_risk["growth"]["score"] >= 70.0
    assert res_risk["health"]["score"] < 50.0
    assert res_risk["summary_badge"] == "Croissance à risque"


def test_score_equity_financial_sector_and_missing_metrics():
    bank_q = {
        "ticker": "BNP.PA",
        "sector": "Financial Services",
        "industry": "Banks - Regional",
        "price": 65.0,
        "market_cap": 75e9,
        "pe": 7.5,
        "net_margin": 0.24,
        "roe": 0.11,
        "debt_to_equity_info": 180.0,  # 1.8x in Yahoo percent units
    }
    bank_f = {"available": True, "annual": [], "historical_multiples": [], "historical_years_count": 0}
    res = score_equity(bank_q, bank_f)
    assert res["health"]["score"] is not None
    assert "secteur financier" in res["health"]["explanation"]
    assert res["quality"]["score"] is not None
    assert res["global"]["score"] is not None
    json.dumps(res, allow_nan=False)


def test_score_etf():
    etf_q = {
        "ticker": "CW8.PA",
        "asset_type": "ETF",
        "expense_ratio": 0.0038,
        "total_assets": 4.5e9,
    }
    hist = _make_price_series(350.0, 580.0, years=5)
    res = score_etf(etf_q, hist)
    assert res["mode"] == "ETF"
    assert res["global"]["score"] >= 60.0
    assert res["valuation"]["label"] == "Frais (TER)"
    assert res["etf_metrics"]["ter_pct"] == 0.38
    assert res["etf_metrics"]["cagr_5y_pct"] is not None
    json.dumps(res, allow_nan=False)
