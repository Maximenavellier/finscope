from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.services.market_data import detect_asset_type


def test_detect_asset_type_european_ucits_keywords():
    assert detect_asset_type("ETF", "Some Random Fund", "XYZ.PA") == "ETF"
    assert detect_asset_type("EQUITY", "Amundi MSCI World UCITS ETF Acc", "CW8.PA") == "ETF"
    assert detect_asset_type("EQUITY", "iShares Core S&P 500 UCITS ETF", "CSPX.L") == "ETF"
    assert detect_asset_type("MUTUALFUND", "Vanguard FTSE All-World UCITS", "VWCE.DE") == "ETF"
    assert detect_asset_type("EQUITY", "Lyxor Nasdaq-100 Daily", "UST.PA") == "ETF"
    assert detect_asset_type("EQUITY", "BNP Paribas Easy S&P 500", "ESE.PA") == "ETF"
    assert detect_asset_type("EQUITY", "LVMH Moet Hennessy", "MC.PA") == "EQUITY"


def _build_history_ticker(closes: list[float], currency: str = "USD", quote_type: str = "EQUITY", name: str = "Test Asset", sector: str = "Technology"):
    dates = pd.date_range(end="2026-11-20", periods=len(closes), freq="B")
    hist_df = pd.DataFrame(
        {
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Volume": np.full(len(closes), 1_000_000),
            "Stock Splits": np.zeros(len(closes)),
        },
        index=dates,
    )
    info = {
        "longName": name,
        "quoteType": quote_type,
        "currency": currency,
        "sector": sector,
        "currentPrice": closes[-1],
        "regularMarketPrice": closes[-1],
    }
    return SimpleNamespace(
        info=info,
        fast_info=SimpleNamespace(last_price=closes[-1], previous_close=closes[-1], currency=currency),
        history=lambda **kwargs: hist_df,
        quarterly_income_stmt=pd.DataFrame(),
        income_stmt=pd.DataFrame(),
        quarterly_balance_sheet=pd.DataFrame(),
        balance_sheet=pd.DataFrame(),
        quarterly_cashflow=pd.DataFrame(),
        cashflow=pd.DataFrame(),
        dividends=pd.Series(dtype=float),
        earnings_history=None,
        recommendations_summary=None,
    )


def test_manual_etf_override_excludes_etf_from_sector_donut(client, monkeypatch):
    mock_etf = _build_history_ticker([100.0, 120.0], currency="EUR", quote_type="EQUITY", name="Ambiguous Fund", sector="Financial Services")
    mock_eq = _build_history_ticker([200.0, 220.0], currency="EUR", quote_type="EQUITY", name="Tech Co", sector="Technology")
    mock_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.10),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.10]}),
    )

    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: mock_fx if sym == "EURUSD=X" else (mock_eq if sym == "TECH.PA" else mock_etf),
    )

    res = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "AMBG.PA",
            "asset_type": "ETF",
            "envelope": "PEA",
            "quantity": 10,
            "pru": 100.0,
            "purchase_date": "2025-06-15",
        },
    )
    assert res.status_code == 201
    pos = res.json()
    assert pos["asset_type"] == "ETF"
    assert pos["sector"] == "ETF"
    assert pos["currency"] == "EUR"
    assert pos["purchase_date"] == "2025-06-15"

    # With only ETF in portfolio, by_sector is empty (ETF excluded from sector breakdown)
    dash_only_etf = client.get("/api/portfolio").json()
    assert dash_only_etf["donuts"]["by_sector"] == []
    assert dash_only_etf["stats"]["etfs_count"] == 1

    # Adding an individual stock yields 100% in Technology (no "ETF" slice)
    res_eq = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "TECH.PA",
            "asset_type": "EQUITY",
            "envelope": "PEA",
            "quantity": 5,
            "pru": 200.0,
            "purchase_date": "2025-06-15",
        },
    )
    assert res_eq.status_code == 201
    dash = client.get("/api/portfolio").json()
    sector_slices = dash["donuts"]["by_sector"]
    assert len(sector_slices) == 1
    assert sector_slices[0]["name"] == "Technology"
    assert sector_slices[0]["weight_pct"] == pytest.approx(100.0, abs=0.1)
    assert "ETF" not in [s["name"] for s in sector_slices]


def test_purchase_date_partial_and_full_sale_flow(client, monkeypatch):
    # NVDA current = 220 USD; EURUSD = 1.10 => 200 EUR/share
    mock_nvda = _build_history_ticker([110.0, 220.0], currency="USD", quote_type="EQUITY", name="NVIDIA Corp")
    mock_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.10),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.10]}),
    )
    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: mock_fx if sym == "EURUSD=X" else mock_nvda,
    )

    created = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "NVDA",
            "envelope": "CTO",
            "quantity": 10.0,
            "pru": 100.0,
            "currency": "EUR",
            "purchase_date": "2025-01-10",
        },
    )
    assert created.status_code == 201
    pos_id = created.json()["id"]
    assert created.json()["purchase_date"] == "2025-01-10"

    # Partial sale: 50% (5 shares) at 150 EUR/share => cost=500 EUR, proceeds=750 EUR, realized=+250 EUR (+50%)
    partial = client.post(
        f"/api/portfolio/positions/{pos_id}/sell",
        json={
            "mode": "partial",
            "sell_percent": 50.0,
            "sell_price": 150.0,
            "sell_currency": "EUR",
            "sale_date": "2026-10-01",
            "notes": "Take half",
        },
    )
    assert partial.status_code == 200
    p_data = partial.json()
    assert p_data["position_closed"] is False
    assert p_data["sale"]["quantity_sold"] == pytest.approx(5.0)
    assert p_data["sale"]["realized_pnl_eur"] == pytest.approx(250.0)
    assert p_data["sale"]["realized_pnl_pct"] == pytest.approx(50.0)
    assert p_data["sale"]["is_full_sale"] is False

    # Remaining active position retains PRU 100 EUR and quantity 5
    rem = p_data["remaining_position"]
    assert rem is not None
    assert rem["quantity"] == pytest.approx(5.0)
    assert rem["pru"] == pytest.approx(100.0)

    # Full sale of remaining 5 shares at 200 EUR => cost=500 EUR, proceeds=1000 EUR, realized=+500 EUR (+100%)
    full = client.post(
        f"/api/portfolio/positions/{pos_id}/sell",
        json={
            "mode": "full",
            "sell_price": 200.0,
            "sell_currency": "EUR",
            "sale_date": "2026-11-15",
        },
    )
    assert full.status_code == 200
    f_data = full.json()
    assert f_data["position_closed"] is True
    assert f_data["remaining_position"] is None
    assert f_data["sale"]["is_full_sale"] is True
    assert f_data["sale"]["realized_pnl_eur"] == pytest.approx(500.0)

    dash = client.get("/api/portfolio").json()
    assert dash["positions"] == []
    assert len(dash["sales"]) == 2
    assert dash["total_realized_pnl_eur"] == pytest.approx(750.0)

    # Delete one recorded sale
    del_res = client.delete(f"/api/portfolio/sales/{f_data['sale']['id']}")
    assert del_res.status_code == 200
    dash2 = client.get("/api/portfolio").json()
    assert len(dash2["sales"]) == 1
    assert dash2["total_realized_pnl_eur"] == pytest.approx(250.0)


def test_portfolio_performance_vs_benchmark(client, monkeypatch):
    # Stock doubles (+50%: 100 -> 150) while benchmark gains +10% (5000 -> 5500)
    stock_closes = np.linspace(100.0, 150.0, 30).tolist()
    bench_closes = np.linspace(5000.0, 5500.0, 30).tolist()

    mock_nvda = _build_history_ticker(stock_closes, currency="USD", quote_type="EQUITY", name="NVIDIA Corp")
    mock_gspc = _build_history_ticker(bench_closes, currency="USD", quote_type="INDEX", name="S&P 500")
    mock_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.10),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.10]}),
    )

    def fake_ticker(sym: str):
        if sym == "EURUSD=X":
            return mock_fx
        if sym == "^GSPC":
            return mock_gspc
        return mock_nvda

    monkeypatch.setattr("app.services.market_data.yf.Ticker", fake_ticker)

    created = client.post(
        "/api/portfolio/positions",
        json={"ticker": "NVDA", "envelope": "CTO", "quantity": 10.0, "pru": 90.0, "currency": "EUR"},
    )
    assert created.status_code == 201

    perf_res = client.get("/api/portfolio/performance?period=1Y&benchmark=^GSPC&currency=EUR")
    assert perf_res.status_code == 200
    perf = perf_res.json()
    assert perf["benchmark"] == "^GSPC"
    assert perf["benchmark_name"] == "S&P 500"
    assert perf["positions_included"] == 1
    assert len(perf["points"]) >= 20
    assert perf["points"][0]["portfolio_base100"] == pytest.approx(100.0)
    assert perf["points"][0]["benchmark_base100"] == pytest.approx(100.0)
    assert perf["portfolio_perf_pct"] == pytest.approx(50.0, abs=0.2)
    assert perf["benchmark_perf_pct"] == pytest.approx(10.0, abs=0.2)
    assert perf["alpha_pts"] == pytest.approx(40.0, abs=0.2)


def test_portfolio_performance_twr_respects_purchase_dates_without_spikes(client, db_session, monkeypatch):
    # 3 fixed business days matching purchase_dates cleanly
    dates = pd.to_datetime(["2026-11-18", "2026-11-19", "2026-11-20"])

    def _make_fixed_tk(closes: list[float], name: str, quote_type: str = "EQUITY"):
        df = pd.DataFrame(
            {
                "Open": closes,
                "High": closes,
                "Low": closes,
                "Close": closes,
                "Volume": [1_000_000] * len(closes),
                "Stock Splits": [0.0] * len(closes),
            },
            index=dates,
        )
        return SimpleNamespace(
            info={"longName": name, "quoteType": quote_type, "currency": "EUR", "currentPrice": closes[-1]},
            fast_info=SimpleNamespace(last_price=closes[-1], previous_close=closes[-1], currency="EUR"),
            history=lambda **kwargs: df,
            quarterly_income_stmt=pd.DataFrame(),
            income_stmt=pd.DataFrame(),
            quarterly_balance_sheet=pd.DataFrame(),
            balance_sheet=pd.DataFrame(),
            quarterly_cashflow=pd.DataFrame(),
            cashflow=pd.DataFrame(),
            dividends=pd.Series(dtype=float),
            earnings_history=None,
            recommendations_summary=None,
        )

    # Stock A bought 2026-11-18: 100 -> 110 (+10%) -> 110 (0%)
    # ETF B bought 2026-11-19 with huge capital: 200 -> 200 -> 220 (+10% on Nov 20)
    # Benchmark: 1000 -> 1000 -> 1020 (+2% cumulative)
    tk_a = _make_fixed_tk([100.0, 110.0, 110.0], "Stock A")
    tk_b = _make_fixed_tk([200.0, 200.0, 220.0], "ETF B", "ETF")
    tk_bench = _make_fixed_tk([1000.0, 1000.0, 1020.0], "S&P 500", "INDEX")
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )

    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else (tk_bench if sym == "^GSPC" else (tk_b if sym == "CW8.PA" else tk_a)),
    )

    # 1 share of Stock A (value 110 on Nov 19), 50 shares of ETF B bought Nov 19 (value 10000 on Nov 19)
    r1 = client.post(
        "/api/portfolio/positions",
        json={"ticker": "NVDA", "envelope": "CTO", "quantity": 1.0, "pru": 100.0, "currency": "EUR", "purchase_date": "2026-11-18"},
    )
    assert r1.status_code == 201
    r2 = client.post(
        "/api/portfolio/positions",
        json={"ticker": "CW8.PA", "envelope": "PEA", "quantity": 50.0, "pru": 200.0, "currency": "EUR", "purchase_date": "2026-11-19"},
    )
    assert r2.status_code == 201

    # Real TWR:
    # Nov 18: base100 = 100.0 (only NVDA held)
    # Nov 19: NVDA +10% => 110.0 (adding CW8 at 10000 EUR causes ZERO spike!)
    # Nov 20: held_prev = 1*110 + 50*200 = 10110 -> today = 1*110 + 50*220 = 11110 => return = 11110/10110
    # Cumulative TWR = 110.0 * (11110 / 10110) = 120.8803 -> +20.88%
    real_res = client.get("/api/portfolio/performance?period=1Y&benchmark=%5EGSPC&currency=EUR&mode=real")
    assert real_res.status_code == 200
    real_data = real_res.json()
    assert real_data["calculation_mode"] == "real"
    assert "Performance réelle" in real_data["calculation_label"]
    assert len(real_data["points"]) == 3
    assert real_data["points"][0]["portfolio_base100"] == pytest.approx(100.0)
    assert real_data["points"][1]["portfolio_base100"] == pytest.approx(110.0)
    expected_final_b100 = 110.0 * (11110.0 / 10110.0)
    assert real_data["points"][2]["portfolio_base100"] == pytest.approx(expected_final_b100, abs=0.05)
    assert real_data["benchmark_perf_pct"] == pytest.approx(2.0, abs=0.02)

    # Explicit backtest mode ignores purchase_date (computes combined 1*100+50*200 -> 1*110+50*220)
    bt_res = client.get("/api/portfolio/performance?period=1Y&benchmark=%5EGSPC&currency=EUR&mode=backtest")
    assert bt_res.status_code == 200
    bt_data = bt_res.json()
    assert bt_data["calculation_mode"] == "backtest"
    assert bt_data["calculation_label"] == "Backtest composition actuelle"
    expected_bt_pct = ((11110.0 / 10100.0) - 1.0) * 100.0
    assert bt_data["portfolio_perf_pct"] == pytest.approx(expected_bt_pct, abs=0.05)

    # When NO position has a purchase_date (legacy rows), even mode=real reports Backtest composition actuelle
    from app.db.models import PortfolioPosition
    db_session.query(PortfolioPosition).update({PortfolioPosition.purchase_date: None})
    db_session.commit()
    legacy_res = client.get("/api/portfolio/performance?period=1Y&benchmark=%5EGSPC&currency=EUR&mode=real")
    assert legacy_res.status_code == 200
    legacy_data = legacy_res.json()
    assert legacy_data["calculation_mode"] == "backtest"
    assert legacy_data["calculation_label"] == "Backtest composition actuelle"


def test_reinforce_position_updates_weighted_pru_and_twr_lots(client, monkeypatch):
    # 3 fixed business days:
    # Nov 18: stock=100, bench=1000
    # Nov 19: stock=120 (+20%), bench=1000 -> user reinforces +1200 EUR (10 shares @ 120)
    # Nov 20: stock=132 (+10%), bench=1050 (+5%)
    dates = pd.to_datetime(["2026-11-18", "2026-11-19", "2026-11-20"])

    def _make_tk(closes, name, qtype="EQUITY"):
        df = pd.DataFrame(
            {
                "Open": closes,
                "High": closes,
                "Low": closes,
                "Close": closes,
                "Volume": [1_000_000] * len(closes),
                "Stock Splits": [0.0] * len(closes),
            },
            index=dates,
        )
        return SimpleNamespace(
            info={"longName": name, "quoteType": qtype, "currency": "EUR", "currentPrice": closes[-1]},
            fast_info=SimpleNamespace(last_price=closes[-1], previous_close=closes[-1], currency="EUR"),
            history=lambda **kwargs: df,
            quarterly_income_stmt=pd.DataFrame(),
            income_stmt=pd.DataFrame(),
            quarterly_balance_sheet=pd.DataFrame(),
            balance_sheet=pd.DataFrame(),
            quarterly_cashflow=pd.DataFrame(),
            cashflow=pd.DataFrame(),
            dividends=pd.Series(dtype=float),
            earnings_history=None,
            recommendations_summary=None,
        )

    tk_nvda = _make_tk([100.0, 120.0, 132.0], "NVIDIA Corp")
    tk_bench = _make_tk([1000.0, 1000.0, 1050.0], "S&P 500", "INDEX")
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )

    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else (tk_bench if sym == "^GSPC" else tk_nvda),
    )

    # Initial buy: 10 shares @ 100 EUR on Nov 18 (cost = 1000 EUR)
    c_res = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "NVDA",
            "envelope": "CTO",
            "quantity": 10.0,
            "pru": 100.0,
            "currency": "EUR",
            "purchase_date": "2026-11-18",
        },
    )
    assert c_res.status_code == 201
    pos_id = c_res.json()["id"]

    # Reinforce with 1200 EUR @ 120 EUR on Nov 19 => +10 shares, new qty = 20, new PRU = 110 EUR
    r_res = client.post(
        f"/api/portfolio/positions/{pos_id}/reinforce",
        json={
            "amount": 1200.0,
            "price": 120.0,
            "currency": "EUR",
            "purchase_date": "2026-11-19",
            "notes": "Renforcement",
        },
    )
    assert r_res.status_code == 200
    updated = r_res.json()
    assert updated["quantity"] == pytest.approx(20.0)
    assert updated["pru"] == pytest.approx(110.0)
    assert updated["cost_basis_eur"] == pytest.approx(2200.0)
    assert updated["purchase_date"] == "2026-11-18"

    # Real TWR: Nov 18=100 -> Nov 19=120 (+20%, reinforcement treated as EOD inflow) -> Nov 20=132 (+10% on 20 shares => +32% total!)
    perf_res = client.get("/api/portfolio/performance?period=1Y&benchmark=%5EGSPC&currency=EUR&mode=real")
    assert perf_res.status_code == 200
    perf = perf_res.json()
    assert perf["calculation_mode"] == "real"
    assert perf["points"][0]["portfolio_base100"] == pytest.approx(100.0)
    assert perf["points"][1]["portfolio_base100"] == pytest.approx(120.0)
    assert perf["points"][2]["portfolio_base100"] == pytest.approx(132.0)
    assert perf["portfolio_perf_pct"] == pytest.approx(32.0, abs=0.05)


def test_portfolio_performance_avg_alpha_pts(client, monkeypatch):
    # Portfolio outperforms strongly during the year (+40% on mid days), then drops (-5%)
    # while benchmark gains steadily (+5%). Final alpha is negative, but avg_alpha_pts stays positive.
    dates = pd.to_datetime(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"])
    stock_closes = [100.0, 140.0, 140.0, 140.0, 95.0]
    bench_closes = [100.0, 101.0, 102.0, 103.0, 105.0]

    def _make_tk(closes, name, qtype="EQUITY"):
        df = pd.DataFrame(
            {
                "Open": closes,
                "High": closes,
                "Low": closes,
                "Close": closes,
                "Volume": [1_000_000] * len(closes),
                "Stock Splits": [0.0] * len(closes),
            },
            index=dates,
        )
        return SimpleNamespace(
            info={"longName": name, "quoteType": qtype, "currency": "EUR", "currentPrice": closes[-1]},
            fast_info=SimpleNamespace(last_price=closes[-1], previous_close=closes[-1], currency="EUR"),
            history=lambda **kwargs: df,
            quarterly_income_stmt=pd.DataFrame(),
            income_stmt=pd.DataFrame(),
            quarterly_balance_sheet=pd.DataFrame(),
            balance_sheet=pd.DataFrame(),
            quarterly_cashflow=pd.DataFrame(),
            cashflow=pd.DataFrame(),
            dividends=pd.Series(dtype=float),
            earnings_history=None,
            recommendations_summary=None,
        )

    tk_stock = _make_tk(stock_closes, "Alpha Test Corp")
    tk_bench = _make_tk(bench_closes, "S&P 500", "INDEX")
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )

    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else (tk_bench if sym == "^GSPC" else tk_stock),
    )

    created = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "NVDA",
            "envelope": "CTO",
            "quantity": 10.0,
            "pru": 100.0,
            "currency": "EUR",
            "purchase_date": "2026-11-16",
        },
    )
    assert created.status_code == 201

    perf_res = client.get("/api/portfolio/performance?period=1Y&benchmark=%5EGSPC&currency=EUR&mode=real")
    assert perf_res.status_code == 200
    perf = perf_res.json()

    # Final alpha = -5% - (+5%) = -10.0 pts
    assert perf["alpha_pts"] == pytest.approx(-10.0, abs=0.05)
    # Daily diffs excluding t=0: (40-1)=+39, (40-2)=+38, (40-3)=+37, (-5-5)=-10 => mean = 104 / 4 = +26.0 pts
    expected_avg = sum(pt["portfolio_pct"] - pt["benchmark_pct"] for pt in perf["points"][1:]) / (len(perf["points"]) - 1)
    assert perf["avg_alpha_pts"] == pytest.approx(expected_avg, abs=0.02)
    assert perf["avg_alpha_pts"] == pytest.approx(26.0, abs=0.05)


def test_portfolio_performance_cagr_and_periodic_returns(client, monkeypatch):
    # 2 full years of quarterly endpoints from 2024-01-02 to 2026-01-02:
    # Stock: 100 -> 110 -> 121 (+21% over 2 years => exact 10.0%/yr CAGR!)
    # Bench: 1000 -> 1050 -> 1102.5 (+10.25% over 2 years => exact 5.0%/yr CAGR!)
    dates = pd.to_datetime([
        "2024-01-02", "2024-03-29", "2024-06-28", "2024-09-30", "2024-12-31",
        "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-01-02",
    ])
    stock_closes = [100.0, 104.0, 107.0, 108.0, 110.0, 113.0, 116.0, 119.0, 120.5, 121.0]
    bench_closes = [1000.0, 1012.0, 1025.0, 1038.0, 1050.0, 1062.0, 1075.0, 1089.0, 1100.0, 1102.5]

    def _make_tk(closes, name, qtype="EQUITY"):
        df = pd.DataFrame(
            {
                "Open": closes,
                "High": closes,
                "Low": closes,
                "Close": closes,
                "Volume": [1_000_000] * len(closes),
                "Stock Splits": [0.0] * len(closes),
            },
            index=dates,
        )
        return SimpleNamespace(
            info={"longName": name, "quoteType": qtype, "currency": "EUR", "currentPrice": closes[-1]},
            fast_info=SimpleNamespace(last_price=closes[-1], previous_close=closes[-1], currency="EUR"),
            history=lambda **kwargs: df,
            quarterly_income_stmt=pd.DataFrame(),
            income_stmt=pd.DataFrame(),
            quarterly_balance_sheet=pd.DataFrame(),
            balance_sheet=pd.DataFrame(),
            quarterly_cashflow=pd.DataFrame(),
            cashflow=pd.DataFrame(),
            dividends=pd.Series(dtype=float),
            earnings_history=None,
            recommendations_summary=None,
        )

    tk_stock = _make_tk(stock_closes, "Compounding Corp")
    tk_bench = _make_tk(bench_closes, "S&P 500", "INDEX")
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )

    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else (tk_bench if sym == "^GSPC" else tk_stock),
    )

    created = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "NVDA",
            "envelope": "CTO",
            "quantity": 10.0,
            "pru": 100.0,
            "currency": "EUR",
            "purchase_date": "2024-01-02",
        },
    )
    assert created.status_code == 201

    perf_res = client.get("/api/portfolio/performance?period=MAX&benchmark=%5EGSPC&currency=EUR&mode=real")
    assert perf_res.status_code == 200
    perf = perf_res.json()

    assert perf["elapsed_years"] == pytest.approx(2.0, abs=0.02)
    assert perf["portfolio_cagr_pct"] == pytest.approx(10.0, abs=0.2)
    assert perf["benchmark_cagr_pct"] == pytest.approx(5.0, abs=0.2)

    annual_labels = [a["label"] for a in perf["annual_returns"]]
    assert annual_labels == ["2024", "2025", "2026"]
    assert perf["annual_returns"][0]["portfolio_return_pct"] == pytest.approx(10.0, abs=0.1)

    quarterly_labels = [q["label"] for q in perf["quarterly_returns"]]
    assert "T1 2024" in quarterly_labels
    assert "T4 2025" in quarterly_labels
    assert "T1 2026" in quarterly_labels

    # Compounding product of quarterly returns must equal total portfolio return (+21%)
    compounded = 1.0
    for q in perf["quarterly_returns"]:
        compounded *= 1.0 + q["portfolio_return_pct"] / 100.0
    assert (compounded - 1.0) * 100.0 == pytest.approx(perf["portfolio_perf_pct"], abs=0.1)

    # Compounding product of annual returns must also equal total portfolio return (+21%)
    compounded_ann = 1.0
    for a in perf["annual_returns"]:
        compounded_ann *= 1.0 + a["portfolio_return_pct"] / 100.0
    assert (compounded_ann - 1.0) * 100.0 == pytest.approx(perf["portfolio_perf_pct"], abs=0.1)


def test_portfolio_performance_max_avoids_pre_inception_flat_padding(client, monkeypatch):
    # Benchmark history goes back to 2010, un-dated ETF starts in 2020, dated stock starts in 2025-01-02
    bench_dates = pd.to_datetime([
        "2010-01-04", "2015-01-05", "2020-01-02", "2024-01-02", "2025-01-02", "2026-01-02",
    ])
    etf_dates = pd.to_datetime([
        "2020-01-02", "2024-01-02", "2025-01-02", "2026-01-02",
    ])
    stock_dates = pd.to_datetime([
        "2020-01-02", "2024-01-02", "2025-01-02", "2026-01-02",
    ])

    def _make_tk(dts, closes, name, qtype="EQUITY"):
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
        return SimpleNamespace(
            info={"longName": name, "quoteType": qtype, "currency": "EUR", "currentPrice": closes[-1]},
            fast_info=SimpleNamespace(last_price=closes[-1], previous_close=closes[-1], currency="EUR"),
            history=lambda **kwargs: df,
            quarterly_income_stmt=pd.DataFrame(),
            income_stmt=pd.DataFrame(),
            quarterly_balance_sheet=pd.DataFrame(),
            balance_sheet=pd.DataFrame(),
            quarterly_cashflow=pd.DataFrame(),
            cashflow=pd.DataFrame(),
            dividends=pd.Series(dtype=float),
            earnings_history=None,
            recommendations_summary=None,
        )

    tk_bench = _make_tk(bench_dates, [1000.0, 1500.0, 2000.0, 2500.0, 3000.0, 3300.0], "S&P 500", "INDEX")
    # From 2025-01-02 -> 2026-01-02 (1 year), both ETF and stock double (+20%) => exact 20%/yr CAGR!
    tk_etf = _make_tk(etf_dates, [50.0, 80.0, 100.0, 120.0], "Amundi ETF", "ETF")
    tk_stock = _make_tk(stock_dates, [40.0, 75.0, 100.0, 120.0], "NVDA Corp", "EQUITY")
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )

    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx
        if sym == "EURUSD=X"
        else (tk_bench if sym == "^GSPC" else (tk_etf if sym == "PUST.PA" else tk_stock)),
    )

    # ETF has NO purchase_date; Stock has purchase_date=2025-01-02
    assert client.post(
        "/api/portfolio/positions",
        json={"ticker": "PUST.PA", "asset_type": "ETF", "envelope": "PEA", "quantity": 1.0, "pru": 90.0, "currency": "EUR"},
    ).status_code == 201
    assert client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "NVDA",
            "envelope": "CTO",
            "quantity": 1.0,
            "pru": 100.0,
            "currency": "EUR",
            "purchase_date": "2025-01-02",
        },
    ).status_code == 201

    real_res = client.get("/api/portfolio/performance?period=MAX&benchmark=%5EGSPC&currency=EUR&mode=real")
    assert real_res.status_code == 200
    real = real_res.json()
    assert real["points"][0]["date"] == "2025-01-02"
    assert real["elapsed_years"] == pytest.approx(1.0, abs=0.05)
    assert real["portfolio_cagr_pct"] == pytest.approx(20.0, abs=0.5)

    bt_res = client.get("/api/portfolio/performance?period=MAX&benchmark=%5EGSPC&currency=EUR&mode=backtest")
    assert bt_res.status_code == 200
    bt = bt_res.json()
    # Backtest must start at common asset inception (2020-01-02), NOT benchmark start (2010-01-04)
    assert bt["points"][0]["date"] == "2020-01-02"
    assert bt["elapsed_years"] == pytest.approx(6.0, abs=0.1)


