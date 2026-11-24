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
        "ESE.PA": ("BNP Paribas Easy S&P 500 UCITS ETF", "ETF", True, "bnpparibas-am.com"),
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


def test_sector_country_repair_and_etf_lookthrough_geography(client, db_session, monkeypatch):
    from app.services.cache_service import cache_service
    from app.services.market_data import market_data_service

    dts = pd.date_range(start="2025-11-01", end="2026-11-20", freq="B")
    df = pd.DataFrame({"Close": [100.0] * len(dts)}, index=dts)
    empty_info_tk = SimpleNamespace(
        info={},
        fast_info=SimpleNamespace(last_price=100.0, previous_close=99.0, currency="USD"),
        history=lambda **kwargs: df,
        quarterly_financials=pd.DataFrame(),
        financials=pd.DataFrame(),
        quarterly_income_stmt=pd.DataFrame(),
        income_stmt=pd.DataFrame(),
        quarterly_balance_sheet=pd.DataFrame(),
        balance_sheet=pd.DataFrame(),
        quarterly_cashflow=pd.DataFrame(),
        cashflow=pd.DataFrame(),
        dividends=pd.Series(dtype=float),
        earnings_history=None,
        recommendations_summary=None,
        news=[],
    )
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )
    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else empty_info_tk,
    )
    monkeypatch.setattr(
        "app.services.market_data.MarketDataService._fetch_yf_search_name",
        lambda self, sym: None,
    )

    # 1) Live & cache-hit repair of sector + country when Yahoo tk.info == {}
    for sym, exp_sector, exp_country in [
        ("NVDA", "Technology", "United States"),
        ("ZS", "Technology", "United States"),
        ("LLY", "Healthcare", "United States"),
    ]:
        q_live = market_data_service.get_quote_and_info(db_session, sym, refresh=True)
        assert q_live["sector"] == exp_sector
        assert q_live["country"] == exp_country

        cache_service.set(
            db_session,
            f"quote:{sym}",
            "quote",
            {
                "ticker": sym,
                "name": sym,
                "asset_type": "EQUITY",
                "currency": "USD",
                "region": "US",
                "sector": None,
                "country": None,
                "price": 100.0,
            },
        )
        q_rep = market_data_service.get_quote_and_info(db_session, sym, refresh=False)
        assert q_rep["sector"] == exp_sector
        assert q_rep["country"] == exp_country

    # 2) Portfolio donuts: equities-only by_sector + look-through ETF sectors + geography
    for ticker, env, qty in [
        ("NVDA", "CTO", 1.0),
        ("LLY", "CTO", 1.0),
        ("PUST.PA", "PEA", 2.0),
        ("ESE.PA", "PEA", 2.0),
        ("18MH.DU", "PEA", 2.0),
    ]:
        res = client.post(
            "/api/portfolio/positions",
            json={"ticker": ticker, "envelope": env, "quantity": qty, "pru": 90.0, "currency": "EUR"},
        )
        assert res.status_code == 201

    dash = client.get("/api/portfolio").json()
    donuts = dash["donuts"]

    # Equities-only by_sector must NOT be 100% Autre
    eq_sectors = {s["name"]: s["weight_pct"] for s in donuts["by_sector"]}
    assert "Autre" not in eq_sectors
    assert eq_sectors["Technology"] == pytest.approx(50.0, abs=0.2)
    assert eq_sectors["Healthcare"] == pytest.approx(50.0, abs=0.2)

    # Look-through sector donut includes stocks + ETF decompositions
    lt_sectors = {s["name"]: s["weight_pct"] for s in donuts["by_sector_lookthrough"]}
    assert sum(lt_sectors.values()) == pytest.approx(100.0, abs=0.5)
    assert lt_sectors["Technologie"] > 30.0
    assert lt_sectors["Santé"] > 15.0
    assert "Finance" in lt_sectors

    # Geographic diversification sums to 100% and splits US vs Asie & Émergents vs Europe
    geo = {s["name"]: s["weight_pct"] for s in donuts["by_geography"]}
    assert sum(geo.values()) == pytest.approx(100.0, abs=0.5)
    assert geo["États-Unis"] > 60.0
    assert geo["Asie & Émergents"] > 20.0
    assert "Europe" in geo


def test_finnhub_realtime_quote_live_today_chart_and_response_cache(client, db_session, monkeypatch):
    from datetime import datetime, timezone

    from app.services.market_data import market_data_service

    fixed_tuesday = datetime(2026, 11, 24, 15, 30, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("app.services.portfolio_service.utc_now", lambda: fixed_tuesday)

    # Historical daily candles end yesterday (Monday 2026-11-23) with delayed close 150.0
    dts = pd.date_range(start="2026-10-01", end="2026-11-23", freq="B")
    nvda_closes = [140.0] * (len(dts) - 1) + [150.0]
    bench_closes = [5000.0 + i for i in range(len(dts))]

    def _df(vals: list[float]) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "Open": vals,
                "High": vals,
                "Low": vals,
                "Close": vals,
                "Volume": [1_000_000] * len(vals),
                "Stock Splits": [0.0] * len(vals),
            },
            index=dts,
        )

    tk_nvda = SimpleNamespace(
        info={
            "longName": "NVIDIA Corporation",
            "quoteType": "EQUITY",
            "currency": "USD",
            "currentPrice": 151.0,  # delayed Yahoo price
            "previousClose": 150.0,
            "sector": "Technology",
            "sharesOutstanding": 100.0,
            "marketCap": 15100.0,
        },
        fast_info=SimpleNamespace(last_price=151.0, previous_close=150.0, currency="USD"),
        history=lambda **kwargs: _df(nvda_closes),
        quarterly_financials=pd.DataFrame(),
        financials=pd.DataFrame(),
        quarterly_income_stmt=pd.DataFrame(),
        income_stmt=pd.DataFrame(),
        quarterly_balance_sheet=pd.DataFrame(),
        balance_sheet=pd.DataFrame(),
        quarterly_cashflow=pd.DataFrame(),
        cashflow=pd.DataFrame(),
        dividends=pd.Series(dtype=float),
        earnings_history=None,
        recommendations_summary=None,
        news=[],
    )
    tk_bench = SimpleNamespace(
        info={"longName": "S&P 500", "quoteType": "INDEX", "currency": "USD", "currentPrice": 5100.0},
        fast_info=SimpleNamespace(last_price=5100.0, previous_close=bench_closes[-1], currency="USD"),
        history=lambda **kwargs: _df(bench_closes),
    )
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )
    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else (tk_bench if sym == "^GSPC" else tk_nvda),
    )

    def _mock_finnhub(self, path, params=None):
        if path == "/quote" and (params or {}).get("symbol") == "NVDA":
            return {"c": 165.0, "pc": 150.0, "d": 15.0, "dp": 10.0}
        return None

    monkeypatch.setattr("app.services.market_data.MarketDataService._finnhub_get", _mock_finnhub)

    # 1) Finnhub /quote overrides delayed Yahoo price for US stocks
    q = market_data_service.get_quote_and_info(db_session, "NVDA", refresh=True)
    assert q["price"] == 165.0
    assert q["day_change_pct"] == 10.0

    # 2) Portfolio performance appends live Today ("2026-11-24") using live Finnhub price (165.0)
    res_add = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "NVDA",
            "envelope": "CTO",
            "quantity": 2.0,
            "pru": 140.0,
            "currency": "USD",
            "purchase_date": "2026-10-15",
        },
    )
    assert res_add.status_code == 201

    perf = client.get("/api/portfolio/performance?period=1M&benchmark=%5EGSPC&currency=EUR&mode=real").json()
    assert perf["points"][-1]["date"] == "2026-11-24"
    # 2 shares * 165.0 (EURUSD = 1.0) = 330.0
    assert perf["points"][-1]["portfolio_value"] == pytest.approx(330.0, abs=0.2)

    # 3) Response L1 cache returns fast hit, and cash/position mutation invalidates it
    dash1 = client.get("/api/portfolio").json()
    assert dash1["stats"]["total_value_eur"] == pytest.approx(330.0, abs=0.2)

    put_cash = client.put("/api/portfolio/cash", json={"cash_eur": 70.0})
    assert put_cash.status_code == 200
    dash2 = client.get("/api/portfolio").json()
    assert dash2["stats"]["cash_eur"] == 70.0
    assert dash2["stats"]["total_value_eur"] == pytest.approx(400.0, abs=0.2)


def test_finnhub_forward_pe_screener_and_radar_52w_high_fallback(client, db_session, monkeypatch):
    from app.services.cache_service import cache_service
    from app.services.market_data import market_data_service

    dts = pd.date_range(end="2026-11-24", periods=30, freq="B")
    closes = [180.0] * 10 + [200.0] * 10 + [160.0] * 10  # recent 52W peak = 200.0, current = 160.0 (-20%)
    hist_df = pd.DataFrame(
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
    empty_info_tk = SimpleNamespace(
        info={},
        fast_info=SimpleNamespace(last_price=160.0, previous_close=160.0, currency="USD"),
        history=lambda **kwargs: hist_df,
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
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )
    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else empty_info_tk,
    )

    def _mock_finnhub(self, path, params=None):
        if path == "/stock/metric" and (params or {}).get("symbol") == "NVDA":
            return {
                "metric": {
                    "forwardPE": 19.5,
                    "peTTM": 28.0,
                    "52WeekHigh": 200.0,
                    "52WeekLow": 120.0,
                }
            }
        return None

    monkeypatch.setattr("app.services.market_data.MarketDataService._finnhub_get", _mock_finnhub)

    # 1) Rate-limited Yahoo (tk.info == {}) fills forward_pe, pe, fifty_two_week_high via Finnhub + hist_1y
    q = market_data_service.get_quote_and_info(db_session, "NVDA", refresh=True)
    assert q["forward_pe"] == 19.5
    assert q["pe"] == 28.0
    assert q["fifty_two_week_high"] == 200.0

    # Screener shows persisted forward_pe
    scr = client.get("/api/screener?q=NVDA&limit=10").json()
    nvda_rows = [it for it in scr["items"] if it["ticker"] == "NVDA"]
    assert len(nvda_rows) == 1
    assert nvda_rows[0]["forward_pe"] == 19.5

    # Subsequent refresh WITHOUT Finnhub must NOT wipe Asset.forward_pe to None
    monkeypatch.setattr("app.services.market_data.MarketDataService._finnhub_get", lambda self, *a, **kw: None)
    market_data_service.get_quote_and_info(db_session, "NVDA", refresh=True)
    scr2 = client.get("/api/screener?q=NVDA&limit=10").json()
    assert [it for it in scr2["items"] if it["ticker"] == "NVDA"][0]["forward_pe"] == 19.5

    # 2) Opportunity radar computes distance_52w_high_pct from prices history even if quote.fifty_two_week_high is None
    res_add = client.post(
        "/api/portfolio/positions",
        json={"ticker": "PUST.PA", "envelope": "PEA", "quantity": 2.0, "pru": 150.0, "currency": "EUR"},
    )
    assert res_add.status_code == 201
    # Force cached quote to have fifty_two_week_high=None (as if from rate-limited ETF)
    cache_service.set(
        db_session,
        "quote:PUST.PA",
        "quote",
        {
            "ticker": "PUST.PA",
            "name": "Amundi PEA Nasdaq-100 UCITS ETF Acc",
            "asset_type": "ETF",
            "currency": "EUR",
            "region": "EU",
            "pea_eligible": True,
            "price": 160.0,
            "fifty_two_week_high": None,
        },
    )
    radar = client.get("/api/portfolio/radar").json()
    pust_items = [it for it in radar["items"] if it["ticker"] == "PUST.PA"]
    assert len(pust_items) == 1
    # 160 vs peak 200 => -20.0%
    assert pust_items[0]["distance_52w_high_pct"] == pytest.approx(-20.0, abs=0.2)
