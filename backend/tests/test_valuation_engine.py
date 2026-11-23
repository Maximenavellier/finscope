import pytest

from app.services.valuation_engine import calculate_fair_value, compute_default_fair_value


def test_fair_value_identity_when_growth_equals_discount():
    # When g == r, FV = M0 * ((1+g)^n / (1+r)^n) * multiple == M0 * multiple
    res = calculate_fair_value(
        current_price=100.0,
        base_metric_per_share=5.0,
        expected_growth_pct=10.0,
        exit_multiple=24.0,
        required_return_pct=10.0,
        horizon_years=5,
        metric_used="FCF",
    )
    assert res["available"] is True
    assert res["fair_value"] == pytest.approx(120.0, abs=0.01)
    assert res["upside_pct"] == pytest.approx(20.0, abs=0.1)
    assert res["verdict"] == "Sous-évaluée"
    assert res["verdict_tone"] == "emerald"


def test_fair_value_verdict_thresholds():
    fair = calculate_fair_value(100.0, 5.0, 10.0, 21.0, 10.0, 5)
    assert fair["verdict"] == "Proche du prix juste"
    assert fair["verdict_tone"] == "amber"

    over = calculate_fair_value(100.0, 5.0, 5.0, 15.0, 10.0, 5)
    assert over["upside_pct"] < -10.0
    assert over["verdict"] == "Surévaluée"
    assert over["verdict_tone"] == "coral"


def test_fair_value_handles_invalid_inputs_and_etf():
    bad = calculate_fair_value(100.0, -2.5, 10.0, 20.0, 10.0)
    assert bad["available"] is False
    assert bad["fair_value"] is None

    etf_res = compute_default_fair_value({"asset_type": "ETF", "price": 500.0}, {"available": False})
    assert etf_res["available"] is False
    assert etf_res["reason"] == "ETF"


def test_compute_default_fair_value_clamping_and_fcf_preference():
    quote = {
        "asset_type": "EQUITY",
        "price": 150.0,
        "pe": 25.0,
        "forward_pe": 20.0,
        "revenue_growth_info": 0.40,
    }
    fundamentals = {
        "available": True,
        "annual": [
            {"period_end": "2023-12-31", "revenue": 100e9, "eps": 2.0, "free_cash_flow": 40e9, "fcf_per_share": 4.0},
            {"period_end": "2024-12-31", "revenue": 150e9, "eps": 3.0, "free_cash_flow": 60e9, "fcf_per_share": 6.0},
            {"period_end": "2025-12-31", "revenue": 220e9, "eps": 5.0, "free_cash_flow": 90e9, "fcf_per_share": 9.0},
        ],
        "historical_multiples": [
            {"period_end": "2023-12-31", "pe": 50.0, "p_fcf": 42.0},
            {"period_end": "2024-12-31", "pe": 45.0, "p_fcf": 38.0},
            {"period_end": "2025-12-31", "pe": 40.0, "p_fcf": 40.0},
        ],
        "estimates": {},
    }
    res = compute_default_fair_value(quote, fundamentals)
    assert res["available"] is True
    assert res["metric_used"] == "FCF"
    assert res["base_metric_per_share"] == pytest.approx(9.0)
    # Growth clamped to <= 22.0, exit multiple clamped to <= 35.0
    assert res["default_growth_pct"] == 22.0
    assert res["default_exit_multiple"] == 35.0
    assert res["default_required_return_pct"] == 10.0
