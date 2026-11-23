from datetime import datetime
from typing import Any, Optional

from app.services.scoring_engine import is_financial_sector
from app.utils.math_utils import compute_cagr, safe_float, sanitize_for_json, utc_now


def detect_red_flags(
    quote: dict[str, Any],
    fundamentals: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Detect fundamental warning signals (red flags) on an equity."""
    if (quote or {}).get("asset_type") == "ETF" or not fundamentals:
        return []

    annual: list[dict[str, Any]] = fundamentals.get("annual") or []
    ttm: Optional[dict[str, Any]] = (
        fundamentals.get("ttm") if isinstance(fundamentals.get("ttm"), dict) else None
    )
    alerts: list[dict[str, Any]] = []

    # 1. Strong share dilution (> +3% CAGR over recent annual reports)
    share_recs = [
        r for r in annual if safe_float(r.get("shares_outstanding")) and safe_float(r.get("shares_outstanding")) > 0
    ]
    if len(share_recs) >= 2:
        window = share_recs[-4:] if len(share_recs) >= 4 else share_recs
        first_rec, last_rec = window[0], window[-1]
        fy0 = first_rec.get("fiscal_year")
        fy1 = last_rec.get("fiscal_year")
        yrs = (
            int(fy1) - int(fy0)
            if isinstance(fy0, int) and isinstance(fy1, int) and fy1 > fy0
            else len(window) - 1
        )
        yrs = max(1, yrs)
        share_cagr = compute_cagr(
            safe_float(first_rec.get("shares_outstanding")),
            safe_float(last_rec.get("shares_outstanding")),
            yrs,
        )
        if share_cagr is not None and share_cagr > 0.03:
            pct_yr = share_cagr * 100.0
            alerts.append(
                {
                    "id": "dilution",
                    "title": "Dilution forte des actionnaires",
                    "severity": "high" if share_cagr > 0.05 else "medium",
                    "value_label": f"+{pct_yr:.1f} % / an ({yrs} ans)",
                    "detail": (
                        f"Le nombre d'actions a progressé de +{pct_yr:.1f} % par an en moyenne "
                        f"sur {yrs} ans (seuil d'alerte : +3 %/an), réduisant votre part du gâteau."
                    ),
                }
            )

    # 2. Earnings quality: positive net income but negative free cash flow
    ref_rec = None
    if (
        ttm
        and safe_float(ttm.get("net_income")) is not None
        and safe_float(ttm.get("free_cash_flow")) is not None
    ):
        ref_rec = ttm
    elif annual:
        ref_rec = annual[-1]

    if ref_rec:
        ni = safe_float(ref_rec.get("net_income"))
        fcf = safe_float(ref_rec.get("free_cash_flow"))
        if ni is not None and fcf is not None and ni > 0 and fcf < 0:
            alerts.append(
                {
                    "id": "earnings_quality",
                    "title": "Qualité du bénéfice fragile",
                    "severity": "high",
                    "value_label": "Bénéfice > 0 · FCF < 0",
                    "detail": (
                        "L'entreprise affiche un bénéfice net comptable positif alors que son cash libre (FCF) "
                        "est négatif : le cash réel ne rentre pas autant que le résultat affiché."
                    ),
                }
            )

    # 3. High leverage: Net Debt / EBITDA > 3.0x (excluding banks & insurers)
    if not is_financial_sector(quote.get("sector"), quote.get("industry")):
        nd_ebitda = safe_float((ttm or {}).get("net_debt_ebitda"))
        if nd_ebitda is None and annual:
            nd_ebitda = safe_float(annual[-1].get("net_debt_ebitda"))
        if nd_ebitda is None:
            debt = safe_float(quote.get("total_debt_info"))
            cash = safe_float(quote.get("total_cash_info")) or 0.0
            ebitda = safe_float(quote.get("ebitda_info"))
            if debt is not None and ebitda is not None and ebitda > 0:
                nd_ebitda = (debt - cash) / ebitda
        if nd_ebitda is not None and nd_ebitda > 3.0:
            alerts.append(
                {
                    "id": "high_debt",
                    "title": "Endettement élevé",
                    "severity": "high" if nd_ebitda > 4.5 else "medium",
                    "value_label": f"Dette nette / EBITDA : {nd_ebitda:.1f}x",
                    "detail": (
                        f"Il faudrait {nd_ebitda:.1f} années d'EBITDA pour rembourser la dette nette "
                        "(seuil de prudence : 3,0x)."
                    ),
                }
            )

    # 4. Continuous operating margin erosion over the last 3 fiscal years
    op_margins = [safe_float(r.get("op_margin")) for r in annual if safe_float(r.get("op_margin")) is not None]
    if len(op_margins) >= 3:
        m3, m2, m1 = op_margins[-3], op_margins[-2], op_margins[-1]
        if m3 is not None and m2 is not None and m1 is not None and (m3 > m2 > m1):
            drop_pts = (m1 - m3) * 100.0
            alerts.append(
                {
                    "id": "margin_erosion",
                    "title": "Érosion continue des marges",
                    "severity": "medium",
                    "value_label": f"{m3 * 100:.1f} % → {m1 * 100:.1f} % ({drop_pts:+.1f} pts)",
                    "detail": (
                        f"La marge opérationnelle recule sans interruption sur les 3 derniers exercices "
                        f"({m3 * 100:.1f} % → {m2 * 100:.1f} % → {m1 * 100:.1f} %)."
                    ),
                }
            )

    return sanitize_for_json(alerts)


def compute_dca_plan(
    amount_eur: float,
    etf_target_pct: float,
    mode: str,
    positions: list[dict[str, Any]],
    watchlist_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute a buy-only monthly/lump-sum allocation plan (Standard rebalancing or Opportunistic)."""
    amt = max(1.0, float(amount_eur))
    etf_pct = max(0.0, min(100.0, float(etf_target_pct)))
    eq_pct = 100.0 - etf_pct
    mode_norm = "opportunistic" if mode == "opportunistic" else "standard"

    curr_etf = sum(float(p.get("current_value_eur") or 0.0) for p in positions if p.get("asset_type") == "ETF")
    curr_eq = sum(float(p.get("current_value_eur") or 0.0) for p in positions if p.get("asset_type") != "ETF")
    curr_total = curr_etf + curr_eq

    current_etf_pct = (curr_etf / curr_total * 100.0) if curr_total > 0 else etf_pct
    current_eq_pct = 100.0 - current_etf_pct if curr_total > 0 else eq_pct

    # Pure buy-only rebalancing towards target weights
    new_total = curr_total + amt
    deficit_etf = max(0.0, new_total * (etf_pct / 100.0) - curr_etf)
    deficit_eq = max(0.0, new_total * (eq_pct / 100.0) - curr_eq)

    if deficit_etf + deficit_eq > 0:
        etf_budget = amt * (deficit_etf / (deficit_etf + deficit_eq))
        eq_budget = amt - etf_budget
    else:
        etf_budget = amt * (etf_pct / 100.0)
        eq_budget = amt - etf_budget

    explanations: list[str] = []
    if curr_total > 0:
        explanations.append(
            f"Répartition actuelle : {current_etf_pct:.1f} % ETF / {current_eq_pct:.1f} % Actions "
            f"(cible {etf_pct:.0f} % / {eq_pct:.0f} %)."
        )
    else:
        explanations.append(
            f"Portefeuille vide : répartition directe selon votre cible {etf_pct:.0f} % ETF / {eq_pct:.0f} % Actions."
        )

    # Identify opportunistic deeply undervalued high-quality candidates
    by_ticker_candidate: dict[str, dict[str, Any]] = {}
    for src_label, pool in (("Portefeuille", positions), ("Watchlist", watchlist_items)):
        for item in pool:
            if item.get("asset_type") == "ETF":
                continue
            sym = str(item.get("ticker") or "").upper()
            if not sym:
                continue
            score = safe_float(item.get("score_global"))
            mos = safe_float(item.get("margin_of_safety_pct"))
            existing = by_ticker_candidate.get(sym)
            cand = {
                "ticker": sym,
                "name": item.get("name") or sym,
                "score_global": score,
                "margin_of_safety_pct": mos,
                "envelope": item.get("envelope") or ("PEA" if item.get("pea_eligible") else "CTO"),
                "pea_eligible": bool(item.get("pea_eligible", False)),
                "source": "Portefeuille" if (existing and existing["source"] == "Portefeuille") or src_label == "Portefeuille" else "Watchlist",
                "current_value_eur": float(item.get("current_value_eur") or (existing or {}).get("current_value_eur") or 0.0),
            }
            if existing is None:
                by_ticker_candidate[sym] = cand
            else:
                if src_label == "Portefeuille":
                    existing["envelope"] = cand["envelope"]
                    existing["current_value_eur"] = max(existing["current_value_eur"], cand["current_value_eur"])
                    existing["source"] = "Portefeuille"
                if existing["score_global"] is None:
                    existing["score_global"] = score
                if existing["margin_of_safety_pct"] is None:
                    existing["margin_of_safety_pct"] = mos

    qualifying = [
        c
        for c in by_ticker_candidate.values()
        if (c["score_global"] or 0.0) >= 75.0 and (c["margin_of_safety_pct"] or -999.0) >= 15.0
    ]
    qualifying.sort(
        key=lambda c: float(c["score_global"] or 0.0) * float(c["margin_of_safety_pct"] or 0.0),
        reverse=True,
    )

    opportunistic_triggered = False
    if mode_norm == "opportunistic":
        if qualifying and etf_budget > 0:
            top = qualifying[0]
            top_mos = float(top["margin_of_safety_pct"] or 0.0)
            shift_ratio = 0.30 if (top_mos >= 30.0 or len(qualifying) >= 2) else 0.20
            shift_eur = min(etf_budget, amt * shift_ratio)
            if shift_eur > 0.5:
                etf_budget -= shift_eur
                eq_budget += shift_eur
                opportunistic_triggered = True
                explanations.append(
                    f"Mode Opportuniste activé : {top['ticker']} affiche un score de {top['score_global']:.0f}/100 "
                    f"et cote à -{top_mos:.0f} % de son prix juste → {shift_eur:.0f} € déplacés des ETF vers les actions."
                )
        else:
            explanations.append(
                "Aucune action (portefeuille ou watchlist) ne combine actuellement Note ≥ 75/100 et décote ≥ 15 % : "
                "maintien du rééquilibrage Standard."
            )

    lines: list[dict[str, Any]] = []

    # Allocate ETF budget across held ETFs (prioritize PEA ETFs) or generic PEA placeholder
    if etf_budget >= 0.01:
        held_etfs = [p for p in positions if p.get("asset_type") == "ETF"]
        if held_etfs:
            # Split across all held ETFs proportional to value (PEA ETFs first)
            held_etfs.sort(
                key=lambda p: (0 if p.get("envelope") == "PEA" else 1, -float(p.get("current_value_eur") or 0.0))
            )
            chosen_etfs = held_etfs
            weights = [max(1.0, float(p.get("current_value_eur") or 1.0)) for p in chosen_etfs]
            w_sum = sum(weights)
            for p, w in zip(chosen_etfs, weights):
                lines.append(
                    {
                        "ticker": p["ticker"],
                        "name": p.get("name") or p["ticker"],
                        "bucket": "ETF",
                        "envelope": p.get("envelope") or "PEA",
                        "amount_eur": etf_budget * (w / w_sum),
                        "share_pct": (etf_budget * (w / w_sum)) / amt * 100.0,
                        "reason": "Socle ETF rééquilibré",
                        "score_global": safe_float(p.get("score_global")),
                        "margin_of_safety_pct": None,
                        "source": "Portefeuille",
                    }
                )
        else:
            lines.append(
                {
                    "ticker": "CW8.PA / WPEA.PA",
                    "name": "ETF Monde éligible PEA (ex. Amundi / iShares)",
                    "bucket": "ETF",
                    "envelope": "PEA",
                    "amount_eur": etf_budget,
                    "share_pct": etf_budget / amt * 100.0,
                    "reason": "Cible ETF PEA (aucun ETF encore en portefeuille)",
                    "score_global": None,
                    "margin_of_safety_pct": None,
                    "source": "Cible",
                }
            )

    # Allocate Equity budget
    if eq_budget >= 0.01:
        if mode_norm == "opportunistic" and qualifying:
            chosen_eq = qualifying[:3]
            weights = [
                max(1.0, float(c["score_global"] or 75.0) * float(c["margin_of_safety_pct"] or 15.0))
                for c in chosen_eq
            ]
            w_sum = sum(weights)
            for c, w in zip(chosen_eq, weights):
                alloc = eq_budget * (w / w_sum)
                mos = float(c["margin_of_safety_pct"] or 0.0)
                lines.append(
                    {
                        "ticker": c["ticker"],
                        "name": c["name"],
                        "bucket": "EQUITY",
                        "envelope": c["envelope"],
                        "amount_eur": alloc,
                        "share_pct": alloc / amt * 100.0,
                        "reason": f"Décote -{mos:.0f} % · Note {c['score_global']:.0f}/100 ({c['source']})",
                        "score_global": c["score_global"],
                        "margin_of_safety_pct": mos,
                        "source": c["source"],
                    }
                )
        else:
            held_eqs = [p for p in positions if p.get("asset_type") != "ETF"]
            if held_eqs:
                scored_eqs = sorted(
                    held_eqs,
                    key=lambda p: (
                        float(p.get("score_global") or 50.0) + max(0.0, float(p.get("margin_of_safety_pct") or 0.0))
                    ),
                    reverse=True,
                )
                weights = [
                    max(
                        10.0,
                        float(p.get("score_global") or 50.0) + max(0.0, float(p.get("margin_of_safety_pct") or 0.0)),
                    )
                    for p in scored_eqs
                ]
                w_sum = sum(weights)
                for p, w in zip(scored_eqs, weights):
                    alloc = eq_budget * (w / w_sum)
                    sc = safe_float(p.get("score_global"))
                    mos = safe_float(p.get("margin_of_safety_pct"))
                    reason_parts = []
                    if sc is not None:
                        reason_parts.append(f"Note {sc:.0f}/100")
                    if mos is not None and mos > 0:
                        reason_parts.append(f"décote -{mos:.0f} %")
                    lines.append(
                        {
                            "ticker": p["ticker"],
                            "name": p.get("name") or p["ticker"],
                            "bucket": "EQUITY",
                            "envelope": p.get("envelope") or "CTO",
                            "amount_eur": alloc,
                            "share_pct": alloc / amt * 100.0,
                            "reason": " · ".join(reason_parts) if reason_parts else "Renforcement équilibré",
                            "score_global": sc,
                            "margin_of_safety_pct": mos,
                            "source": "Portefeuille",
                        }
                    )
            else:
                wl_eqs = [w for w in watchlist_items if w.get("asset_type") != "ETF"]
                wl_eqs.sort(
                    key=lambda w: float(w.get("score_global") or 50.0) + max(0.0, float(w.get("margin_of_safety_pct") or 0.0)),
                    reverse=True,
                )
                if wl_eqs:
                    top_wl = wl_eqs[0]
                    lines.append(
                        {
                            "ticker": top_wl["ticker"],
                            "name": top_wl.get("name") or top_wl["ticker"],
                            "bucket": "EQUITY",
                            "envelope": "PEA" if top_wl.get("pea_eligible") else "CTO",
                            "amount_eur": eq_budget,
                            "share_pct": eq_budget / amt * 100.0,
                            "reason": "Meilleure valeur de votre Watchlist",
                            "score_global": safe_float(top_wl.get("score_global")),
                            "margin_of_safety_pct": safe_float(top_wl.get("margin_of_safety_pct")),
                            "source": "Watchlist",
                        }
                    )
                else:
                    lines.append(
                        {
                            "ticker": "Actions CTO",
                            "name": "Poche actions individuelles",
                            "bucket": "EQUITY",
                            "envelope": "CTO",
                            "amount_eur": eq_budget,
                            "share_pct": eq_budget / amt * 100.0,
                            "reason": "Cible Actions (ajoutez des titres ou une watchlist)",
                            "score_global": None,
                            "margin_of_safety_pct": None,
                            "source": "Cible",
                        }
                    )

    # Round amounts to 2 decimals and fix any 0.01 rounding residual on largest line
    for ln in lines:
        ln["amount_eur"] = round(float(ln["amount_eur"]), 2)
        ln["share_pct"] = round(float(ln["share_pct"]), 1)

    if lines:
        diff = round(round(amt, 2) - sum(ln["amount_eur"] for ln in lines), 2)
        if abs(diff) > 0:
            largest = max(lines, key=lambda ln: ln["amount_eur"])
            largest["amount_eur"] = round(largest["amount_eur"] + diff, 2)
            largest["share_pct"] = round(largest["amount_eur"] / amt * 100.0, 1)

    proj_etf_pct = ((curr_etf + etf_budget) / new_total * 100.0) if new_total > 0 else etf_pct
    proj_eq_pct = 100.0 - proj_etf_pct

    return sanitize_for_json(
        {
            "amount_eur": round(amt, 2),
            "mode": mode_norm,
            "etf_target_pct": round(etf_pct, 1),
            "equities_target_pct": round(eq_pct, 1),
            "current_etf_pct": round(current_etf_pct, 1),
            "current_equities_pct": round(current_eq_pct, 1),
            "projected_etf_pct": round(proj_etf_pct, 1),
            "projected_equities_pct": round(proj_eq_pct, 1),
            "etf_budget_eur": round(etf_budget, 2),
            "equities_budget_eur": round(eq_budget, 2),
            "opportunistic_triggered": opportunistic_triggered,
            "explanations": explanations,
            "lines": lines,
        }
    )


def simulate_wealth_projection(
    *,
    initial_pea_value: float = 0.0,
    initial_pea_contributions: float = 0.0,
    initial_cto_value: float = 0.0,
    initial_cto_contributions: float = 0.0,
    monthly_contribution: float = 400.0,
    pea_share_pct: float = 70.0,
    annual_return_pct: float = 8.0,
    horizon_years: int = 20,
    inflation_pct: float = 2.0,
    pea_tax_rate_pct: float = 18.6,
    cto_tax_rate_pct: float = 31.4,
    pea_cap_eur: float = 150_000.0,
    index_contributions_to_inflation: bool = True,
    career_growth_pct: float = 0.0,
    base_year: Optional[int] = None,
) -> dict[str, Any]:
    """Compound wealth projection with automatic PEA 150 000 EUR contribution cap rollover to CTO."""
    horizon = max(1, min(40, int(horizon_years)))
    pea_val = max(0.0, float(initial_pea_value))
    pea_contrib = max(0.0, float(initial_pea_contributions))
    cto_val = max(0.0, float(initial_cto_value))
    cto_contrib = max(0.0, float(initial_cto_contributions))
    monthly = max(0.0, float(monthly_contribution))
    pea_share = max(0.0, min(100.0, float(pea_share_pct))) / 100.0
    cap = max(0.0, float(pea_cap_eur))
    pea_tax_r = max(0.0, min(100.0, float(pea_tax_rate_pct))) / 100.0
    cto_tax_r = max(0.0, min(100.0, float(cto_tax_rate_pct))) / 100.0
    inf_r = max(-10.0, min(25.0, float(inflation_pct))) / 100.0
    career_r = max(0.0, min(20.0, float(career_growth_pct))) / 100.0
    annual_contrib_growth = (inf_r if index_contributions_to_inflation else 0.0) + career_r

    r_annual = max(-0.99, float(annual_return_pct) / 100.0)
    r_month = (1.0 + r_annual) ** (1.0 / 12.0) - 1.0
    start_year = int(base_year or utc_now().year)

    pea_cap_reached_year: Optional[int] = 0 if pea_contrib >= cap - 1e-6 else None

    def _snapshot(yr: int) -> dict[str, Any]:
        gross = pea_val + cto_val
        contributed = pea_contrib + cto_contrib
        pea_gain = max(0.0, pea_val - pea_contrib)
        cto_gain = max(0.0, cto_val - cto_contrib)
        tax = pea_gain * pea_tax_r + cto_gain * cto_tax_r
        net = gross - tax
        inf_factor = (1.0 + inf_r) ** yr
        net_real = net / inf_factor if inf_factor > 0 else net
        return {
            "year": yr,
            "calendar_year": start_year + yr,
            "contributed_eur": round(contributed, 2),
            "pea_contributed_eur": round(pea_contrib, 2),
            "cto_contributed_eur": round(cto_contrib, 2),
            "pea_value_eur": round(pea_val, 2),
            "cto_value_eur": round(cto_val, 2),
            "gross_value_eur": round(gross, 2),
            "net_value_eur": round(net, 2),
            "net_real_value_eur": round(net_real, 2),
        }

    points = [_snapshot(0)]
    last_year_monthly = monthly
    for yr in range(1, horizon + 1):
        year_monthly = monthly * ((1.0 + annual_contrib_growth) ** (yr - 1))
        last_year_monthly = year_monthly
        for _ in range(12):
            pea_val *= 1.0 + r_month
            cto_val *= 1.0 + r_month

            remaining_room = max(0.0, cap - pea_contrib)
            pea_add = min(year_monthly * pea_share, remaining_room)
            cto_add = year_monthly - pea_add

            pea_contrib += pea_add
            pea_val += pea_add
            cto_contrib += cto_add
            cto_val += cto_add

            if pea_cap_reached_year is None and pea_contrib >= cap - 1e-6 and year_monthly > 0 and pea_share > 0:
                pea_cap_reached_year = yr

        points.append(_snapshot(yr))

    final = points[-1]
    total_taxes = round(final["gross_value_eur"] - final["net_value_eur"], 2)
    cap_cal_year = (start_year + pea_cap_reached_year) if pea_cap_reached_year is not None else None
    real_denom = (1.0 + inf_r) ** max(0, horizon - 1)
    final_monthly_real = (last_year_monthly / real_denom) if real_denom > 0 else last_year_monthly

    return sanitize_for_json(
        {
            "pea_cap_eur": round(cap, 2),
            "horizon_years": horizon,
            "index_contributions_to_inflation": bool(index_contributions_to_inflation),
            "career_growth_pct": round(career_r * 100.0, 2),
            "final_monthly_contribution_eur": round(last_year_monthly, 2),
            "final_monthly_contribution_real_eur": round(final_monthly_real, 2),
            "final_contributed_eur": final["contributed_eur"],
            "final_gross_eur": final["gross_value_eur"],
            "final_net_eur": final["net_value_eur"],
            "final_net_real_eur": final["net_real_value_eur"],
            "final_pea_value_eur": final["pea_value_eur"],
            "final_cto_value_eur": final["cto_value_eur"],
            "total_taxes_eur": max(0.0, total_taxes),
            "pea_cap_reached_year": pea_cap_reached_year,
            "pea_cap_reached_calendar_year": cap_cal_year,
            "monthly_rent_4pct_net_eur": round(final["net_value_eur"] * 0.04 / 12.0, 2),
            "monthly_rent_4pct_real_eur": round(final["net_real_value_eur"] * 0.04 / 12.0, 2),
            "points": points,
        }
    )
