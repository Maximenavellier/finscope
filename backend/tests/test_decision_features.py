from datetime import timedelta
from types import SimpleNamespace

import pandas as pd
import pytest

from app.db.models import PortfolioLot, PortfolioPosition, PortfolioSale, WatchlistItem
from app.services.decision_engine import (
    compute_dca_plan,
    detect_red_flags,
    simulate_wealth_projection,
)
from app.utils.math_utils import utc_now


def _mock_equity_ticker(name: str, price: float, high_52w: float, next_earn_ts: float):
    dates = pd.date_range("2025-11-01", periods=10, freq="B")
    hist = pd.DataFrame(
        {
            "Open": [price] * len(dates),
            "High": [high_52w] * len(dates),
            "Low": [price * 0.9] * len(dates),
            "Close": [price] * len(dates),
            "Volume": [1_000_000] * len(dates),
            "Stock Splits": [0.0] * len(dates),
        },
        index=dates,
    )
    inc = pd.DataFrame(
        {
            "2023-12-31": [1000.0, 600.0, 250.0, 200.0, 300.0, 2.0, 100.0],
            "2024-12-31": [1100.0, 650.0, 220.0, 180.0, 280.0, 1.8, 105.0],
            "2025-12-31": [1200.0, 700.0, 180.0, 150.0, 250.0, 1.5, 112.0],
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
        {
            "2023-12-31": [100.0, 300.0, 1000.0, 100.0],
            "2024-12-31": [100.0, 600.0, 1100.0, 105.0],
            "2025-12-31": [100.0, 1100.0, 1200.0, 112.0],
        },
        index=[
            "Cash And Cash Equivalents",
            "Total Debt",
            "Stockholders Equity",
            "Ordinary Shares Number",
        ],
    )
    cf = pd.DataFrame(
        {
            "2023-12-31": [180.0, -30.0, 150.0],
            "2024-12-31": [140.0, -40.0, 100.0],
            "2025-12-31": [10.0, -50.0, -40.0],
        },
        index=[
            "Operating Cash Flow",
            "Capital Expenditure",
            "Free Cash Flow",
        ],
    )
    return SimpleNamespace(
        info={
            "longName": name,
            "quoteType": "EQUITY",
            "currency": "USD",
            "sector": "Technology",
            "industry": "Software - Infrastructure",
            "currentPrice": price,
            "previousClose": price,
            "fiftyTwoWeekHigh": high_52w,
            "fiftyTwoWeekLow": price * 0.7,
            "marketCap": price * 112.0,
            "sharesOutstanding": 112.0,
            "earningsTimestampStart": next_earn_ts,
        },
        fast_info=SimpleNamespace(last_price=price, previous_close=price, currency="USD"),
        history=lambda **kwargs: hist,
        financials=inc,
        balance_sheet=bs,
        cashflow=cf,
        quarterly_financials=pd.DataFrame(),
        quarterly_balance_sheet=pd.DataFrame(),
        quarterly_cashflow=pd.DataFrame(),
        dividends=pd.Series(dtype=float),
        earnings_history=None,
        recommendations_summary=None,
    )


def test_detect_red_flags_rules_and_financial_exemption():
    # All 4 alerts triggered on a leveraged, diluting, cash-burning, margin-eroding industrial company
    flagged = detect_red_flags(
        {"asset_type": "EQUITY", "sector": "Industrials", "industry": "Aerospace"},
        {
            "annual": [
                {"fiscal_year": 2023, "shares_outstanding": 100.0, "op_margin": 0.25, "net_income": 100.0, "free_cash_flow": 90.0},
                {"fiscal_year": 2024, "shares_outstanding": 106.0, "op_margin": 0.20, "net_income": 90.0, "free_cash_flow": 50.0},
                {"fiscal_year": 2025, "shares_outstanding": 115.0, "op_margin": 0.14, "net_income": 80.0, "free_cash_flow": -25.0, "net_debt_ebitda": 4.2},
            ],
            "ttm": {"net_income": 80.0, "free_cash_flow": -25.0, "net_debt_ebitda": 4.2},
        },
    )
    ids = {a["id"] for a in flagged}
    assert ids == {"dilution", "earnings_quality", "high_debt", "margin_erosion"}

    # Banks / insurers should be exempted from high_debt leverage red flag
    bank_flags = detect_red_flags(
        {"asset_type": "EQUITY", "sector": "Financial Services", "industry": "Banks - Diversified"},
        {
            "annual": [
                {"fiscal_year": 2025, "net_income": 500.0, "free_cash_flow": 500.0, "net_debt_ebitda": 8.0, "op_margin": 0.30},
            ],
            "ttm": None,
        },
    )
    assert [a["id"] for a in bank_flags] == []

    # Clean ETF and clean Equity return zero red flags
    assert detect_red_flags({"asset_type": "ETF"}, {"annual": []}) == []
    clean = detect_red_flags(
        {"asset_type": "EQUITY", "sector": "Technology", "industry": "Semiconductors"},
        {
            "annual": [
                {"fiscal_year": 2023, "shares_outstanding": 100.0, "op_margin": 0.30, "net_income": 100.0, "free_cash_flow": 110.0},
                {"fiscal_year": 2024, "shares_outstanding": 98.0, "op_margin": 0.35, "net_income": 120.0, "free_cash_flow": 130.0},
                {"fiscal_year": 2025, "shares_outstanding": 96.0, "op_margin": 0.40, "net_income": 150.0, "free_cash_flow": 160.0, "net_debt_ebitda": -0.5},
            ],
            "ttm": {"net_income": 150.0, "free_cash_flow": 160.0, "net_debt_ebitda": -0.5},
        },
    )
    assert clean == []


def test_overview_endpoint_returns_red_flags_and_next_earnings(client, monkeypatch):
    earn_dt = (utc_now() + timedelta(days=7)).replace(hour=12, minute=0, second=0, microsecond=0)
    tk = _mock_equity_ticker("Flagged Soft", price=20.0, high_52w=30.0, next_earn_ts=earn_dt.timestamp())
    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: tk)

    res = client.get("/api/stocks/MSFT/overview?refresh=true")
    assert res.status_code == 200
    body = res.json()
    assert body["info"]["next_earnings_date"] == earn_dt.date().isoformat()
    assert 6 <= body["info"]["days_until_earnings"] <= 7
    flag_ids = {f["id"] for f in body["red_flags"]}
    assert "dilution" in flag_ids
    assert "earnings_quality" in flag_ids
    assert "high_debt" in flag_ids
    assert "margin_erosion" in flag_ids


def test_dca_assistant_standard_and_opportunistic_modes(client):
    # Portfolio overweight in ETFs (900 EUR ETF vs 100 EUR Equity; target 70/30)
    positions = [
        {"ticker": "CW8.PA", "name": "Amundi MSCI World", "asset_type": "ETF", "envelope": "PEA", "current_value_eur": 900.0, "score_global": 70.0},
        {"ticker": "NVDA", "name": "NVIDIA", "asset_type": "EQUITY", "envelope": "CTO", "current_value_eur": 100.0, "score_global": 85.0, "margin_of_safety_pct": 40.0},
    ]

    # Standard rebalancing should allocate 100% of 400 EUR to Equities (since 70/30 on 1400 EUR wants 980 ETF & 420 Eq)
    std = compute_dca_plan(400.0, 70.0, "standard", positions, [])
    assert std["opportunistic_triggered"] is False
    assert sum(l["amount_eur"] for l in std["lines"]) == pytest.approx(400.0, abs=0.01)
    assert std["equities_budget_eur"] > std["etf_budget_eur"]

    # Balanced portfolio (700 EUR ETF vs 300 EUR Equity): Standard splits 70/30 -> 280 ETF / 120 Eq
    balanced_positions = [
        {"ticker": "CW8.PA", "name": "Amundi MSCI World", "asset_type": "ETF", "envelope": "PEA", "current_value_eur": 700.0, "score_global": 70.0},
        {"ticker": "MSFT", "name": "Microsoft", "asset_type": "EQUITY", "envelope": "CTO", "current_value_eur": 300.0, "score_global": 82.0, "margin_of_safety_pct": 5.0},
    ]
    wl_bargain = [
        {"ticker": "NVDA", "name": "NVIDIA", "asset_type": "EQUITY", "pea_eligible": False, "score_global": 88.0, "margin_of_safety_pct": 45.0}
    ]
    std_bal = compute_dca_plan(1000.0, 70.0, "standard", balanced_positions, wl_bargain)
    assert std_bal["etf_budget_eur"] == pytest.approx(700.0, abs=0.01)
    assert std_bal["equities_budget_eur"] == pytest.approx(300.0, abs=0.01)

    # Opportunistic mode shifts 30% of cash from ETF to discounted NVDA -> 400 ETF / 600 Eq!
    opp = compute_dca_plan(1000.0, 70.0, "opportunistic", balanced_positions, wl_bargain)
    assert opp["opportunistic_triggered"] is True
    assert opp["etf_budget_eur"] == pytest.approx(400.0, abs=0.01)
    assert opp["equities_budget_eur"] == pytest.approx(600.0, abs=0.01)
    assert sum(l["amount_eur"] for l in opp["lines"]) == pytest.approx(1000.0, abs=0.01)
    assert any("NVDA" in msg for msg in opp["explanations"])
    assert opp["lines"][1]["ticker"] == "NVDA"

    # Settings persistence via API
    put_res = client.put(
        "/api/portfolio/dca/settings",
        json={"monthly_amount_eur": 600.0, "etf_target_pct": 80.0, "equities_target_pct": 20.0, "default_mode": "opportunistic"},
    )
    assert put_res.status_code == 200
    get_res = client.get("/api/portfolio/dca/settings")
    assert get_res.status_code == 200
    assert get_res.json()["monthly_amount_eur"] == pytest.approx(600.0)
    assert get_res.json()["etf_target_pct"] == pytest.approx(80.0)

    # All 6 held positions (3 ETFs + 3 Equities) must appear in Standard DCA allocation lines
    six_positions = [
        {"ticker": "PUST.PA", "name": "Nasdaq PEA", "asset_type": "ETF", "envelope": "PEA", "current_value_eur": 284.64, "score_global": 75.0},
        {"ticker": "ESE.PA", "name": "S&P 500 PEA", "asset_type": "ETF", "envelope": "PEA", "current_value_eur": 131.72, "score_global": 73.0},
        {"ticker": "18MH.DU", "name": "EM PEA", "asset_type": "ETF", "envelope": "PEA", "current_value_eur": 126.24, "score_global": None},
        {"ticker": "NVDA", "name": "NVIDIA", "asset_type": "EQUITY", "envelope": "CTO", "current_value_eur": 109.89, "score_global": 96.0, "margin_of_safety_pct": 46.0},
        {"ticker": "ZS", "name": "Zscaler", "asset_type": "EQUITY", "envelope": "CTO", "current_value_eur": 100.02, "score_global": 72.0, "margin_of_safety_pct": 7.0},
        {"ticker": "LLY", "name": "Eli Lilly", "asset_type": "EQUITY", "envelope": "CTO", "current_value_eur": 97.92, "score_global": 78.0, "margin_of_safety_pct": -5.0},
    ]
    all_six = compute_dca_plan(20000.0, 70.0, "standard", six_positions, [])
    assert [l["ticker"] for l in all_six["lines"]] == ["PUST.PA", "ESE.PA", "18MH.DU", "NVDA", "LLY", "ZS"] or {
        l["ticker"] for l in all_six["lines"]
    } == {"PUST.PA", "ESE.PA", "18MH.DU", "NVDA", "ZS", "LLY"}
    assert sum(l["amount_eur"] for l in all_six["lines"]) == pytest.approx(20000.0, abs=0.01)


def test_pea_150k_cap_projection_simulator(client):
    # Start with 140 000 EUR PEA contributions, contribute 1000 EUR/month at 100% PEA -> hits 150k cap in year 1 (after 10 months),
    # then remaining 2 months + all years 2..10 go 100% to CTO!
    sim = simulate_wealth_projection(
        initial_pea_value=160_000.0,
        initial_pea_contributions=140_000.0,
        initial_cto_value=0.0,
        initial_cto_contributions=0.0,
        monthly_contribution=1000.0,
        pea_share_pct=100.0,
        annual_return_pct=8.0,
        horizon_years=10,
        inflation_pct=2.0,
        pea_tax_rate_pct=18.6,
        cto_tax_rate_pct=31.4,
        pea_cap_eur=150_000.0,
        index_contributions_to_inflation=False,
        base_year=2026,
    )
    assert sim["pea_cap_reached_year"] == 1
    assert sim["pea_cap_reached_calendar_year"] == 2027
    final_pt = sim["points"][-1]
    assert final_pt["pea_contributed_eur"] == pytest.approx(150_000.0, abs=0.01)
    # Total new contributions over 10y = 120 000 EUR -> 10 000 to PEA, 110 000 to CTO
    assert final_pt["cto_contributed_eur"] == pytest.approx(110_000.0, abs=0.01)
    assert final_pt["contributed_eur"] == pytest.approx(260_000.0, abs=0.01)
    assert sim["final_gross_eur"] > sim["final_net_eur"] > sim["final_net_real_eur"]
    assert sim["monthly_rent_4pct_net_eur"] == pytest.approx(sim["final_net_eur"] * 0.04 / 12.0, abs=0.05)

    # Inflation-indexed contributions: monthly effort rises each year by +2%, capping PEA strictly at 150k EUR
    sim_idx = simulate_wealth_projection(
        initial_pea_value=140_000.0,
        initial_pea_contributions=140_000.0,
        initial_cto_value=0.0,
        initial_cto_contributions=0.0,
        monthly_contribution=1000.0,
        pea_share_pct=100.0,
        annual_return_pct=8.0,
        horizon_years=10,
        inflation_pct=2.0,
        pea_tax_rate_pct=18.6,
        cto_tax_rate_pct=31.4,
        pea_cap_eur=150_000.0,
        index_contributions_to_inflation=True,
        base_year=2026,
    )
    expected_new_contribs = sum(12.0 * 1000.0 * (1.02 ** (yr - 1)) for yr in range(1, 11))
    assert sim_idx["final_monthly_contribution_eur"] == pytest.approx(1000.0 * (1.02 ** 9), abs=0.05)
    assert sim_idx["final_monthly_contribution_real_eur"] == pytest.approx(1000.0, abs=0.05)
    assert sim_idx["points"][-1]["pea_contributed_eur"] == pytest.approx(150_000.0, abs=0.01)
    assert sim_idx["final_contributed_eur"] == pytest.approx(140_000.0 + expected_new_contribs, abs=1.0)
    assert sim_idx["final_gross_eur"] > sim["final_gross_eur"] or sim_idx["final_contributed_eur"] > 260_000.0

    # Inflation (2%) + Career progression (2%) => 4%/yr nominal growth, strict 150k PEA cap intact
    sim_career = simulate_wealth_projection(
        initial_pea_value=140_000.0,
        initial_pea_contributions=140_000.0,
        initial_cto_value=0.0,
        initial_cto_contributions=0.0,
        monthly_contribution=500.0,
        pea_share_pct=100.0,
        annual_return_pct=8.0,
        horizon_years=40,
        inflation_pct=2.0,
        pea_tax_rate_pct=18.6,
        cto_tax_rate_pct=31.4,
        pea_cap_eur=150_000.0,
        index_contributions_to_inflation=True,
        career_growth_pct=2.0,
        base_year=2026,
    )
    expected_nominal_yr40 = 500.0 * (1.04 ** 39)
    expected_real_yr40 = expected_nominal_yr40 / (1.02 ** 39)
    assert sim_career["career_growth_pct"] == pytest.approx(2.0)
    assert sim_career["final_monthly_contribution_eur"] == pytest.approx(expected_nominal_yr40, abs=0.5)
    assert sim_career["final_monthly_contribution_real_eur"] == pytest.approx(expected_real_yr40, abs=0.5)
    assert sim_career["points"][-1]["pea_contributed_eur"] == pytest.approx(150_000.0, abs=0.01)

    # Endpoint sanity check
    api_res = client.post(
        "/api/portfolio/projections",
        json={
            "initial_pea_value": 5000.0,
            "initial_pea_contributions": 5000.0,
            "initial_cto_value": 2000.0,
            "initial_cto_contributions": 2000.0,
            "monthly_contribution": 500.0,
            "pea_share_pct": 70.0,
            "annual_return_pct": 8.0,
            "horizon_years": 15,
            "inflation_pct": 2.0,
            "pea_tax_rate_pct": 18.6,
            "cto_tax_rate_pct": 31.4,
        },
    )
    assert api_res.status_code == 200
    assert len(api_res.json()["points"]) == 16


def test_opportunity_radar_csv_export_and_json_backup_restore(client, db_session, monkeypatch):
    earn_dt = (utc_now() + timedelta(days=5)).replace(hour=12, minute=0, second=0, microsecond=0)
    tk_nvda = _mock_equity_ticker("NVIDIA", price=120.0, high_52w=150.0, next_earn_ts=earn_dt.timestamp())
    tk_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.0),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.0]}),
    )
    monkeypatch.setattr(
        "app.services.market_data.yf.Ticker",
        lambda sym: tk_fx if sym == "EURUSD=X" else tk_nvda,
    )

    pos = PortfolioPosition(
        ticker="NVDA",
        asset_type="EQUITY",
        envelope="CTO",
        quantity=10.0,
        pru=100.0,
        currency="EUR",
        purchase_date="2026-01-10",
    )
    db_session.add(pos)
    db_session.flush()
    db_session.add(
        PortfolioLot(
            position_id=pos.id,
            ticker="NVDA",
            quantity_added=4.0,
            price_input=110.0,
            currency="EUR",
            price_eur=110.0,
            amount_eur=440.0,
            tx_date="2026-02-01",
        )
    )
    db_session.add(
        PortfolioSale(
            ticker="MSFT",
            name="Microsoft",
            asset_type="EQUITY",
            envelope="CTO",
            quantity_sold=2.0,
            pru_eur=300.0,
            sell_price_eur=350.0,
            sell_price_input=350.0,
            sell_currency="EUR",
            proceeds_eur=700.0,
            cost_basis_eur=600.0,
            realized_pnl_eur=100.0,
            realized_pnl_pct=16.67,
            sale_date="2026-03-01",
            is_full_sale=True,
        )
    )
    db_session.add(WatchlistItem(ticker="ASML.AS", target_price=600.0, target_currency="EUR"))
    db_session.commit()

    # 1. Opportunity Radar
    radar_res = client.get("/api/portfolio/radar?refresh=true")
    assert radar_res.status_code == 200
    radar = radar_res.json()
    tickers = {i["ticker"] for i in radar["items"]}
    assert {"NVDA", "ASML.AS"}.issubset(tickers)
    assert len(radar["upcoming_earnings"]) >= 1

    # 2. CSV Exports
    csv_pos = client.get("/api/portfolio/export/csv?kind=positions")
    assert csv_pos.status_code == 200
    assert "Ticker;Nom;Type" in csv_pos.text
    assert "NVDA;" in csv_pos.text

    csv_sales = client.get("/api/portfolio/export/csv?kind=sales")
    assert csv_sales.status_code == 200
    assert "Date de vente;Ticker" in csv_sales.text
    assert "MSFT;" in csv_sales.text

    # 3. Full Backup & Restore round-trip
    backup_res = client.get("/api/portfolio/backup")
    assert backup_res.status_code == 200
    backup = backup_res.json()
    assert len(backup["positions"]) == 1
    assert len(backup["lots"]) == 1
    assert len(backup["sales"]) == 1
    assert len(backup["watchlist"]) == 1

    restore_res = client.post("/api/portfolio/restore", json=backup)
    assert restore_res.status_code == 200
    restored_stats = restore_res.json()
    assert restored_stats["restored"] is True
    assert restored_stats["positions_count"] == 1
    assert restored_stats["lots_count"] == 1
    assert restored_stats["sales_count"] == 1
    assert restored_stats["watchlist_count"] == 1

    # Verify remapped lot still links cleanly to the newly created position id
    new_pos = db_session.query(PortfolioPosition).first()
    new_lot = db_session.query(PortfolioLot).first()
    assert new_pos is not None and new_lot is not None
    assert new_lot.position_id == new_pos.id


def test_dynamic_fx_rate_endpoint_subunits_and_stock_eur_estimate(client, monkeypatch):
    def fake_pair_rate(sym: str):
        if sym == "EURUSD=X":
            return SimpleNamespace(fast_info=SimpleNamespace(last_price=1.10), history=lambda **k: pd.DataFrame())
        if sym == "CHFEUR=X":
            return SimpleNamespace(fast_info=SimpleNamespace(last_price=1.07), history=lambda **k: pd.DataFrame())
        if sym == "GBPEUR=X":
            return SimpleNamespace(fast_info=SimpleNamespace(last_price=1.20), history=lambda **k: pd.DataFrame())
        if sym == "EURDKK=X":
            # Inverse pair fallback: 1 EUR = 7.45 DKK => 1 DKK -> EUR = 1 / 7.45
            return SimpleNamespace(fast_info=SimpleNamespace(last_price=7.45), history=lambda **k: pd.DataFrame())
        if sym == "NOVO-B.CO":
            df = pd.DataFrame({"Close": [372.5, 372.5]}, index=pd.to_datetime(["2026-11-19", "2026-11-20"]))
            return SimpleNamespace(
                info={
                    "longName": "Novo Nordisk",
                    "quoteType": "EQUITY",
                    "currency": "DKK",
                    "currentPrice": 372.5,
                    "previousClose": 372.5,
                },
                fast_info=SimpleNamespace(last_price=372.5, previous_close=372.5, currency="DKK"),
                history=lambda **k: df,
            )
        return SimpleNamespace(fast_info=SimpleNamespace(last_price=None), history=lambda **k: pd.DataFrame())

    monkeypatch.setattr("app.services.market_data.yf.Ticker", fake_pair_rate)

    # 1. Direct CHF -> EUR
    r_chf = client.get("/api/fx/rate?from=CHF&to=EUR&refresh=true")
    assert r_chf.status_code == 200
    assert r_chf.json()["rate"] == pytest.approx(1.07, abs=0.001)
    assert r_chf.json()["fallback"] is False

    # 2. Sub-unit GBp (pence) -> EUR must scale by 0.01
    r_gbp = client.get("/api/fx/rate?from=GBp&to=EUR&refresh=true")
    assert r_gbp.status_code == 200
    assert r_gbp.json()["rate"] == pytest.approx(0.012, abs=0.0002)

    # 3. Inverse pair DKK -> EUR via EURDKK=X
    r_dkk = client.get("/api/fx/rate?from=DKK&to=EUR&refresh=true")
    assert r_dkk.status_code == 200
    assert r_dkk.json()["rate"] == pytest.approx(1.0 / 7.45, abs=0.001)

    # 4. Quote endpoint populates fx_to_eur_rate and price_eur for foreign DKK stock
    r_info = client.get("/api/stocks/NOVO-B.CO/info?refresh=true")
    assert r_info.status_code == 200
    info = r_info.json()
    assert info["currency"] == "DKK"
    assert info["fx_to_eur_rate"] == pytest.approx(1.0 / 7.45, abs=0.001)
    assert info["price_eur"] == pytest.approx(372.5 / 7.45, abs=0.1)
