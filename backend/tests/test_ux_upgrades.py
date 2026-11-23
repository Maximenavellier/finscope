from types import SimpleNamespace

import pandas as pd
import pytest


def _mock_income_stmt() -> pd.DataFrame:
    cols = pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31"])
    return pd.DataFrame(
        {
            cols[0]: [150.0, 90.0, 45.0, 36.0, 3.6, 55.0],
            cols[1]: [120.0, 68.0, 32.0, 25.0, 2.5, 40.0],
            cols[2]: [100.0, 52.0, 22.0, 17.0, 1.7, 28.0],
        },
        index=[
            "Total Revenue",
            "Gross Profit",
            "Operating Income",
            "Net Income",
            "Diluted EPS",
            "EBITDA",
        ],
    )


def _mock_balance_sheet() -> pd.DataFrame:
    cols = pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31"])
    return pd.DataFrame(
        {
            cols[0]: [120.0, 30.0, 40.0, 20.0, 10.0, 10.0],
            cols[1]: [100.0, 25.0, 30.0, 25.0, 10.0, 10.0],
            cols[2]: [85.0, 20.0, 22.0, 30.0, 10.0, 10.0],
        },
        index=[
            "Stockholders Equity",
            "Total Debt",
            "Cash And Cash Equivalents",
            "Current Assets",
            "Current Liabilities",
            "Ordinary Shares Number",
        ],
    )


def _mock_cashflow() -> pd.DataFrame:
    cols = pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31"])
    return pd.DataFrame(
        {
            cols[0]: [42.0, 6.0, 36.0],
            cols[1]: [30.0, 5.0, 25.0],
            cols[2]: [22.0, 4.0, 18.0],
        },
        index=["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow"],
    )


def test_cto_fees_dividends_and_invested_value_curve(client, monkeypatch):
    dts = pd.date_range(start="2025-11-01", end="2026-11-20", freq="B")
    aapl_closes = [100.0] * len(dts)
    pust_closes = [50.0] * len(dts)
    bench_closes = [1000.0 + i for i in range(len(dts))]

    def _make_df(closes: list[float]) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "Open": closes,
                "High": closes,
                "Low": closes,
                "Close": closes,
                "Volume": [1_000_000] * len(closes),
                "Stock Splits": [0.0] * len(closes),
            },
            index=dts,
        )

    tk_aapl = SimpleNamespace(
        info={
            "longName": "Apple Inc.",
            "quoteType": "EQUITY",
            "currency": "EUR",
            "currentPrice": 100.0,
            "previousClose": 98.0,
            "dividendRate": 2.0,
            "exDividendDate": 1767225600,
            "sector": "Technology",
            "sharesOutstanding": 10.0,
            "marketCap": 1000.0,
        },
        fast_info=SimpleNamespace(last_price=100.0, previous_close=98.0, currency="EUR"),
        history=lambda **kwargs: _make_df(aapl_closes),
        quarterly_financials=pd.DataFrame(),
        financials=_mock_income_stmt(),
        quarterly_income_stmt=pd.DataFrame(),
        income_stmt=_mock_income_stmt(),
        quarterly_balance_sheet=pd.DataFrame(),
        balance_sheet=_mock_balance_sheet(),
        quarterly_cashflow=pd.DataFrame(),
        cashflow=_mock_cashflow(),
        dividends=pd.Series(dtype=float),
        earnings_history=None,
        recommendations_summary=None,
        news=[],
    )
    tk_pust = SimpleNamespace(
        info={"longName": "Amundi Nasdaq-100", "quoteType": "ETF", "currency": "EUR", "currentPrice": 50.0, "previousClose": 50.0},
        fast_info=SimpleNamespace(last_price=50.0, previous_close=50.0, currency="EUR"),
        history=lambda **kwargs: _make_df(pust_closes),
        dividends=pd.Series(dtype=float),
    )
    tk_bench = SimpleNamespace(
        info={"longName": "S&P 500", "quoteType": "INDEX", "currency": "EUR", "currentPrice": bench_closes[-1]},
        fast_info=SimpleNamespace(last_price=bench_closes[-1], previous_close=bench_closes[-2], currency="EUR"),
        history=lambda **kwargs: _make_df(bench_closes),
    )
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )

    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx
        if sym == "EURUSD=X"
        else (tk_bench if sym == "^GSPC" else (tk_pust if sym == "PUST.PA" else tk_aapl)),
    )

    res_aapl = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "AAPL",
            "envelope": "CTO",
            "quantity": 10.0,
            "pru": 100.0,
            "currency": "EUR",
            "purchase_date": "2026-01-02",
            "fees_eur": 1.0,
        },
    )
    assert res_aapl.status_code == 201
    aapl_pos_id = res_aapl.json()["id"]

    res_pust = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "PUST.PA",
            "asset_type": "ETF",
            "envelope": "PEA",
            "quantity": 10.0,
            "pru": 50.0,
            "currency": "EUR",
            "purchase_date": "2026-01-02",
            "fees_eur": 0.0,
        },
    )
    assert res_pust.status_code == 201

    dash1 = client.get("/api/portfolio").json()
    aapl_item = next(p for p in dash1["positions"] if p["ticker"] == "AAPL")
    assert aapl_item["fees_eur"] == pytest.approx(1.0)
    assert aapl_item["cost_basis_eur"] == pytest.approx(1001.0)
    assert aapl_item["dividend_yield_pct"] == pytest.approx(2.0, abs=0.05)
    assert aapl_item["annual_dividend_eur"] == pytest.approx(20.0, abs=0.2)
    assert aapl_item["ex_dividend_date"] == "2026-01-01"
    assert dash1["stats"]["total_fees_eur"] == pytest.approx(1.0)

    divs = dash1["dividends"]
    assert divs["payers_count"] == 1
    assert divs["annual_gross_eur"] == pytest.approx(20.0, abs=0.2)
    assert divs["annual_net_eur"] == pytest.approx(20.0 * (1.0 - 0.314), abs=0.2)

    reinf = client.post(
        f"/api/portfolio/positions/{aapl_pos_id}/reinforce",
        json={"quantity": 5.0, "price": 100.0, "currency": "EUR", "purchase_date": "2026-06-01", "fees_eur": 1.0},
    )
    assert reinf.status_code == 200
    dash2 = client.get("/api/portfolio").json()
    aapl2 = next(p for p in dash2["positions"] if p["ticker"] == "AAPL")
    assert aapl2["fees_eur"] == pytest.approx(2.0)
    assert aapl2["cost_basis_eur"] == pytest.approx(1502.0)
    assert dash2["stats"]["total_fees_eur"] == pytest.approx(2.0)

    perf = client.get("/api/portfolio/performance?period=1Y&benchmark=%5EGSPC&currency=EUR&mode=real").json()
    pts = perf["points"]
    assert len(pts) >= 5
    # Before Jun 1 reinforce, invested_value = 1001 (AAPL) + 500 (PUST) = 1501; after = 2002
    assert pts[0]["invested_value"] == pytest.approx(1501.0, abs=0.5)
    assert pts[-1]["invested_value"] == pytest.approx(2002.0, abs=0.5)
    assert pts[-1]["portfolio_value"] == pytest.approx(2000.0, abs=0.5)

    # Optional uninvested cash reserve adds to total_value and total_cost without changing total_pnl_eur
    cash_res = client.put("/api/portfolio/cash", json={"cash_eur": 125.5})
    assert cash_res.status_code == 200
    assert cash_res.json() == {"cash_eur": 125.5}

    dash3 = client.get("/api/portfolio").json()
    assert dash3["stats"]["cash_eur"] == pytest.approx(125.5)
    assert dash3["stats"]["total_cost_eur"] == pytest.approx(2002.0 + 125.5, abs=0.2)
    assert dash3["stats"]["total_value_eur"] == pytest.approx(2000.0 + 125.5, abs=0.2)
    assert dash3["stats"]["total_pnl_eur"] == pytest.approx(-2.0, abs=0.2)

    perf_cash = client.get("/api/portfolio/performance?period=1Y&benchmark=%5EGSPC&currency=EUR&mode=real").json()
    assert perf_cash["points"][-1]["invested_value"] == pytest.approx(2002.0 + 125.5, abs=0.5)
    assert perf_cash["points"][-1]["portfolio_value"] == pytest.approx(2000.0 + 125.5, abs=0.5)


def test_stock_score_history_and_news_endpoints(client, monkeypatch):
    dts = pd.date_range(start="2023-01-02", end="2025-12-31", freq="B")
    closes = [100.0 + (i * 0.05) for i in range(len(dts))]
    df = pd.DataFrame(
        {
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Volume": [1_000_000] * len(closes),
            "Stock Splits": [0.0] * len(closes),
        },
        index=dts,
    )

    tk = SimpleNamespace(
        info={
            "longName": "Apple Inc.",
            "quoteType": "EQUITY",
            "currency": "USD",
            "currentPrice": closes[-1],
            "previousClose": closes[-2],
            "sharesOutstanding": 10.0,
            "marketCap": closes[-1] * 10.0,
            "sector": "Technology",
        },
        fast_info=SimpleNamespace(last_price=closes[-1], previous_close=closes[-2], currency="USD"),
        history=lambda **kwargs: df,
        quarterly_financials=pd.DataFrame(),
        financials=_mock_income_stmt(),
        quarterly_income_stmt=pd.DataFrame(),
        income_stmt=_mock_income_stmt(),
        quarterly_balance_sheet=pd.DataFrame(),
        balance_sheet=_mock_balance_sheet(),
        quarterly_cashflow=pd.DataFrame(),
        cashflow=_mock_cashflow(),
        dividends=pd.Series(dtype=float),
        earnings_history=None,
        recommendations_summary=None,
        news=[
            {
                "title": "Apple unveils AI chips",
                "publisher": "Reuters",
                "link": "https://example.com/1",
                "providerPublishTime": 1767225600,
                "summary": "Strong growth in hardware.",
            },
            {
                "content": {
                    "title": "Apple unveils AI chips",  # duplicate title should be deduped
                    "provider": {"displayName": "Bloomberg"},
                    "canonicalUrl": {"url": "https://example.com/dup"},
                    "pubDate": "2026-01-02T10:00:00Z",
                }
            },
            {
                "content": {
                    "title": "Services margin hits record high",
                    "provider": {"displayName": "CNBC"},
                    "canonicalUrl": {"url": "https://example.com/2"},
                    "pubDate": "2026-01-03T12:00:00Z",
                    "summary": "Services accelerate in Q4.",
                }
            },
        ],
    )
    monkeypatch.setattr("app.services.market_data.fetch_sec_financials", lambda *a, **kw: None)
    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: tk)

    sh_res = client.get("/api/stocks/AAPL/score-history")
    assert sh_res.status_code == 200
    sh = sh_res.json()
    assert sh["ticker"] == "AAPL"
    assert len(sh["points"]) >= 4
    labels = [p["label"] for p in sh["points"]]
    assert "2023" in labels
    assert "2024" in labels
    assert "2025" in labels
    assert "Actuel" in labels
    assert sh["trend_label"] in {"En amélioration", "En baisse", "Stable"}

    news_res = client.get("/api/stocks/AAPL/news?limit=5")
    assert news_res.status_code == 200
    nw = news_res.json()
    assert nw["ticker"] == "AAPL"
    assert len(nw["items"]) == 2
    assert nw["items"][0]["title"] == "Apple unveils AI chips"
    assert nw["items"][1]["publisher"] == "CNBC"


def test_rate_limited_quote_resolves_names_logos_and_repairs_cache(db_session, monkeypatch):
    from app.services.cache_service import cache_service
    from app.services.market_data import market_data_service

    dts = pd.date_range(start="2025-11-01", end="2026-11-20", freq="B")
    df = pd.DataFrame({"Close": [100.0] * len(dts)}, index=dts)
    empty_info_tk = SimpleNamespace(
        info={},
        fast_info=SimpleNamespace(last_price=100.0, previous_close=99.0, currency="EUR"),
        history=lambda **kwargs: df,
    )
    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: empty_info_tk)
    monkeypatch.setattr(
        "app.services.market_data.MarketDataService._fetch_yf_search_name",
        lambda self, sym: "Custom Searched Co" if sym == "CUSTOMX" else None,
    )

    # 1) Live fetch when Yahoo tk.info == {} (Render rate-limit simulation)
    expected = {
        "NVDA": ("NVIDIA Corporation", "EQUITY", False, "nvidia.com"),
        "PUST.PA": ("Amundi PEA Nasdaq-100 UCITS ETF Acc", "ETF", True, "amundietf.fr"),
        "ESE.PA": ("BNP Paribas Easy S&P 500 UCITS ETF", "ETF", True, "easy.bnpparibas.fr"),
        "18MH.DU": ("Amundi PEA MSCI Emerging Markets UCITS ETF Acc", "ETF", True, "amundietf.fr"),
    }
    for sym, (exp_name, exp_type, exp_pea, exp_domain) in expected.items():
        q = market_data_service.get_quote_and_info(db_session, sym, refresh=True)
        assert q["name"] == exp_name
        assert q["asset_type"] == exp_type
        assert q["pea_eligible"] is exp_pea
        assert q["logo_url"] and exp_domain in q["logo_url"]

    # Unseeded ticker resolves via Yahoo Search fallback
    custom_q = market_data_service.get_quote_and_info(db_session, "CUSTOMX", refresh=True)
    assert custom_q["name"] == "Custom Searched Co"

    # 2) Cache-hit repair when an existing cache entry stored ticker symbol as name and no logo_url
    for sym, (exp_name, exp_type, exp_pea, exp_domain) in expected.items():
        cache_service.set(
            db_session,
            f"quote:{sym}",
            "quote",
            {
                "ticker": sym,
                "name": sym,
                "asset_type": "EQUITY",
                "currency": "EUR",
                "region": "EU",
                "pea_eligible": False,
                "price": 100.0,
                "logo_url": None,
            },
        )
        repaired = market_data_service.get_quote_and_info(db_session, sym, refresh=False)
        assert repaired["name"] == exp_name
        assert repaired["asset_type"] == exp_type
        assert repaired["pea_eligible"] is exp_pea
        assert repaired["logo_url"] and exp_domain in repaired["logo_url"]
