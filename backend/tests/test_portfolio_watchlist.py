import json
from types import SimpleNamespace

import pandas as pd
import pytest

from tests.test_api_phase1 import _build_mock_equity_ticker, _build_mock_etf_ticker


def _setup_mock_market(monkeypatch):
    mock_eq = _build_mock_equity_ticker("NVDA")
    mock_etf = _build_mock_etf_ticker()
    mock_fx = SimpleNamespace(
        fast_info=SimpleNamespace(last_price=1.10),
        history=lambda **kwargs: pd.DataFrame({"Close": [1.10]}),
    )

    def fake_ticker(sym: str):
        if sym == "EURUSD=X":
            return mock_fx
        if sym == "CW8.PA":
            return mock_etf
        return mock_eq

    monkeypatch.setattr("app.services.market_data.yf.Ticker", fake_ticker)


def test_portfolio_crud_and_validation(client, monkeypatch):
    _setup_mock_market(monkeypatch)

    # Empty portfolio initially
    empty = client.get("/api/portfolio")
    assert empty.status_code == 200
    assert empty.json()["stats"]["positions_count"] == 0

    # Validation error when neither (qty+pru) nor invested_amount provided
    bad = client.post(
        "/api/portfolio/positions",
        json={"ticker": "NVDA", "envelope": "CTO"},
    )
    assert bad.status_code == 422

    # Create position with quantity + pru
    created = client.post(
        "/api/portfolio/positions",
        json={
            "ticker": "NVDA",
            "envelope": "CTO",
            "quantity": 10,
            "pru": 110.0,
            "currency": "USD",
            "notes": "AI leader",
        },
    )
    assert created.status_code == 201
    pos = created.json()
    assert pos["ticker"] == "NVDA"
    assert pos["envelope"] == "CTO"
    assert pos["current_value_eur"] == pytest.approx(2000.0 / 1.10, rel=1e-2)
    assert pos["pnl_eur"] > 0

    # Update to invested_amount mode
    updated = client.put(
        f"/api/portfolio/positions/{pos['id']}",
        json={"invested_amount": 1500.0, "clear_quantity_pru": True, "currency": "EUR"},
    )
    assert updated.status_code == 200
    assert updated.json()["quantity"] is None
    assert updated.json()["current_value_eur"] == pytest.approx(1500.0, rel=1e-2)

    # Delete
    deleted = client.delete(f"/api/portfolio/positions/{pos['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True


def test_portfolio_equities_only_weighted_stats_and_donuts(client, monkeypatch):
    _setup_mock_market(monkeypatch)

    # NVDA price = 200 USD, EURUSD = 1.10 => 1 share = 181.818 EUR
    # Buy 7.7 shares of NVDA => 7.7 * 200 / 1.10 = 1400 EUR (70% weight)
    # CW8.PA price = 560 EUR => buy 1.07142857 shares => 600 EUR (30% weight)
    res1 = client.post(
        "/api/portfolio/positions",
        json={"ticker": "NVDA", "envelope": "CTO", "quantity": 7.7, "pru": 150.0, "currency": "USD"},
    )
    assert res1.status_code == 201

    res2 = client.post(
        "/api/portfolio/positions",
        json={"ticker": "CW8.PA", "envelope": "PEA", "quantity": 600.0 / 560.0, "pru": 500.0, "currency": "EUR"},
    )
    assert res2.status_code == 201

    dash_res = client.get("/api/portfolio")
    assert dash_res.status_code == 200
    dash = dash_res.json()
    json.dumps(dash, allow_nan=False)

    stats = dash["stats"]
    assert stats["positions_count"] == 2
    assert stats["equities_count"] == 1
    assert stats["etfs_count"] == 1
    assert stats["equities_weight_pct"] == pytest.approx(70.0, abs=0.2)
    assert stats["etfs_weight_pct"] == pytest.approx(30.0, abs=0.2)
    assert stats["top5_weight_pct"] == pytest.approx(100.0, abs=0.1)

    # Donuts sum to ~100%
    assert sum(s["weight_pct"] for s in dash["donuts"]["by_position"]) == pytest.approx(100.0, abs=0.2)
    assert sum(s["weight_pct"] for s in dash["donuts"]["by_envelope"]) == pytest.approx(100.0, abs=0.2)
    assert sum(s["weight_pct"] for s in dash["donuts"]["by_sector"]) == pytest.approx(100.0, abs=0.2)

    # Equities-only stats match NVDA (not diluted by CW8.PA)
    assert stats["pe"] == pytest.approx(50.0, rel=1e-2)
    assert stats["gross_margin"] == pytest.approx(98.0 / 130.0, rel=1e-2)
    assert stats["net_margin"] == pytest.approx(72.0 / 130.0, rel=1e-2)
    assert stats["avg_score_global"] is not None


def test_watchlist_crud_cross_currency_alert_and_delete_by_ticker(client, monkeypatch):
    _setup_mock_market(monkeypatch)

    # NVDA price = 200 USD (~181.82 EUR at 1.10). Target = 190 EUR -> Alert triggered!
    add_nvda = client.post(
        "/api/watchlist",
        json={"ticker": "NVDA", "target_price": 190.0, "target_currency": "EUR", "notes": "Watch"},
    )
    assert add_nvda.status_code == 201
    assert add_nvda.json()["alert_triggered"] is True

    # CW8.PA price = 560 EUR. Target = 500 EUR -> Not triggered
    add_cw8 = client.post(
        "/api/watchlist",
        json={"ticker": "CW8.PA", "target_price": 500.0, "target_currency": "EUR"},
    )
    assert add_cw8.status_code == 201
    assert add_cw8.json()["alert_triggered"] is False

    wl = client.get("/api/watchlist")
    assert wl.status_code == 200
    data = wl.json()
    json.dumps(data, allow_nan=False)
    assert data["alerts_count"] == 1
    assert data["items"][0]["ticker"] == "NVDA"  # Alerted item sorted first

    # Update NVDA target below current price (150 USD < 200 USD) -> no longer triggered
    upd = client.put(
        f"/api/watchlist/{add_nvda.json()['id']}",
        json={"target_price": 150.0, "target_currency": "USD"},
    )
    assert upd.status_code == 200
    assert upd.json()["alert_triggered"] is False

    # Delete by ticker
    del_by_t = client.delete("/api/watchlist/by-ticker/NVDA")
    assert del_by_t.status_code == 200
    assert del_by_t.json()["ticker"] == "NVDA"
