import json
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.config import get_settings


def _build_mock_equity_ticker(symbol: str = "NVDA"):
    dates = pd.date_range(end="2026-11-20", periods=260, freq="B")
    closes = np.linspace(100.0, 200.0, len(dates))
    splits = np.zeros(len(dates))
    splits[150] = 10.0
    hist_df = pd.DataFrame(
        {
            "Open": closes * 0.99,
            "High": closes * 1.01,
            "Low": closes * 0.98,
            "Close": closes,
            "Volume": np.full(len(dates), 1_000_000),
            "Stock Splits": splits,
        },
        index=dates,
    )

    # 3 years of annual financials (matching user adjustment #2: 3-4 years available)
    ann_cols = pd.to_datetime(["2026-01-31", "2025-01-31", "2024-01-31"])
    fin_ann = pd.DataFrame(
        {
            ann_cols[0]: [130e9, 98e9, 80e9, 72e9, 84e9, 2.95, 24.5e9],
            ann_cols[1]: [60e9, 44e9, 33e9, 29e9, 35e9, 1.19, 24.7e9],
            ann_cols[2]: [27e9, 15e9, 4.2e9, 4.3e9, 5.5e9, 0.17, 24.9e9],
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
    bs_ann = pd.DataFrame(
        {
            ann_cols[0]: [43e9, 10e9, 79e9, 80e9, 18e9],
            ann_cols[1]: [26e9, 11e9, 43e9, 44e9, 10.6e9],
            ann_cols[2]: [13e9, 12e9, 22e9, 23e9, 6.5e9],
        },
        index=[
            "Cash Cash Equivalents And Short Term Investments",
            "Total Debt",
            "Stockholders Equity",
            "Current Assets",
            "Current Liabilities",
        ],
    )
    cf_ann = pd.DataFrame(
        {
            ann_cols[0]: [64e9, -3.2e9],
            ann_cols[1]: [28e9, -1.1e9],
            ann_cols[2]: [5.6e9, -1.8e9],
        },
        index=["Operating Cash Flow", "Capital Expenditure"],
    )

    q_cols = pd.to_datetime(["2026-10-31", "2026-07-31", "2026-04-30", "2026-01-31"])
    fin_q = pd.DataFrame(
        {
            q_cols[0]: [35e9, 26e9, 22e9, 19e9, 23e9, 0.78, 24.5e9],
            q_cols[1]: [30e9, 22e9, 18.6e9, 16.5e9, 19.5e9, 0.67, 24.5e9],
            q_cols[2]: [26e9, 20e9, 16.9e9, 14.8e9, 17.5e9, 0.60, 24.6e9],
            q_cols[3]: [22e9, 16.7e9, 13.6e9, 12.2e9, 14.3e9, 0.49, 24.6e9],
        },
        index=fin_ann.index,
    )
    bs_q = pd.DataFrame(
        {c: bs_ann.iloc[:, 0].values for c in q_cols},
        index=bs_ann.index,
    )
    cf_q = pd.DataFrame(
        {c: [17e9, -0.8e9] for c in q_cols},
        index=cf_ann.index,
    )

    eh = pd.DataFrame(
        {
            "epsEstimate": [0.46, 0.56, 0.64, 0.75],
            "epsActual": [0.49, 0.60, 0.67, 0.78],
            "surprisePercent": [0.065, 0.071, 0.047, 0.04],
        },
        index=pd.to_datetime(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]),
    )

    return SimpleNamespace(
        info={
            "longName": "NVIDIA Corporation",
            "quoteType": "EQUITY",
            "exchange": "NMS",
            "currency": "USD",
            "country": "United States",
            "sector": "Technology",
            "industry": "Semiconductors",
            "website": "https://www.nvidia.com",
            "currentPrice": 200.0,
            "previousClose": 195.0,
            "52WeekChange": 0.85,
            "marketCap": 4.9e12,
            "sharesOutstanding": 24.5e9,
            "trailingPE": 50.0,
            "forwardPE": 35.0,
            "pegRatio": 1.4,
            "grossMargins": 0.75,
            "operatingMargins": 0.61,
            "profitMargins": 0.55,
            "returnOnEquity": 1.15,
        },
        fast_info=SimpleNamespace(last_price=200.0, previous_close=195.0, market_cap=4.9e12, currency="USD"),
        history=lambda **kwargs: hist_df,
        financials=fin_ann,
        balance_sheet=bs_ann,
        cashflow=cf_ann,
        quarterly_financials=fin_q,
        quarterly_balance_sheet=bs_q,
        quarterly_cashflow=cf_q,
        revenue_estimate=pd.DataFrame(),
        earnings_estimate=pd.DataFrame(),
        earnings_history=eh,
        earnings_dates=pd.DataFrame(),
    )


def _build_mock_etf_ticker():
    dates = pd.date_range(end="2026-11-20", periods=260, freq="B")
    closes = np.linspace(500.0, 560.0, len(dates))
    hist_df = pd.DataFrame(
        {
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Volume": np.full(len(dates), 25_000),
            "Stock Splits": np.zeros(len(dates)),
        },
        index=dates,
    )
    return SimpleNamespace(
        info={
            "longName": "Amundi MSCI World UCITS ETF",
            "quoteType": "ETF",
            "exchange": "PAR",
            "currency": "EUR",
            "currentPrice": 560.0,
            "previousClose": 558.0,
            "annualReportExpenseRatio": 0.0038,
            "totalAssets": 4_200_000_000,
            "fundFamily": "Amundi",
            "category": "Global Large-Cap Blend Equity",
        },
        fast_info=SimpleNamespace(last_price=560.0, previous_close=558.0, market_cap=None, currency="EUR"),
        history=lambda **kwargs: hist_df,
    )


def test_health_and_optional_pin(client, monkeypatch):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert body["pin_enabled"] is False

    # Enable APP_PIN
    monkeypatch.setenv("APP_PIN", "secret42")
    get_settings.cache_clear()

    health_open = client.get("/health")
    assert health_open.status_code == 200
    assert health_open.json()["pin_enabled"] is True

    denied = client.get("/api/search?q=NVDA")
    assert denied.status_code == 401

    wrong = client.get("/api/search?q=NVDA", headers={"X-App-Pin": "wrong"})
    assert wrong.status_code == 401

    allowed = client.get("/api/search?q=NVDA", headers={"X-App-Pin": "secret42"})
    assert allowed.status_code == 200
    assert any(item["ticker"] == "NVDA" for item in allowed.json()["results"])


def test_search_local_seed(client):
    res = client.get("/api/search?q=LVMH")
    assert res.status_code == 200
    results = res.json()["results"]
    assert any(r["ticker"] == "MC.PA" and r["pea_eligible"] is True for r in results)

    res_etf = client.get("/api/search?q=CW8")
    assert res_etf.status_code == 200
    assert any(r["ticker"] == "CW8.PA" and r["asset_type"] == "ETF" for r in res_etf.json()["results"])


def test_fx_eurusd_mocked(client, monkeypatch):
    mock_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.105),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.105]}),
    )
    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: mock_fx)

    res = client.get("/api/fx/eurusd")
    assert res.status_code == 200
    data = res.json()
    assert data["pair"] == "EURUSD"
    assert data["rate"] == pytest.approx(1.105, rel=1e-4)
    assert data["fallback"] is False


def test_prices_mm_currency_conversion_and_slicing(client, monkeypatch):
    mock_eq = _build_mock_equity_ticker("NVDA")
    mock_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.10),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.10]}),
    )

    def fake_ticker(sym: str):
        return mock_fx if sym == "EURUSD=X" else mock_eq

    monkeypatch.setattr("app.services.market_data.yf.Ticker", fake_ticker)

    # Full MAX USD
    res_max = client.get("/api/stocks/NVDA/prices?period=MAX")
    assert res_max.status_code == 200
    max_data = res_max.json()
    assert max_data["currency"] == "USD"
    assert len(max_data["points"]) == 260
    assert max_data["points"][0]["mm50"] is None
    assert max_data["points"][60]["mm50"] is not None
    assert max_data["points"][250]["mm200"] is not None
    assert len(max_data["splits"]) == 1
    assert max_data["splits"][0]["ratio"] == 10.0
    assert max_data["perf_pct"] == pytest.approx(100.0, rel=1e-2)
    assert max_data["cagr_pct"] is not None

    # 1Y converted to EUR: MM200 must still be present at start of 1Y slice because computed before slice
    res_eur = client.get("/api/stocks/NVDA/prices?period=1A&currency=EUR")
    assert res_eur.status_code == 200
    eur_data = res_eur.json()
    assert eur_data["period"] == "1Y"
    assert eur_data["currency"] == "EUR"
    assert eur_data["points"][-1]["close"] == pytest.approx(200.0 / 1.10, rel=1e-3)


def test_fundamentals_equity_and_etf(client, monkeypatch):
    mock_eq = _build_mock_equity_ticker("NVDA")
    mock_etf = _build_mock_etf_ticker()

    def fake_ticker(sym: str):
        return mock_etf if sym == "CW8.PA" else mock_eq

    monkeypatch.setattr("app.services.market_data.yf.Ticker", fake_ticker)

    # Equity with 3 years available (no crash when < 5 years)
    res_eq = client.get("/api/stocks/NVDA/fundamentals?frequency=quarterly&per_share=true")
    assert res_eq.status_code == 200
    eq_data = res_eq.json()
    assert eq_data["available"] is True
    assert eq_data["frequency"] == "quarterly"
    assert eq_data["per_share"] is True
    assert len(eq_data["annual"]) == 3
    assert len(eq_data["series"]) == 4
    assert eq_data["historical_years_count"] >= 1
    assert eq_data["series"][-1]["cash_per_share"] is not None
    assert eq_data["annual"][-1]["free_cash_flow"] is not None

    # Verify strict JSON serializability (no NaN)
    json.dumps(eq_data, allow_nan=False)

    # ETF fundamentals cleanly unavailable
    res_etf = client.get("/api/stocks/CW8.PA/fundamentals")
    assert res_etf.status_code == 200
    etf_data = res_etf.json()
    assert etf_data["available"] is False
    assert etf_data["reason"] == "ETF"


def test_surprises_and_segments(client, monkeypatch):
    mock_eq = _build_mock_equity_ticker("NVDA")
    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: mock_eq)

    res_surp = client.get("/api/stocks/NVDA/surprises")
    assert res_surp.status_code == 200
    surp = res_surp.json()
    assert surp["available"] is True
    assert len(surp["eps"]) == 4
    assert surp["eps"][-1]["surprise_pct"] == pytest.approx(4.0, rel=1e-2)
    assert len(surp["revenue"]) == 4
    assert surp["revenue_estimates_available"] is False

    res_seg = client.get("/api/stocks/NVDA/segments")
    assert res_seg.status_code == 200
    seg = res_seg.json()
    assert seg["segments_available"] is False
    assert seg["segments"] == []
    assert seg["margins_available"] is True
    assert len(seg["margins_annual"]) == 3
    assert len(seg["margins_quarterly"]) == 4
