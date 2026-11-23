from datetime import timedelta
from types import SimpleNamespace

from app.db.models import MarketCache
from app.routers import system as system_router
from app.services.market_data import market_data_service
from app.services.sec_edgar import extract_financials_from_companyfacts
from app.utils.math_utils import utc_now


def test_system_status_hides_api_keys(client, monkeypatch):
    system_router._cached_status = None
    fake_settings = SimpleNamespace(
        FINNHUB_API_KEY="secret-finnhub-val",
        FMP_API_KEY="secret-fmp-val",
        APP_PIN="",
    )
    monkeypatch.setattr(system_router, "get_settings", lambda: fake_settings)

    class _FakeResp:
        def __init__(self, status_code: int, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    class _FakeHttpxClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str, params=None):
            if "sec.gov" in url:
                return _FakeResp(200, {"0": {"ticker": "AAPL", "cik_str": 320193}})
            if "finnhub.io" in url:
                return _FakeResp(200, {"ticker": "AAPL", "name": "Apple Inc"})
            if "financialmodelingprep.com" in url:
                return _FakeResp(200, [{"symbol": "AAPL", "revenueAvg": 400e9}])
            return _FakeResp(404, {})

    monkeypatch.setattr(system_router.httpx, "Client", _FakeHttpxClient)
    monkeypatch.setattr(
        system_router.yf,
        "Ticker",
        lambda _sym: SimpleNamespace(fast_info=SimpleNamespace(last_price=1.08)),
    )

    try:
        res = client.get("/api/system/status?refresh=true")
        assert res.status_code == 200
        assert "secret-finnhub-val" not in res.text
        assert "secret-fmp-val" not in res.text

        body = res.json()
        by_id = {p["id"]: p for p in body["providers"]}
        assert by_id["yfinance"]["status"] == "ok"
        assert by_id["sec_edgar"]["status"] == "ok"
        assert by_id["finnhub"]["status"] == "ok"
        assert by_id["fmp"]["status"] == "ok"
    finally:
        system_router._cached_status = None


def test_clear_system_cache(client, db_session):
    now = utc_now()
    db_session.add(
        MarketCache(
            cache_key="fundamentals:NVDA",
            category="fundamentals",
            payload={"ticker": "NVDA"},
            updated_at=now,
            expires_at=now + timedelta(hours=24),
        )
    )
    db_session.add(
        MarketCache(
            cache_key="analysts:APP",
            category="analysts",
            payload={"ticker": "APP"},
            updated_at=now,
            expires_at=now + timedelta(hours=24),
        )
    )
    db_session.commit()

    res_partial = client.post("/api/system/cache/clear?prefix=fundamentals:")
    assert res_partial.status_code == 200
    assert res_partial.json()["cleared"] == 1
    assert db_session.query(MarketCache).count() == 1

    res_all = client.post("/api/system/cache/clear")
    assert res_all.status_code == 200
    assert res_all.json()["cleared"] == 1
    assert db_session.query(MarketCache).count() == 0


def test_sec_edgar_extract_financials_ytd_diff_q4_and_positive_shares():
    payload = {
        "facts": {
            "us-gaap": {
                "Revenues": {
                    "units": {
                        "USD": [
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "val": 100.0},
                            {"form": "10-Q", "start": "2025-04-01", "end": "2025-06-30", "filed": "2025-08-01", "val": 120.0},
                            {"form": "10-Q", "start": "2025-07-01", "end": "2025-09-30", "filed": "2025-11-01", "val": 140.0},
                            {"form": "10-K", "start": "2025-01-01", "end": "2025-12-31", "filed": "2026-02-15", "val": 520.0},
                        ]
                    }
                },
                "NetIncomeLoss": {
                    "units": {
                        "USD": [
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "val": 20.0},
                            {"form": "10-Q", "start": "2025-04-01", "end": "2025-06-30", "filed": "2025-08-01", "val": 24.0},
                            {"form": "10-Q", "start": "2025-07-01", "end": "2025-09-30", "filed": "2025-11-01", "val": 28.0},
                            {"form": "10-K", "start": "2025-01-01", "end": "2025-12-31", "filed": "2026-02-15", "val": 104.0},
                        ]
                    }
                },
                "NetCashProvidedByUsedInOperatingActivities": {
                    "units": {
                        "USD": [
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "val": 30.0},
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-06-30", "filed": "2025-08-01", "val": 70.0},
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-09-30", "filed": "2025-11-01", "val": 115.0},
                            {"form": "10-K", "start": "2025-01-01", "end": "2025-12-31", "filed": "2026-02-15", "val": 170.0},
                        ]
                    }
                },
                "PaymentsToAcquirePropertyPlantAndEquipment": {
                    "units": {
                        "USD": [
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "val": 5.0},
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-06-30", "filed": "2025-08-01", "val": 12.0},
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-09-30", "filed": "2025-11-01", "val": 20.0},
                            {"form": "10-K", "start": "2025-01-01", "end": "2025-12-31", "filed": "2026-02-15", "val": 30.0},
                        ]
                    }
                },
                "WeightedAverageNumberOfDilutedSharesOutstanding": {
                    "units": {
                        "shares": [
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-01", "val": 1000.0},
                            {"form": "10-Q", "start": "2025-04-01", "end": "2025-06-30", "filed": "2025-08-01", "val": 990.0},
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-06-30", "filed": "2025-08-01", "val": 995.0},
                            {"form": "10-Q", "start": "2025-07-01", "end": "2025-09-30", "filed": "2025-11-01", "val": 980.0},
                            {"form": "10-Q", "start": "2025-01-01", "end": "2025-09-30", "filed": "2025-11-01", "val": 990.0},
                            {"form": "10-K", "start": "2025-01-01", "end": "2025-12-31", "filed": "2026-02-15", "val": 985.0},
                        ]
                    }
                },
            },
            "dei": {
                "EntityCommonStockSharesOutstanding": {
                    "units": {
                        "shares": [
                            {"form": "10-K", "end": "2025-12-31", "filed": "2026-02-15", "val": 975.0},
                        ]
                    }
                }
            },
        }
    }

    extracted = extract_financials_from_companyfacts(payload)
    assert len(extracted["annual"]) == 1
    fy = extracted["annual"][0]
    assert fy["revenue"] == 520.0
    assert fy["net_income"] == 104.0
    assert fy["free_cash_flow"] == 140.0
    assert fy["shares_outstanding"] == 985.0

    by_q = {q["period_end"]: q for q in extracted["quarterly"]}
    assert set(by_q.keys()) == {"2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"}

    # Q2 & Q3 derived from YTD cash flows; Q4 derived from FY - (Q1+Q2+Q3) / FY - 9M
    assert by_q["2025-03-31"]["operating_cash_flow"] == 30.0
    assert by_q["2025-06-30"]["operating_cash_flow"] == 40.0
    assert by_q["2025-09-30"]["operating_cash_flow"] == 45.0
    assert by_q["2025-12-31"]["operating_cash_flow"] == 55.0

    assert by_q["2025-12-31"]["revenue"] == 160.0
    assert by_q["2025-12-31"]["net_income"] == 32.0
    assert by_q["2025-12-31"]["free_cash_flow"] == 45.0

    # Shares must NOT be YTD-diffed (allow_ytd_diff=False) -> all positive
    assert by_q["2025-03-31"]["shares_outstanding"] == 1000.0
    assert by_q["2025-06-30"]["shares_outstanding"] == 990.0
    assert by_q["2025-09-30"]["shares_outstanding"] == 980.0
    assert by_q["2025-12-31"]["shares_outstanding"] == 975.0


def test_compute_ttm_record_sums_flows_and_takes_latest_balance_sheet():
    quarters = [
        {"period_end": "2025-12-31", "revenue": 100.0, "gross_profit": 60.0, "operating_income": 30.0, "net_income": 25.0, "ebitda": 35.0, "operating_cash_flow": 28.0, "capex": -3.0, "free_cash_flow": 25.0, "eps": 0.25, "shares_outstanding": 100.0, "cash": 40.0, "total_debt": 10.0, "net_debt": -30.0, "total_equity": 200.0, "current_assets": 80.0, "current_liabilities": 20.0},
        {"period_end": "2026-03-31", "revenue": 110.0, "gross_profit": 66.0, "operating_income": 33.0, "net_income": 27.0, "ebitda": 38.0, "operating_cash_flow": 31.0, "capex": -4.0, "free_cash_flow": 27.0, "eps": 0.27, "shares_outstanding": 99.0, "cash": 42.0, "total_debt": 9.0, "net_debt": -33.0, "total_equity": 210.0, "current_assets": 82.0, "current_liabilities": 21.0},
        {"period_end": "2026-06-30", "revenue": 120.0, "gross_profit": 72.0, "operating_income": 36.0, "net_income": 30.0, "ebitda": 42.0, "operating_cash_flow": 35.0, "capex": -4.0, "free_cash_flow": 31.0, "eps": 0.30, "shares_outstanding": 98.0, "cash": 45.0, "total_debt": 8.0, "net_debt": -37.0, "total_equity": 225.0, "current_assets": 85.0, "current_liabilities": 22.0},
        {"period_end": "2026-09-30", "revenue": 130.0, "gross_profit": 80.0, "operating_income": 41.0, "net_income": 34.0, "ebitda": 47.0, "operating_cash_flow": 40.0, "capex": -5.0, "free_cash_flow": 35.0, "eps": 0.35, "shares_outstanding": 97.0, "cash": 50.0, "total_debt": 7.0, "net_debt": -43.0, "total_equity": 240.0, "current_assets": 90.0, "current_liabilities": 24.0},
    ]
    ttm = market_data_service.compute_ttm_record(quarters)
    assert ttm is not None
    assert ttm["period_end"] == "TTM"
    assert ttm["revenue"] == 460.0
    assert ttm["net_income"] == 116.0
    assert ttm["free_cash_flow"] == 118.0
    assert round(ttm["eps"], 4) == 1.17
    assert ttm["shares_outstanding"] == 97.0
    assert ttm["cash"] == 50.0
    assert ttm["total_debt"] == 7.0
    assert ttm["total_equity"] == 240.0


def test_get_stock_analysts_endpoint(client, monkeypatch):
    sample_payload = {
        "ticker": "NVDA",
        "available": True,
        "reason": None,
        "currency": "USD",
        "price_targets": {
            "current": 180.0,
            "high": 250.0,
            "mean": 216.0,
            "median": 215.0,
            "low": 150.0,
            "upside_high_pct": 38.9,
            "upside_mean_pct": 20.0,
            "upside_low_pct": -16.7,
        },
        "revenue_forecasts": [
            {"period": "2026", "year": 2026, "is_actual": True, "high": 215e9, "avg": 215e9, "low": 215e9, "num_analysts": None},
            {"period": "2027 (est.)", "year": 2027, "is_actual": False, "high": 320e9, "avg": 290e9, "low": 265e9, "num_analysts": 42},
        ],
        "revenue_cagr": {"high": 48.8, "avg": 34.9, "low": 23.3},
        "eps_forecasts": [
            {"period": "2026", "year": 2026, "is_actual": True, "high": 4.9, "avg": 4.9, "low": 4.9, "num_analysts": None},
            {"period": "2027 (est.)", "year": 2027, "is_actual": False, "high": 7.5, "avg": 6.8, "low": 6.1, "num_analysts": 40},
        ],
        "eps_cagr": {"high": 53.1, "avg": 38.8, "low": 24.5},
        "consensus": {
            "strong_buy": 25,
            "buy": 30,
            "hold": 4,
            "sell": 1,
            "strong_sell": 0,
            "total": 60,
            "score_out_of_5": 4.3,
            "label": "Achat fort",
            "period": "2026-11",
        },
        "updated_at": utc_now().isoformat(),
        "is_stale": False,
    }
    monkeypatch.setattr(market_data_service, "get_analysts", lambda db, ticker, refresh=False: sample_payload)

    res = client.get("/api/stocks/NVDA/analysts")
    assert res.status_code == 200
    data = res.json()
    assert data["ticker"] == "NVDA"
    assert data["price_targets"]["mean"] == 216.0
    assert len(data["revenue_forecasts"]) == 2
    assert len(data["eps_forecasts"]) == 2
    assert data["consensus"]["score_out_of_5"] == 4.3
    assert data["consensus"]["label"] == "Achat fort"
