import json

from app.db.models import Asset
from app.services.screener_service import screener_seed_manager
from tests.test_api_phase1 import _build_mock_equity_ticker, _build_mock_etf_ticker


def _populate_synthetic_scores(db_session):
    updates = {
        "NVDA": {
            "price": 125.0,
            "pe": 22.0,
            "rev_growth_1y": 0.45,
            "net_margin": 0.50,
            "net_debt_ebitda": -0.5,
            "score_global": 91.0,
            "score_valuation": 78.0,
            "score_growth": 92.0,
            "score_quality": 95.0,
            "score_health": 98.0,
        },
        "ASML.AS": {
            "price": 850.0,
            "pe": 28.0,
            "rev_growth_1y": 0.18,
            "net_margin": 0.28,
            "net_debt_ebitda": 0.2,
            "score_global": 84.0,
            "score_valuation": 66.0,
            "score_growth": 75.0,
            "score_quality": 90.0,
            "score_health": 88.0,
        },
        "MC.PA": {
            "price": 620.0,
            "pe": 21.0,
            "rev_growth_1y": 0.04,
            "net_margin": 0.17,
            "net_debt_ebitda": 0.8,
            "score_global": 76.0,
            "score_valuation": 68.0,
            "score_growth": 48.0,
            "score_quality": 82.0,
            "score_health": 80.0,
        },
        "PLTR": {
            "price": 65.0,
            "pe": 120.0,
            "rev_growth_1y": 0.30,
            "net_margin": 0.18,
            "net_debt_ebitda": 2.4,
            "score_global": 62.0,
            "score_valuation": 20.0,
            "score_growth": 85.0,
            "score_quality": 65.0,
            "score_health": 62.0,
        },
        "CW8.PA": {
            "price": 560.0,
            "pe": None,
            "rev_growth_1y": None,
            "net_margin": None,
            "net_debt_ebitda": None,
            "score_global": 72.0,
            "score_valuation": 73.0,
            "score_growth": 74.0,
            "score_quality": None,
            "score_health": 66.0,
        },
    }
    for sym, vals in updates.items():
        asset = db_session.get(Asset, sym)
        assert asset is not None
        for k, v in vals.items():
            setattr(asset, k, v)
    db_session.commit()


def test_screener_filters_presets_and_sorting(client, db_session):
    _populate_synthetic_scores(db_session)

    # Default call: returns full universe sorted by score_global desc with nullslast
    res = client.get("/api/screener?page_size=20")
    assert res.status_code == 200
    data = res.json()
    json.dumps(data, allow_nan=False)
    assert data["universe_count"] >= 70
    assert data["scored_count"] == 5
    assert data["items"][0]["ticker"] == "NVDA"
    assert len(data["sectors"]) >= 5

    # Preset 1: quality_on_sale (quality >= 70 & val >= 60 & EQUITY)
    p1 = client.get("/api/screener?preset=quality_on_sale").json()
    tickers_p1 = [i["ticker"] for i in p1["items"]]
    assert set(tickers_p1) == {"NVDA", "ASML.AS", "MC.PA"}

    # Preset 2: profitable_hypergrowth (growth >= 70, quality >= 60, rev >= 15%)
    p2 = client.get("/api/screener?preset=profitable_hypergrowth").json()
    tickers_p2 = [i["ticker"] for i in p2["items"]]
    assert set(tickers_p2) == {"NVDA", "ASML.AS", "PLTR"}

    # Preset 3: financial_fortresses (health >= 75, quality >= 65, debt/ebitda <= 1.0)
    p3 = client.get("/api/screener?preset=financial_fortresses").json()
    tickers_p3 = [i["ticker"] for i in p3["items"]]
    assert set(tickers_p3) == {"NVDA", "ASML.AS", "MC.PA"}

    # Preset 4: pea_eligible
    p4 = client.get("/api/screener?preset=pea_eligible&only_scored=true").json()
    tickers_p4 = [i["ticker"] for i in p4["items"]]
    assert set(tickers_p4) == {"ASML.AS", "MC.PA", "CW8.PA"}

    # Combined filters + ascending PE sorting (nullslast)
    comb = client.get(
        "/api/screener?region=EU&only_scored=true&max_pe=30&sort_by=pe&sort_dir=asc"
    ).json()
    assert [i["ticker"] for i in comb["items"]] == ["MC.PA", "ASML.AS"]


def test_screener_background_batched_seed(client, db_session, monkeypatch):
    screener_seed_manager.reset_status()
    mock_eq = _build_mock_equity_ticker("AAPL")
    mock_etf = _build_mock_etf_ticker()

    def fake_ticker(sym: str):
        return mock_etf if sym in {"CW8.PA", "ESE.PA", "SPY", "QQQ", "VWCE.DE"} else mock_eq

    monkeypatch.setattr("app.services.market_data.yf.Ticker", fake_ticker)

    try:
        start_res = client.post(
            "/api/screener/seed",
            json={"only_missing": True, "batch_size": 2, "delay_seconds": 0.0, "limit": 3},
        )
        assert start_res.status_code == 202

        # Starlette TestClient executes BackgroundTasks synchronously before returning
        status_res = client.get("/api/screener/seed/status")
        assert status_res.status_code == 200
        st = status_res.json()
        assert st["status"] == "completed"
        assert st["total"] == 3
        assert st["processed"] == 3
        assert st["succeeded"] == 3
        assert st["total_batches"] == 2
        assert st["progress_pct"] == 100.0

        # DB must now have 3 scored assets
        scored = client.get("/api/screener?only_scored=true").json()
        assert scored["scored_count"] == 3
    finally:
        screener_seed_manager.reset_status()
