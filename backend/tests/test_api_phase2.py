import json

import pytest

from app.db.models import Asset
from tests.test_api_phase1 import _build_mock_equity_ticker, _build_mock_etf_ticker


def test_overview_equity_and_etf_and_persists_scores(client, db_session, monkeypatch):
    mock_eq = _build_mock_equity_ticker("NVDA")
    mock_etf = _build_mock_etf_ticker()

    def fake_ticker(sym: str):
        return mock_etf if sym == "CW8.PA" else mock_eq

    monkeypatch.setattr("app.services.market_data.yf.Ticker", fake_ticker)

    res_eq = client.get("/api/stocks/NVDA/overview")
    assert res_eq.status_code == 200
    body = res_eq.json()
    assert body["info"]["ticker"] == "NVDA"
    assert body["scores"]["mode"] == "EQUITY"
    assert body["scores"]["global"]["score"] is not None
    assert body["scores"]["valuation"]["score"] is not None
    assert body["scores"]["growth"]["score"] is not None
    assert body["scores"]["quality"]["score"] is not None
    assert body["scores"]["health"]["score"] is not None
    assert body["fair_value"]["available"] is True
    json.dumps(body, allow_nan=False)

    # Asset table must now have persisted scores for Screener / Portfolio
    asset = db_session.get(Asset, "NVDA")
    assert asset is not None
    assert asset.score_global == pytest.approx(body["scores"]["global"]["score"])

    # ETF overview
    res_etf = client.get("/api/stocks/CW8.PA/overview")
    assert res_etf.status_code == 200
    etf_body = res_etf.json()
    assert etf_body["scores"]["mode"] == "ETF"
    assert etf_body["scores"]["global"]["score"] is not None
    assert etf_body["scores"]["valuation"]["label"] == "Frais (TER)"
    assert etf_body["fair_value"]["available"] is False


def test_fair_value_post_endpoint(client, monkeypatch):
    mock_eq = _build_mock_equity_ticker("NVDA")
    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: mock_eq)

    res = client.post(
        "/api/stocks/NVDA/fair-value",
        json={
            "expected_growth_pct": 15.0,
            "exit_multiple": 25.0,
            "required_return_pct": 10.0,
            "horizon_years": 5,
            "metric_used": "EPS",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["available"] is True
    assert data["metric_used"] == "EPS"
    assert data["fair_value"] is not None
    assert data["verdict"] in {"Sous-évaluée", "Proche du prix juste", "Surévaluée"}


def test_peers_and_overrides_endpoints(client, monkeypatch):
    mock_eq = _build_mock_equity_ticker("NVDA")
    monkeypatch.setattr("app.services.market_data.yf.Ticker", lambda sym: mock_eq)

    # Exclude QCOM and add TXN via PUT override
    put_res = client.put(
        "/api/stocks/NVDA/peers/overrides",
        json={"peer_ticker": "TXN", "action": "ADD"},
    )
    assert put_res.status_code == 200
    assert "TXN" in put_res.json()["added"]

    res_peers = client.get("/api/stocks/NVDA/peers")
    assert res_peers.status_code == 200
    data = res_peers.json()
    assert data["available"] is True
    assert data["company"]["ticker"] == "NVDA"
    assert len(data["peers"]) >= 4
    assert "TXN" in [p["ticker"] for p in data["peers"]]
    assert data["radar"] is not None
    assert len(data["summary_sentence"]) > 10
    json.dumps(data, allow_nan=False)
