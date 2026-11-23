from statistics import median
from typing import Any, Optional

from app.services.scoring_engine import is_financial_sector
from app.utils.math_utils import compute_cagr, safe_float, sanitize_for_json


def calculate_fair_value(
    current_price: Optional[float],
    base_metric_per_share: Optional[float],
    expected_growth_pct: float,
    exit_multiple: float,
    required_return_pct: float,
    horizon_years: int = 5,
    metric_used: str = "EPS",
) -> dict[str, Any]:
    """Compute fair value from expected growth, exit multiple, and required discount rate."""
    px = safe_float(current_price)
    m0 = safe_float(base_metric_per_share)
    g_pct = safe_float(expected_growth_pct, default=8.0) or 0.0
    mult = safe_float(exit_multiple, default=18.0) or 0.0
    r_pct = safe_float(required_return_pct, default=10.0) or 0.0
    horizon = max(1, min(15, int(horizon_years or 5)))

    if px is None or px <= 0 or m0 is None or m0 <= 0 or mult <= 0:
        return sanitize_for_json(
            {
                "available": False,
                "reason": "INSUFFICIENT_DATA",
                "current_price": px,
                "base_metric_per_share": m0,
                "metric_used": metric_used,
                "expected_growth_pct": round(g_pct, 1),
                "exit_multiple": round(mult, 1),
                "required_return_pct": round(r_pct, 1),
                "horizon_years": horizon,
                "projected_metric_per_share": None,
                "terminal_price": None,
                "fair_value": None,
                "upside_pct": None,
                "margin_of_safety_pct": None,
                "verdict": "Données insuffisantes",
                "verdict_tone": "amber",
            }
        )

    g = g_pct / 100.0
    r = r_pct / 100.0

    # Guard against extreme negative growth making (1+g) <= 0
    growth_factor = max(0.0, 1.0 + g) ** horizon
    discount_factor = max(0.01, 1.0 + r) ** horizon

    projected_metric = m0 * growth_factor
    terminal_price = projected_metric * mult
    fair_value = terminal_price / discount_factor

    upside_pct = ((fair_value - px) / px) * 100.0
    margin_of_safety_pct = ((fair_value - px) / fair_value) * 100.0 if fair_value > 0 else None

    if upside_pct >= 20.0:
        verdict = "Sous-évaluée"
        verdict_tone = "emerald"
    elif upside_pct >= -10.0:
        verdict = "Proche du prix juste"
        verdict_tone = "amber"
    else:
        verdict = "Surévaluée"
        verdict_tone = "coral"

    return sanitize_for_json(
        {
            "available": True,
            "reason": None,
            "current_price": round(px, 2),
            "base_metric_per_share": round(m0, 4),
            "metric_used": metric_used,
            "expected_growth_pct": round(g_pct, 1),
            "exit_multiple": round(mult, 1),
            "required_return_pct": round(r_pct, 1),
            "horizon_years": horizon,
            "projected_metric_per_share": round(projected_metric, 2),
            "terminal_price": round(terminal_price, 2),
            "fair_value": round(fair_value, 2),
            "upside_pct": round(upside_pct, 1),
            "margin_of_safety_pct": round(margin_of_safety_pct, 1)
            if margin_of_safety_pct is not None
            else None,
            "verdict": verdict,
            "verdict_tone": verdict_tone,
        }
    )


def _compute_series_cagr(records: list[dict[str, Any]], key: str) -> Optional[float]:
    valid = [(i, safe_float(r.get(key))) for i, r in enumerate(records)]
    valid = [(i, v) for i, v in valid if v is not None and v > 0]
    if len(valid) < 2:
        return None
    # Prefer up to 3-4 years span from recent records
    start_idx, start_val = valid[max(0, len(valid) - 4)]
    end_idx, end_val = valid[-1]
    years = max(1, end_idx - start_idx)
    return compute_cagr(start_val, end_val, years)


def compute_default_fair_value(quote: dict[str, Any], fundamentals: dict[str, Any]) -> dict[str, Any]:
    """Compute pre-filled Fair Value calculator defaults and output for an asset."""
    asset_type = quote.get("asset_type") or "EQUITY"
    if asset_type == "ETF":
        return sanitize_for_json(
            {
                "available": False,
                "reason": "ETF",
                "default_growth_pct": None,
                "default_exit_multiple": None,
                "default_required_return_pct": 10.0,
                "horizon_years": 5,
                "metric_used": None,
                "base_metric_per_share": None,
                "fair_value": None,
                "upside_pct": None,
                "margin_of_safety_pct": None,
                "verdict": "Non applicable aux ETF",
                "verdict_tone": "amber",
            }
        )

    if not fundamentals.get("available"):
        return sanitize_for_json(
            {
                "available": False,
                "reason": "NO_FUNDAMENTALS",
                "default_growth_pct": 8.0,
                "default_exit_multiple": 18.0,
                "default_required_return_pct": 10.0,
                "horizon_years": 5,
                "metric_used": "EPS",
                "base_metric_per_share": None,
                "fair_value": None,
                "upside_pct": None,
                "margin_of_safety_pct": None,
                "verdict": "Fondamentaux indisponibles",
                "verdict_tone": "amber",
            }
        )

    annual = fundamentals.get("annual") or []
    latest = annual[-1] if annual else {}
    current_price = safe_float(quote.get("price"))
    pe = safe_float(quote.get("pe"))

    base_metric: Optional[float] = None
    metric_used = "EPS"
    fcf_ps = safe_float(latest.get("fcf_per_share"))
    eps = safe_float(latest.get("eps"))
    financial_mode = is_financial_sector(quote.get("sector"), quote.get("industry"))

    if not financial_mode and fcf_ps is not None and fcf_ps > 0:
        base_metric = fcf_ps
        metric_used = "FCF"
    elif eps is not None and eps > 0:
        base_metric = eps
        metric_used = "EPS"
    elif current_price is not None and current_price > 0 and pe is not None and pe > 0:
        base_metric = current_price / pe
        metric_used = "EPS"

    if base_metric is None or base_metric <= 0:
        return sanitize_for_json(
            {
                "available": False,
                "reason": "NEGATIVE_EARNINGS",
                "current_price": current_price,
                "default_growth_pct": 8.0,
                "default_exit_multiple": 18.0,
                "default_required_return_pct": 10.0,
                "horizon_years": 5,
                "metric_used": metric_used,
                "base_metric_per_share": None,
                "fair_value": None,
                "upside_pct": None,
                "margin_of_safety_pct": None,
                "verdict": "Bénéfices / FCF négatifs",
                "verdict_tone": "amber",
            }
        )

    # 1. Pre-fill expected growth (%) conservatively
    growth_candidates: list[float] = []
    for k in ("revenue", "eps", "free_cash_flow"):
        c = _compute_series_cagr(annual, k)
        if c is not None:
            growth_candidates.append(c * 100.0)

    estimates = fundamentals.get("estimates") or {}
    for est_group in ("eps", "revenue"):
        grp = estimates.get(est_group) or {}
        for period_key in ("+1y", "0y"):
            g_est = safe_float((grp.get(period_key) or {}).get("growth"))
            if g_est is not None:
                growth_candidates.append(g_est * 100.0)

    rev_info = safe_float(quote.get("revenue_growth_info"))
    if rev_info is not None:
        growth_candidates.append(rev_info * 100.0)

    if growth_candidates:
        # Conservative blend: median slightly damped toward 10%
        raw_g = median(growth_candidates)
        default_growth_pct = round(max(3.0, min(22.0, raw_g * 0.85 if raw_g > 15.0 else raw_g)), 1)
    else:
        default_growth_pct = 8.0

    # 2. Pre-fill exit multiple from historical multiples median
    hist_mults = fundamentals.get("historical_multiples") or []
    mult_key = "p_fcf" if metric_used == "FCF" else "pe"
    valid_mults = [
        safe_float(m.get(mult_key))
        for m in hist_mults
        if safe_float(m.get(mult_key)) is not None and 0 < safe_float(m.get(mult_key)) <= 80.0
    ]
    if not valid_mults and mult_key == "p_fcf":
        valid_mults = [
            safe_float(m.get("pe"))
            for m in hist_mults
            if safe_float(m.get("pe")) is not None and 0 < safe_float(m.get("pe")) <= 80.0
        ]

    if valid_mults:
        default_exit_multiple = round(max(10.0, min(35.0, float(median(valid_mults)))), 1)
    else:
        cur_mult = safe_float(quote.get("forward_pe")) or pe
        if cur_mult is not None and 0 < cur_mult <= 80.0:
            default_exit_multiple = round(max(10.0, min(35.0, cur_mult)), 1)
        else:
            default_exit_multiple = 18.0

    default_required_return_pct = 10.0
    horizon_years = 5

    result = calculate_fair_value(
        current_price=current_price,
        base_metric_per_share=base_metric,
        expected_growth_pct=default_growth_pct,
        exit_multiple=default_exit_multiple,
        required_return_pct=default_required_return_pct,
        horizon_years=horizon_years,
        metric_used=metric_used,
    )
    result["default_growth_pct"] = default_growth_pct
    result["default_exit_multiple"] = default_exit_multiple
    result["default_required_return_pct"] = default_required_return_pct
    return sanitize_for_json(result)
