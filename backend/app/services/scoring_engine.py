from datetime import datetime, timedelta
from statistics import median
from typing import Any, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.db.models import Asset
from app.services.cache_service import _is_sqlite_session, _sqlite_write_lock
from app.utils.math_utils import compute_cagr, compute_percent_change, safe_float, sanitize_for_json, utc_now


def _first_not_none(*values: Any) -> Optional[float]:
    for val in values:
        f = safe_float(val)
        if f is not None:
            return f
    return None


def piecewise_score(value: Optional[float], breakpoints: list[tuple[float, float]]) -> Optional[float]:
    """Linearly interpolate a metric value onto [0, 100] using sorted (x, score) breakpoints."""
    v = safe_float(value)
    if v is None or not breakpoints:
        return None
    pts = sorted(breakpoints, key=lambda pair: pair[0])
    if v <= pts[0][0]:
        return float(max(0.0, min(100.0, pts[0][1])))
    if v >= pts[-1][0]:
        return float(max(0.0, min(100.0, pts[-1][1])))

    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        if x0 <= v <= x1:
            if x1 == x0:
                return float(max(0.0, min(100.0, y0)))
            ratio = (v - x0) / (x1 - x0)
            score = y0 + ratio * (y1 - y0)
            return float(max(0.0, min(100.0, score)))
    return None


def weighted_average(pairs: list[tuple[Optional[float], float]]) -> Optional[float]:
    """Compute weighted average over available (non-None) scores, renormalizing weights."""
    valid = [(float(score), float(weight)) for score, weight in pairs if score is not None and weight > 0]
    if not valid:
        return None
    total_weight = sum(w for _, w in valid)
    if total_weight <= 0:
        return None
    result = sum(s * w for s, w in valid) / total_weight
    return round(max(0.0, min(100.0, result)), 1)


def score_tone(score: Optional[float]) -> str:
    if score is None:
        return "amber"
    if score >= 70.0:
        return "emerald"
    if score >= 45.0:
        return "amber"
    return "coral"


def is_financial_sector(sector: Optional[str], industry: Optional[str]) -> bool:
    sec = (sector or "").strip().lower()
    ind = (industry or "").strip().lower()
    if sec in {"financial services", "financials"} and any(
        k in ind for k in ("bank", "insurance", "diversified financials", "capital markets", "mortgage")
    ):
        return True
    return False


def _extract_growth_horizons(
    annual: list[dict[str, Any]],
    field: str,
) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """Return (1Y, 3Y, 5Y) growth rates as decimals from chronologically sorted annual records."""
    if len(annual) < 2:
        return None, None, None

    end_rec = annual[-1]
    end_val = safe_float(end_rec.get(field))
    if end_val is None:
        return None, None, None

    # 1Y growth
    g_1y: Optional[float] = None
    prev_val = safe_float(annual[-2].get(field))
    if prev_val is not None and prev_val > 0:
        g_1y = compute_percent_change(prev_val, end_val)

    # 3Y CAGR (use 3Y span if >= 4 years, or 2Y span if 3 years available)
    g_3y: Optional[float] = None
    if len(annual) >= 4:
        start_rec = annual[-4]
        yrs = max(1, (end_rec.get("fiscal_year") or 0) - (start_rec.get("fiscal_year") or 0))
        if yrs <= 0 or yrs > 5:
            yrs = 3
        g_3y = compute_cagr(start_rec.get(field), end_val, yrs)
    elif len(annual) == 3:
        start_rec = annual[0]
        yrs = max(1, (end_rec.get("fiscal_year") or 0) - (start_rec.get("fiscal_year") or 0))
        if yrs <= 0 or yrs > 4:
            yrs = 2
        g_3y = compute_cagr(start_rec.get(field), end_val, yrs)

    # 5Y CAGR (when at least 5 annual statements exist)
    g_5y: Optional[float] = None
    if len(annual) >= 5:
        start_idx = max(0, len(annual) - 6)
        start_rec = annual[start_idx]
        yrs = max(1, (end_rec.get("fiscal_year") or 0) - (start_rec.get("fiscal_year") or 0))
        if yrs <= 0 or yrs > 6:
            yrs = len(annual) - 1 - start_idx
        g_5y = compute_cagr(start_rec.get(field), end_val, yrs)

    return g_1y, g_3y, g_5y


def extract_equity_metrics(quote: dict[str, Any], fundamentals: dict[str, Any]) -> dict[str, Any]:
    """Extract unified current multiples, historical averages, growth, margins, and balance sheet health."""
    annual = fundamentals.get("annual") or []
    latest = annual[-1] if annual else {}

    price = safe_float(quote.get("price"))
    market_cap = safe_float(quote.get("market_cap"))
    ev = safe_float(quote.get("enterprise_value"))

    pe = safe_float(quote.get("pe"))
    if pe is None and price is not None and price > 0:
        eps_latest = safe_float(latest.get("eps"))
        if eps_latest is not None and eps_latest > 0:
            pe = round(price / eps_latest, 2)

    forward_pe = safe_float(quote.get("forward_pe"))

    p_fcf: Optional[float] = None
    latest_fcf = safe_float(latest.get("free_cash_flow"))
    fcf_ps = safe_float(latest.get("fcf_per_share"))
    fcf_info = safe_float(quote.get("free_cashflow_info"))
    if market_cap is not None and market_cap > 0 and latest_fcf is not None and latest_fcf > 0:
        p_fcf = round(market_cap / latest_fcf, 2)
    elif price is not None and price > 0 and fcf_ps is not None and fcf_ps > 0:
        p_fcf = round(price / fcf_ps, 2)
    elif market_cap is not None and market_cap > 0 and fcf_info is not None and fcf_info > 0:
        p_fcf = round(market_cap / fcf_info, 2)

    ev_ebitda = safe_float(quote.get("ev_to_ebitda"))
    if ev_ebitda is None and ev is not None and ev > 0:
        latest_ebitda = _first_not_none(latest.get("ebitda"), quote.get("ebitda_info"))
        if latest_ebitda is not None and latest_ebitda > 0:
            ev_ebitda = round(ev / latest_ebitda, 2)

    peg = safe_float(quote.get("peg"))

    # Historical averages over 3-5 recent available years
    hist_mults = (fundamentals.get("historical_multiples") or [])[-5:]
    pe_hist = [v for m in hist_mults if (v := safe_float(m.get("pe"))) is not None and 0 < v <= 200]
    pfcf_hist = [v for m in hist_mults if (v := safe_float(m.get("p_fcf"))) is not None and 0 < v <= 200]
    ev_hist = [v for m in hist_mults if (v := safe_float(m.get("ev_ebitda"))) is not None and 0 < v <= 120]

    hist_avg_pe = round(sum(pe_hist) / len(pe_hist), 2) if pe_hist else None
    hist_avg_p_fcf = round(sum(pfcf_hist) / len(pfcf_hist), 2) if pfcf_hist else None
    hist_avg_ev_ebitda = round(sum(ev_hist) / len(ev_hist), 2) if ev_hist else None
    hist_years_count = min(5, int(fundamentals.get("historical_years_count") or len(hist_mults) or 0))

    # Growth
    rev_1y, rev_3y, rev_5y = _extract_growth_horizons(annual, "revenue")
    eps_1y, eps_3y, eps_5y = _extract_growth_horizons(annual, "eps")
    fcf_1y, fcf_3y, fcf_5y = _extract_growth_horizons(annual, "free_cash_flow")

    rev_1y = _first_not_none(rev_1y, quote.get("revenue_growth_info"))
    eps_1y = _first_not_none(eps_1y, quote.get("earnings_growth_info"))

    # Profitability
    gross_margin = _first_not_none(latest.get("gross_margin"), quote.get("gross_margin"))
    op_margin = _first_not_none(latest.get("op_margin"), quote.get("op_margin"))
    net_margin = _first_not_none(latest.get("net_margin"), quote.get("net_margin"))
    roe = _first_not_none(latest.get("roe"), quote.get("roe"))
    roic = safe_float(latest.get("roic"))
    fcf_conversion = safe_float(latest.get("fcf_conversion"))

    # Health
    net_debt_ebitda = safe_float(latest.get("net_debt_ebitda"))
    if net_debt_ebitda is None:
        td_info = safe_float(quote.get("total_debt_info"))
        tc_info = safe_float(quote.get("total_cash_info"))
        ebitda_info = safe_float(quote.get("ebitda_info"))
        if td_info is not None and tc_info is not None and ebitda_info is not None and ebitda_info > 0:
            net_debt_ebitda = round((td_info - tc_info) / ebitda_info, 2)

    debt_to_equity = safe_float(latest.get("debt_to_equity"))
    if debt_to_equity is None:
        de_info = safe_float(quote.get("debt_to_equity_info"))
        if de_info is not None:
            # Yahoo reports debtToEquity in percentage points (e.g. 45.2 means 0.452x)
            debt_to_equity = round(de_info / 100.0, 3)

    current_ratio = _first_not_none(latest.get("current_ratio"), quote.get("current_ratio_info"))

    return sanitize_for_json(
        {
            "pe": pe,
            "forward_pe": forward_pe,
            "p_fcf": p_fcf,
            "ev_ebitda": ev_ebitda,
            "peg": peg,
            "hist_avg_pe": hist_avg_pe,
            "hist_avg_p_fcf": hist_avg_p_fcf,
            "hist_avg_ev_ebitda": hist_avg_ev_ebitda,
            "hist_years_count": hist_years_count,
            "rev_growth_1y": rev_1y,
            "rev_growth_3y": rev_3y,
            "rev_growth_5y": rev_5y,
            "eps_growth_1y": eps_1y,
            "eps_growth_3y": eps_3y,
            "eps_growth_5y": eps_5y,
            "fcf_growth_1y": fcf_1y,
            "fcf_growth_3y": fcf_3y,
            "fcf_growth_5y": fcf_5y,
            "gross_margin": gross_margin,
            "op_margin": op_margin,
            "net_margin": net_margin,
            "roe": roe,
            "roic": roic,
            "fcf_conversion": fcf_conversion,
            "net_debt_ebitda": net_debt_ebitda,
            "debt_to_equity": debt_to_equity,
            "current_ratio": current_ratio,
        }
    )


def get_cached_sector_averages(
    db: Session,
    sector: Optional[str],
    industry: Optional[str],
    exclude_ticker: str,
) -> dict[str, Optional[float]]:
    """Compute baseline sector valuation averages from cached Asset rows (zero network calls)."""
    rows: list[Asset] = []
    if industry:
        rows = (
            db.query(Asset)
            .filter(
                Asset.asset_type == "EQUITY",
                Asset.industry == industry,
                Asset.ticker != exclude_ticker,
            )
            .all()
        )
    with_multiples = [r for r in rows if r.pe or r.forward_pe or r.p_fcf]
    if len(with_multiples) < 3 and sector:
        rows = (
            db.query(Asset)
            .filter(
                Asset.asset_type == "EQUITY",
                Asset.sector == sector,
                Asset.ticker != exclude_ticker,
            )
            .all()
        )

    def _avg_clipped(attr: str, max_val: float) -> Optional[float]:
        vals = [
            v
            for r in rows
            if (v := safe_float(getattr(r, attr, None))) is not None and 0 < v <= max_val
        ]
        if len(vals) < 2:
            return None
        return round(sum(vals) / len(vals), 2)

    return {
        "pe": _avg_clipped("pe", 150.0),
        "forward_pe": _avg_clipped("forward_pe", 150.0),
        "p_fcf": _avg_clipped("p_fcf", 150.0),
        "ev_ebitda": None,
    }


def _relative_multiple_score(current: Optional[float], reference: Optional[float]) -> tuple[Optional[float], Optional[float]]:
    if current is None or reference is None or current <= 0 or reference <= 0:
        return None, None
    diff_pct = ((current - reference) / reference) * 100.0
    score = piecewise_score(
        diff_pct,
        [(-35.0, 100.0), (-30.0, 98.0), (-15.0, 80.0), (0.0, 55.0), (20.0, 32.0), (40.0, 10.0), (60.0, 5.0)],
    )
    return score, diff_pct


def score_equity(
    quote: dict[str, Any],
    fundamentals: dict[str, Any],
    sector_averages: Optional[dict[str, Optional[float]]] = None,
) -> dict[str, Any]:
    """Compute the 5 /100 scores, badges, verdicts, and metrics snapshot for an equity."""
    m = extract_equity_metrics(quote, fundamentals)
    sec_avg = sector_averages or {}
    financial_mode = is_financial_sector(quote.get("sector"), quote.get("industry"))

    # 1. Valorisation /100
    hist_pairs = (("pe", "hist_avg_pe"),) if financial_mode else (("pe", "hist_avg_pe"), ("p_fcf", "hist_avg_p_fcf"), ("ev_ebitda", "hist_avg_ev_ebitda"))
    hist_scores: list[float] = []
    hist_diffs: list[float] = []
    for cur_k, hist_k in hist_pairs:
        s, diff = _relative_multiple_score(m.get(cur_k), m.get(hist_k))
        if s is not None and diff is not None:
            hist_scores.append(s)
            hist_diffs.append(diff)
    hist_comp = sum(hist_scores) / len(hist_scores) if hist_scores else None
    hist_diff_pct = round(float(median(hist_diffs)), 1) if hist_diffs else None

    sec_keys = ("pe", "forward_pe") if financial_mode else ("pe", "forward_pe", "p_fcf", "ev_ebitda")
    sec_scores: list[float] = []
    for k in sec_keys:
        s, _ = _relative_multiple_score(m.get(k), safe_float(sec_avg.get(k)))
        if s is not None:
            sec_scores.append(s)
    sec_comp = sum(sec_scores) / len(sec_scores) if sec_scores else None

    peg_comp = None
    if m.get("peg") is not None and m["peg"] > 0:
        peg_comp = piecewise_score(
            m["peg"],
            [(0.5, 100.0), (1.0, 95.0), (1.5, 70.0), (2.0, 50.0), (3.0, 25.0), (3.5, 15.0), (5.0, 5.0)],
        )

    if hist_comp is not None or sec_comp is not None:
        val_score = weighted_average([(hist_comp, 0.50), (sec_comp, 0.35), (peg_comp, 0.15)])
    else:
        abs_mult = _first_not_none(m.get("forward_pe"), m.get("pe"))
        abs_comp = (
            piecewise_score(abs_mult, [(10.0, 90.0), (18.0, 70.0), (25.0, 55.0), (40.0, 30.0), (60.0, 10.0)])
            if abs_mult and abs_mult > 0
            else None
        )
        val_score = weighted_average([(abs_comp, 0.75), (peg_comp, 0.25)])

    years_cnt = m.get("hist_years_count") or 0
    if hist_diff_pct is not None and years_cnt >= 2:
        if hist_diff_pct <= -10.0:
            valuation_verdict = f"Moins chère que d'habitude : {hist_diff_pct:.0f} % vs moyenne {years_cnt}A"
        elif hist_diff_pct >= 10.0:
            valuation_verdict = f"Plus chère que d'habitude : +{hist_diff_pct:.0f} % vs moyenne {years_cnt}A"
        else:
            valuation_verdict = f"En ligne avec sa moyenne {years_cnt}A ({hist_diff_pct:+.0f} %)"
    elif val_score is not None:
        if val_score >= 65.0:
            valuation_verdict = "Valorisation attractive au regard des multiples"
        elif val_score >= 45.0:
            valuation_verdict = "Valorisation équilibrée"
        else:
            valuation_verdict = "Valorisation exigeante"
    else:
        valuation_verdict = "Données de valorisation limitées"

    # 2. Croissance /100
    g_breaks = [(-0.15, 5.0), (0.0, 25.0), (0.05, 45.0), (0.10, 65.0), (0.15, 80.0), (0.20, 90.0), (0.30, 100.0)]
    rev_score = weighted_average(
        [
            (piecewise_score(m.get("rev_growth_1y"), g_breaks), 0.45),
            (piecewise_score(m.get("rev_growth_3y"), g_breaks), 0.35),
            (piecewise_score(m.get("rev_growth_5y"), g_breaks), 0.20),
        ]
    )
    eps_score = weighted_average(
        [
            (piecewise_score(m.get("eps_growth_1y"), g_breaks), 0.45),
            (piecewise_score(m.get("eps_growth_3y"), g_breaks), 0.35),
            (piecewise_score(m.get("eps_growth_5y"), g_breaks), 0.20),
        ]
    )
    fcf_score = weighted_average(
        [
            (piecewise_score(m.get("fcf_growth_1y"), g_breaks), 0.45),
            (piecewise_score(m.get("fcf_growth_3y"), g_breaks), 0.35),
            (piecewise_score(m.get("fcf_growth_5y"), g_breaks), 0.20),
        ]
    )

    deltas: list[float] = []
    for k1, k3, k5 in (
        ("rev_growth_1y", "rev_growth_3y", "rev_growth_5y"),
        ("eps_growth_1y", "eps_growth_3y", "eps_growth_5y"),
    ):
        g1 = m.get(k1)
        glong = _first_not_none(m.get(k3), m.get(k5))
        if g1 is not None and glong is not None:
            deltas.append(g1 - glong)

    growth_trend = "Stable"
    dyn_score: Optional[float] = None
    bonus = 0.0
    if deltas:
        avg_delta = sum(deltas) / len(deltas)
        if avg_delta >= 0.03:
            growth_trend = "Accélération"
            dyn_score = min(100.0, 75.0 + avg_delta * 250.0)
            bonus = min(8.0, avg_delta * 80.0)
        elif avg_delta <= -0.03:
            growth_trend = "Ralentissement"
            dyn_score = max(5.0, 45.0 + avg_delta * 250.0)
            bonus = max(-8.0, avg_delta * 80.0)
        else:
            growth_trend = "Stable"
            dyn_score = 55.0

    growth_base = weighted_average(
        [(rev_score, 0.35), (eps_score, 0.35), (fcf_score, 0.20), (dyn_score, 0.10)]
    )
    growth_score = (
        round(max(0.0, min(100.0, growth_base + bonus * 0.5)), 1)
        if growth_base is not None
        else None
    )

    # 3. Qualité & Rentabilité /100
    gm_s = piecewise_score(
        m.get("gross_margin"),
        [(0.10, 15.0), (0.25, 40.0), (0.40, 65.0), (0.55, 82.0), (0.70, 95.0), (0.80, 100.0)],
    )
    om_s = piecewise_score(
        m.get("op_margin"),
        [(0.0, 10.0), (0.08, 35.0), (0.15, 60.0), (0.25, 80.0), (0.35, 95.0), (0.45, 100.0)],
    )
    nm_s = piecewise_score(
        m.get("net_margin"),
        [(-0.05, 5.0), (0.0, 15.0), (0.08, 45.0), (0.15, 70.0), (0.25, 90.0), (0.35, 100.0)],
    )
    ret_breaks = [(0.0, 10.0), (0.05, 40.0), (0.12, 70.0), (0.20, 95.0), (0.30, 100.0)]
    roe_s = piecewise_score(m.get("roe"), ret_breaks)
    roic_s = piecewise_score(m.get("roic"), ret_breaks)
    ret_s = weighted_average([(roe_s, 0.50), (roic_s, 0.50)])
    fcf_conv_s = piecewise_score(
        m.get("fcf_conversion"),
        [(0.0, 10.0), (0.30, 20.0), (0.70, 70.0), (0.90, 95.0), (1.10, 100.0)],
    )

    quality_score = weighted_average(
        [(gm_s, 0.25), (om_s, 0.25), (nm_s, 0.15), (ret_s, 0.20), (fcf_conv_s, 0.15)]
    )

    # 4. Santé Financière /100
    if financial_mode:
        fin_roe = piecewise_score(
            m.get("roe"), [(0.0, 10.0), (0.05, 40.0), (0.10, 68.0), (0.15, 88.0), (0.22, 100.0)]
        )
        fin_nm = piecewise_score(
            m.get("net_margin"), [(-0.05, 5.0), (0.05, 40.0), (0.15, 70.0), (0.25, 90.0), (0.35, 100.0)]
        )
        fin_de = piecewise_score(
            m.get("debt_to_equity"), [(1.0, 90.0), (4.0, 70.0), (10.0, 50.0), (20.0, 25.0)]
        )
        health_score = weighted_average([(fin_roe, 0.50), (fin_nm, 0.30), (fin_de, 0.20)])
        health_expl = "Santé financière évaluée selon les critères du secteur financier"
    else:
        nd_s = piecewise_score(
            m.get("net_debt_ebitda"),
            [(-1.0, 100.0), (0.0, 100.0), (1.0, 80.0), (2.5, 55.0), (3.5, 30.0), (4.5, 10.0), (6.0, 5.0)],
        )
        de_s = piecewise_score(
            m.get("debt_to_equity"),
            [(0.0, 100.0), (0.3, 95.0), (1.0, 65.0), (1.8, 35.0), (2.5, 15.0), (4.0, 5.0)],
        )
        cr_s = piecewise_score(
            m.get("current_ratio"),
            [(0.5, 5.0), (0.8, 15.0), (1.0, 45.0), (1.5, 75.0), (2.0, 95.0), (2.5, 100.0)],
        )
        health_score = weighted_average([(nd_s, 0.45), (de_s, 0.30), (cr_s, 0.25)])
        if m.get("net_debt_ebitda") is not None and m["net_debt_ebitda"] <= 0:
            health_expl = "Trésorerie nette positive (bilan solide)"
        elif m.get("net_debt_ebitda") is not None:
            health_expl = f"Dette nette / EBITDA : {m['net_debt_ebitda']:.1f}x"
        else:
            health_expl = "Structure financière (dette / liquidité)"

    # 5. Note Globale /100
    global_score = weighted_average(
        [(val_score, 0.25), (growth_score, 0.25), (quality_score, 0.30), (health_score, 0.20)]
    )

    # Summary Badge
    q_v = quality_score or 0.0
    v_v = val_score or 50.0
    g_v = growth_score or 50.0
    h_v = health_score or 50.0
    gl_v = global_score or 50.0

    if quality_score is not None and val_score is not None and q_v >= 70.0 and v_v >= 65.0:
        badge, badge_tone = "Leader sous-évalué", "emerald"
    elif quality_score is not None and val_score is not None and q_v >= 70.0 and v_v < 45.0:
        badge, badge_tone = "Qualité chère", "amber"
    elif growth_score is not None and health_score is not None and g_v >= 70.0 and h_v < 50.0:
        badge, badge_tone = "Croissance à risque", "coral"
    elif val_score is not None and growth_score is not None and v_v >= 75.0 and g_v < 45.0:
        badge, badge_tone = "Value / Décote", "emerald"
    elif gl_v >= 70.0:
        badge, badge_tone = "Fondamentaux solides", "emerald"
    elif gl_v >= 50.0:
        badge, badge_tone = "Équilibrée", "amber"
    else:
        badge, badge_tone = "À surveiller", "coral"

    growth_expl = f"Tendance : {growth_trend}"
    if m.get("rev_growth_1y") is not None:
        growth_expl += f" (CA 1A {m['rev_growth_1y'] * 100:+.1f} %)"

    quality_parts: list[str] = []
    if m.get("op_margin") is not None:
        quality_parts.append(f"Marge opé {m['op_margin'] * 100:.1f} %")
    if m.get("roe") is not None:
        quality_parts.append(f"ROE {m['roe'] * 100:.1f} %")
    quality_expl = " · ".join(quality_parts) if quality_parts else "Rentabilité des capitaux et marges"

    return sanitize_for_json(
        {
            "mode": "EQUITY",
            "global": {
                "score": global_score,
                "label": "Note Globale",
                "tone": score_tone(global_score),
                "explanation": "Moyenne pondérée (25% Valo, 25% Croissance, 30% Qualité, 20% Santé)",
            },
            "valuation": {
                "score": val_score,
                "label": "Valorisation",
                "tone": score_tone(val_score),
                "explanation": valuation_verdict,
            },
            "growth": {
                "score": growth_score,
                "label": "Croissance",
                "tone": score_tone(growth_score),
                "explanation": growth_expl,
            },
            "quality": {
                "score": quality_score,
                "label": "Qualité & Rentabilité",
                "tone": score_tone(quality_score),
                "explanation": quality_expl,
            },
            "health": {
                "score": health_score,
                "label": "Santé Financière",
                "tone": score_tone(health_score),
                "explanation": health_expl,
            },
            "summary_badge": badge,
            "summary_tone": badge_tone,
            "valuation_verdict": valuation_verdict,
            "growth_trend": growth_trend,
            "historical_averages": {
                "years_count": years_cnt,
                "pe": m.get("hist_avg_pe"),
                "p_fcf": m.get("hist_avg_p_fcf"),
                "ev_ebitda": m.get("hist_avg_ev_ebitda"),
                "diff_pct": hist_diff_pct,
            },
            "metrics": m,
            "etf_metrics": None,
        }
    )


def _window_perf_and_cagr(points: list[dict[str, Any]], years: Optional[int]) -> tuple[Optional[float], Optional[float]]:
    if len(points) < 2:
        return None, None
    last_pt = points[-1]
    last_close = safe_float(last_pt.get("close"))
    if last_close is None or last_close <= 0:
        return None, None

    if years is None:
        subset = points
    else:
        last_dt = datetime.strptime(last_pt["date"], "%Y-%m-%d")
        cutoff_str = (last_dt - timedelta(days=int(round(years * 365.25)))).strftime("%Y-%m-%d")
        subset = [p for p in points if p["date"] >= cutoff_str]
        if len(subset) < 2:
            return None, None
        # Ensure we actually have meaningful span (at least 75% of requested years)
        d0 = datetime.strptime(subset[0]["date"], "%Y-%m-%d")
        if (last_dt - d0).days < years * 270:
            return None, None

    first_close = safe_float(subset[0].get("close"))
    if first_close is None or first_close <= 0:
        return None, None

    perf = compute_percent_change(first_close, last_close)
    perf_pct = round(perf * 100.0, 2) if perf is not None else None

    d0 = datetime.strptime(subset[0]["date"], "%Y-%m-%d")
    d1 = datetime.strptime(subset[-1]["date"], "%Y-%m-%d")
    span_days = (d1 - d0).days
    cagr_pct = None
    if span_days >= 360:
        cagr = compute_cagr(first_close, last_close, span_days / 365.25)
        if cagr is not None:
            cagr_pct = round(cagr * 100.0, 2)

    return perf_pct, cagr_pct


def score_etf(quote: dict[str, Any], price_history_max: dict[str, Any]) -> dict[str, Any]:
    """Compute /100 scores adapted for ETFs (TER, Performance, AUM, Volatility & Drawdown)."""
    points = price_history_max.get("points") or []
    perf_1y, cagr_1y = _window_perf_and_cagr(points, 1)
    perf_3y, cagr_3y = _window_perf_and_cagr(points, 3)
    perf_5y, cagr_5y = _window_perf_and_cagr(points, 5)
    perf_max, cagr_max = _window_perf_and_cagr(points, None)

    vol_pct = safe_float(price_history_max.get("annualized_volatility_pct"))
    mdd_pct = safe_float(price_history_max.get("max_drawdown_pct"))

    ter = safe_float(quote.get("expense_ratio"))
    aum = safe_float(quote.get("total_assets"))

    fees_raw = piecewise_score(
        ter,
        [(0.0005, 100.0), (0.0015, 92.0), (0.0030, 80.0), (0.0050, 62.0), (0.0080, 35.0), (0.0150, 10.0)],
    )
    fees_score = round(fees_raw, 1) if fees_raw is not None else None
    ref_cagr_dec = (
        (cagr_5y / 100.0)
        if cagr_5y is not None
        else (cagr_3y / 100.0 if cagr_3y is not None else (cagr_1y / 100.0 if cagr_1y is not None else None))
    )
    perf_raw = piecewise_score(
        ref_cagr_dec,
        [(0.0, 20.0), (0.05, 50.0), (0.09, 75.0), (0.14, 92.0), (0.20, 100.0)],
    )
    perf_score = round(perf_raw, 1) if perf_raw is not None else None
    aum_raw = piecewise_score(
        aum,
        [(50e6, 25.0), (250e6, 55.0), (1e9, 75.0), (5e9, 92.0), (20e9, 100.0)],
    )
    aum_score = round(aum_raw, 1) if aum_raw is not None else None
    vol_s = piecewise_score(vol_pct, [(10.0, 95.0), (16.0, 75.0), (22.0, 55.0), (35.0, 20.0)])
    mdd_abs = abs(mdd_pct) if mdd_pct is not None else None
    mdd_s = piecewise_score(mdd_abs, [(10.0, 95.0), (20.0, 75.0), (35.0, 50.0), (55.0, 15.0)])
    risk_score = weighted_average([(vol_s, 0.50), (mdd_s, 0.50)])

    global_score = weighted_average(
        [(fees_score, 0.30), (perf_score, 0.30), (aum_score, 0.20), (risk_score, 0.20)]
    )

    gl_v = global_score or 50.0
    if gl_v >= 75.0:
        badge, badge_tone = "ETF de référence", "emerald"
    elif gl_v >= 55.0:
        badge, badge_tone = "ETF solide", "emerald"
    else:
        badge, badge_tone = "ETF à comparer", "amber"

    ter_pct = round(ter * 100.0, 2) if ter is not None else None
    fees_expl = f"Frais courants (TER) : {ter_pct:.2f} %" if ter_pct is not None else "Frais courants non publiés"
    perf_expl = (
        f"CAGR 5A : {cagr_5y:+.1f} % / an"
        if cagr_5y is not None
        else (f"CAGR 3A : {cagr_3y:+.1f} % / an" if cagr_3y is not None else "Historique de performance")
    )
    aum_expl = f"Encours : {aum / 1e9:.2f} Md" if aum and aum >= 1e9 else (f"Encours : {aum / 1e6:.0f} M" if aum else "Encours non publié")
    risk_parts: list[str] = []
    if vol_pct is not None:
        risk_parts.append(f"Volatilité {vol_pct:.1f} %")
    if mdd_pct is not None:
        risk_parts.append(f"Drawdown max {mdd_pct:.1f} %")
    risk_expl = " · ".join(risk_parts) if risk_parts else "Volatilité et drawdown historique"

    return sanitize_for_json(
        {
            "mode": "ETF",
            "global": {
                "score": global_score,
                "label": "Note Globale ETF",
                "tone": score_tone(global_score),
                "explanation": "Moyenne pondérée (30% Frais, 30% Performance, 20% Encours, 20% Risque)",
            },
            "valuation": {
                "score": fees_score,
                "label": "Frais (TER)",
                "tone": score_tone(fees_score),
                "explanation": fees_expl,
            },
            "growth": {
                "score": perf_score,
                "label": "Performance",
                "tone": score_tone(perf_score),
                "explanation": perf_expl,
            },
            "quality": {
                "score": aum_score,
                "label": "Encours (AUM)",
                "tone": score_tone(aum_score),
                "explanation": aum_expl,
            },
            "health": {
                "score": risk_score,
                "label": "Risque & Drawdown",
                "tone": score_tone(risk_score),
                "explanation": risk_expl,
            },
            "summary_badge": badge,
            "summary_tone": badge_tone,
            "valuation_verdict": fees_expl,
            "growth_trend": "ETF",
            "historical_averages": None,
            "metrics": None,
            "etf_metrics": {
                "ter_pct": ter_pct,
                "aum": aum,
                "perf_1y_pct": perf_1y,
                "perf_3y_pct": perf_3y,
                "perf_5y_pct": perf_5y,
                "perf_max_pct": perf_max,
                "cagr_3y_pct": cagr_3y,
                "cagr_5y_pct": cagr_5y,
                "cagr_max_pct": cagr_max,
                "volatility_pct": vol_pct,
                "max_drawdown_pct": mdd_pct,
            },
        }
    )


def persist_asset_scores(
    db: Session,
    ticker: str,
    scores: dict[str, Any],
) -> None:
    """Persist computed metrics & 5 /100 scores onto the Asset row for Screener & Portfolio."""
    if _is_sqlite_session(db):
        with _sqlite_write_lock:
            _write_asset_scores(db, ticker, scores)
    else:
        _write_asset_scores(db, ticker, scores)


def _write_asset_scores(
    db: Session,
    ticker: str,
    scores: dict[str, Any],
) -> None:
    asset = db.get(Asset, ticker)
    if asset is None:
        return

    metrics = scores.get("metrics") or {}
    if metrics:
        if metrics.get("pe") is not None:
            asset.pe = metrics["pe"]
        if metrics.get("forward_pe") is not None:
            asset.forward_pe = metrics["forward_pe"]
        asset.p_fcf = metrics.get("p_fcf")
        if metrics.get("peg") is not None:
            asset.peg = metrics["peg"]
        asset.rev_growth_1y = metrics.get("rev_growth_1y")
        asset.rev_growth_3y = metrics.get("rev_growth_3y")
        asset.eps_growth_1y = metrics.get("eps_growth_1y")
        if metrics.get("gross_margin") is not None:
            asset.gross_margin = metrics["gross_margin"]
        if metrics.get("op_margin") is not None:
            asset.op_margin = metrics["op_margin"]
        if metrics.get("net_margin") is not None:
            asset.net_margin = metrics["net_margin"]
        if metrics.get("roe") is not None:
            asset.roe = metrics["roe"]
        asset.net_debt_ebitda = metrics.get("net_debt_ebitda")

    asset.score_global = (scores.get("global") or {}).get("score")
    asset.score_valuation = (scores.get("valuation") or {}).get("score")
    asset.score_growth = (scores.get("growth") or {}).get("score")
    asset.score_quality = (scores.get("quality") or {}).get("score")
    asset.score_health = (scores.get("health") or {}).get("score")
    asset.updated_at = utc_now()
    try:
        db.commit()
    except Exception:
        db.rollback()
