from types import SimpleNamespace

import pandas as pd
import pytest

from app.routers import system as system_router
from app.services import market_data as market_data_module
from app.services.cache_service import CacheService
from app.services.market_data import MarketDataService, market_data_service

_ORIG_FMP_GET = MarketDataService._fmp_get


@pytest.fixture(autouse=True)
def _reset_fmp_state():
    market_data_service.reset_fmp_rate_limit()
    system_router._cached_status = None
    yield
    market_data_service.reset_fmp_rate_limit()
    system_router._cached_status = None


def test_fmp_circuit_breaker_on_429_and_reset(monkeypatch):
    calls: list[str] = []
    status_to_return = {"code": 429}

    class _FakeResp:
        def __init__(self, code: int, data):
            self.status_code = code
            self._data = data

        def json(self):
            return self._data

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, params=None):
            calls.append(url)
            if status_to_return["code"] == 200:
                return _FakeResp(200, [{"symbol": "AAPL"}])
            return _FakeResp(status_to_return["code"], {"Error Message": "Limit Reach"})

    monkeypatch.setattr(market_data_module.httpx, "Client", _FakeClient)
    monkeypatch.setattr(
        market_data_module,
        "get_settings",
        lambda: SimpleNamespace(FMP_API_KEY="dummy-key"),
    )

    svc = MarketDataService()
    # 1st call gets HTTP 429 and trips circuit breaker
    res1 = _ORIG_FMP_GET(svc, "/stable/analyst-estimates", {"symbol": "AAPL"})
    assert res1 is None
    assert len(calls) == 1
    assert svc.is_fmp_rate_limited() is True
    assert svc.fmp_rate_limit_remaining_minutes() > 0

    # 2nd call skips HTTP request completely while blocked
    res2 = _ORIG_FMP_GET(svc, "/stable/earnings", {"symbol": "AAPL"})
    assert res2 is None
    assert len(calls) == 1

    # Resetting rate limit allows subsequent HTTP requests again
    svc.reset_fmp_rate_limit()
    status_to_return["code"] = 200
    res3 = _ORIG_FMP_GET(svc, "/stable/analyst-estimates", {"symbol": "AAPL"})
    assert res3 == [{"symbol": "AAPL"}]
    assert len(calls) == 2


def test_get_fundamentals_skips_fmp_statements_when_yf_or_sec_present(db_session, monkeypatch):
    fmp_stmt_calls: list[tuple[str, str]] = []

    monkeypatch.setattr(
        market_data_service,
        "get_quote_and_info",
        lambda db, sym, refresh=False: {
            "ticker": "NVDA",
            "name": "NVIDIA",
            "asset_type": "EQUITY",
            "currency": "USD",
            "shares_outstanding": 1_000_000.0,
        },
    )
    monkeypatch.setattr(
        market_data_service,
        "get_price_history",
        lambda db, sym, period="MAX", refresh=False: {"points": [], "splits": []},
    )
    monkeypatch.setattr(
        market_data_service,
        "_extract_analyst_estimates",
        lambda tk: {},
    )
    monkeypatch.setattr(
        market_data_service,
        "_extract_dividends_annual",
        lambda tk: [],
    )

    def _spy_fetch_fmp_stmt(ticker: str, period: str):
        fmp_stmt_calls.append((ticker, period))
        return []

    monkeypatch.setattr(market_data_service, "_fetch_fmp_statements", _spy_fetch_fmp_stmt)

    # Case 1: yfinance returns annual + quarterly -> FMP statements MUST NOT be called
    sample_inc = pd.DataFrame(
        {"2025-12-31": [1_000.0, 300.0]},
        index=["Total Revenue", "Net Income"],
    )
    sample_q = pd.DataFrame(
        {"2025-12-31": [250.0, 80.0]},
        index=["Total Revenue", "Net Income"],
    )
    monkeypatch.setattr(
        market_data_module.yf,
        "Ticker",
        lambda sym: SimpleNamespace(
            financials=sample_inc,
            balance_sheet=pd.DataFrame(),
            cashflow=pd.DataFrame(),
            quarterly_financials=sample_q,
            quarterly_balance_sheet=pd.DataFrame(),
            quarterly_cashflow=pd.DataFrame(),
        ),
    )

    res1 = market_data_service.get_fundamentals(db_session, "NVDA", refresh=True)
    assert res1["available"] is True
    assert fmp_stmt_calls == []

    # Case 2: neither yfinance nor SEC has data -> fallback to FMP statements IS called
    monkeypatch.setattr(
        market_data_module.yf,
        "Ticker",
        lambda sym: SimpleNamespace(
            financials=pd.DataFrame(),
            balance_sheet=pd.DataFrame(),
            cashflow=pd.DataFrame(),
            quarterly_financials=pd.DataFrame(),
            quarterly_balance_sheet=pd.DataFrame(),
            quarterly_cashflow=pd.DataFrame(),
        ),
    )
    res2 = market_data_service.get_fundamentals(db_session, "NVDA", refresh=True)
    assert res2["available"] is False
    assert ("NVDA", "annual") in fmp_stmt_calls
    assert ("NVDA", "quarter") in fmp_stmt_calls


def test_long_lived_cache_ttl_and_system_status_circuit_breaker(client, monkeypatch):
    cs = CacheService()
    assert cs.ttl_for_category("fundamentals") >= 7 * 86400
    assert cs.ttl_for_category("segments") >= 7 * 86400
    assert cs.ttl_for_category("surprises") >= 7 * 86400
    assert cs.ttl_for_category("quote") < 3600

    # Mark FMP rate-limited and verify /api/system/status reports pause without hitting financialmodelingprep.com
    market_data_service.mark_fmp_rate_limited(hours=2.0)
    monkeypatch.setattr(
        system_router,
        "get_settings",
        lambda: SimpleNamespace(FINNHUB_API_KEY="", FMP_API_KEY="secret-fmp", APP_PIN=""),
    )

    requested_urls: list[str] = []

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"0": {"ticker": "AAPL"}}

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, params=None):
            requested_urls.append(url)
            return _FakeResp()

    monkeypatch.setattr(system_router.httpx, "Client", _FakeClient)
    monkeypatch.setattr(
        system_router.yf,
        "Ticker",
        lambda _sym: SimpleNamespace(fast_info=SimpleNamespace(last_price=1.08)),
    )

    res = client.get("/api/system/status?refresh=true")
    assert res.status_code == 200
    by_id = {p["id"]: p for p in res.json()["providers"]}
    assert by_id["fmp"]["status"] == "error"
    assert "429" in by_id["fmp"]["detail"]
    assert all("financialmodelingprep.com" not in u for u in requested_urls)

    # Clearing cache also clears FMP circuit breaker
    clr = client.post("/api/system/cache/clear")
    assert clr.status_code == 200
    assert market_data_service.is_fmp_rate_limited() is False
