import logging
from datetime import datetime
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.services.cache_service import cache_service
from app.utils.math_utils import safe_float

logger = logging.getLogger(__name__)

SEC_HEADERS = {"User-Agent": "FinScopePersonalApp/1.0 (contact@finscope.local)"}
SEC_CIK_CACHE_KEY = "sec:cik_map"
_mem_cik_map: Optional[dict[str, str]] = None

TAG_PRIORITIES: dict[str, list[str]] = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
    ],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "pretax_income": [
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
    "tax_provision": ["IncomeTaxExpenseBenefit"],
    "depreciation": [
        "DepreciationDepletionAndAmortization",
        "DepreciationAndAmortization",
        "Depreciation",
    ],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "shares": [
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "WeightedAverageNumberOfSharesOutstandingBasic",
    ],
    "shares_instant": ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
    "operating_cash_flow": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "capex": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ],
    "cash": [
        "CashCashEquivalentsAndShortTermInvestments",
        "CashAndCashEquivalentsAtCarryingValue",
    ],
    "long_term_debt": [
        "LongTermDebtNoncurrent",
        "LongTermDebt",
        "LongTermDebtAndCapitalLeaseObligations",
    ],
    "short_term_debt": [
        "ShortTermBorrowings",
        "LongTermDebtCurrent",
        "DebtCurrent",
    ],
    "total_debt": ["DebtAndCapitalLeaseObligations"],
    "total_equity": [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    "current_assets": ["AssetsCurrent"],
    "current_liabilities": ["LiabilitiesCurrent"],
}


def _parse_date(date_str: str) -> Optional[datetime]:
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d")
    except Exception:
        return None


def _load_cik_map(db: Session) -> dict[str, str]:
    global _mem_cik_map
    if _mem_cik_map is not None:
        return _mem_cik_map

    cached = cache_service.get(db, SEC_CIK_CACHE_KEY)
    if cached is not None and isinstance(cached.payload, dict):
        _mem_cik_map = cached.payload
        return _mem_cik_map

    try:
        with httpx.Client(timeout=10.0, headers=SEC_HEADERS) as client:
            resp = client.get("https://www.sec.gov/files/company_tickers.json")
            if resp.status_code != 200:
                return {}
            raw = resp.json()
            mapping: dict[str, str] = {}
            for entry in raw.values():
                t = str(entry.get("ticker") or "").strip().upper()
                cik = entry.get("cik_str")
                if t and cik is not None:
                    mapping[t] = str(cik).zfill(10)
            if mapping:
                _mem_cik_map = mapping
                cache_service.set(db, SEC_CIK_CACHE_KEY, "fundamentals", mapping, ttl_seconds=7 * 86400)
            return mapping
    except Exception as exc:
        logger.warning("Failed to fetch SEC CIK map: %s", exc)
        return {}


def _split_factor_for_filing(filed_date: str, splits: list[dict[str, Any]]) -> float:
    factor = 1.0
    if not filed_date or not splits:
        return factor
    for sp in splits:
        sp_date = str(sp.get("date") or "")[:10]
        ratio = safe_float(sp.get("ratio"))
        if sp_date and ratio and ratio > 0 and filed_date < sp_date:
            factor *= ratio
    return factor


def _collect_duration_facts(
    facts_root: dict[str, Any],
    metric: str,
    unit_name: str,
    splits: Optional[list[dict[str, Any]]] = None,
    split_mode: Optional[str] = None,
    allow_ytd_diff: bool = True,
) -> tuple[dict[str, float], dict[str, float]]:
    """Extract annual (300-400d) and standalone quarterly (65-115d, incl. derived YTD/Q4) dicts keyed by end_date."""
    us_gaap = facts_root.get("us-gaap") or {}
    tags = TAG_PRIORITIES.get(metric, [])
    valid_forms = {"10-K", "10-K/A", "10-Q", "10-Q/A"}

    # Deduplicate by (start, end): higher tag priority (lower index) wins, then latest filed date
    best_by_span: dict[tuple[str, str], tuple[int, str, float, str]] = {}

    for prio, tag in enumerate(tags):
        tag_obj = us_gaap.get(tag)
        if not isinstance(tag_obj, dict):
            continue
        items = (tag_obj.get("units") or {}).get(unit_name) or []
        for item in items:
            form = str(item.get("form") or "")
            if form not in valid_forms:
                continue
            start_s = str(item.get("start") or "")[:10]
            end_s = str(item.get("end") or "")[:10]
            filed_s = str(item.get("filed") or "")[:10]
            val = safe_float(item.get("val"))
            if not start_s or not end_s or val is None:
                continue

            if split_mode and splits:
                factor = _split_factor_for_filing(filed_s, splits)
                if factor != 1.0:
                    if split_mode == "eps":
                        val = val / factor
                    elif split_mode == "shares":
                        val = val * factor

            key = (start_s, end_s)
            prev = best_by_span.get(key)
            if prev is None or prio < prev[0] or (prio == prev[0] and filed_s > prev[1]):
                best_by_span[key] = (prio, filed_s, val, form)

    annual_by_end: dict[str, tuple[str, float]] = {}
    q_standalone: dict[str, tuple[str, float, str]] = {}
    ytd_6m: dict[str, tuple[str, float]] = {}
    ytd_9m: dict[str, tuple[str, float]] = {}
    fy_by_start: dict[str, tuple[str, float]] = {}

    for (start_s, end_s), (_, _, val, form) in best_by_span.items():
        d0 = _parse_date(start_s)
        d1 = _parse_date(end_s)
        if d0 is None or d1 is None:
            continue
        days = (d1 - d0).days
        if 300 <= days <= 400 and form in {"10-K", "10-K/A"}:
            prev_a = annual_by_end.get(end_s)
            if prev_a is None:
                annual_by_end[end_s] = (start_s, val)
            fy_by_start[start_s] = (end_s, val)
        elif 65 <= days <= 115:
            prev_q = q_standalone.get(end_s)
            if prev_q is None:
                q_standalone[end_s] = (start_s, val, end_s)
        elif 150 <= days <= 200:
            ytd_6m[start_s] = (end_s, val)
        elif 240 <= days <= 295:
            ytd_9m[start_s] = (end_s, val)

    # Derive Q2/Q3 from cumulative YTD (common for Cash Flow) & Q4 from FY - 9M or FY - (Q1+Q2+Q3)
    q_by_start_and_end: dict[str, dict[str, float]] = {}
    for end_s, (start_s, val, _) in q_standalone.items():
        q_by_start_and_end.setdefault(start_s, {})[end_s] = val

    # Match YTD and FY periods starting within +-5 days of a known fiscal start
    quarterly_out: dict[str, float] = {end_s: val for end_s, (_, val, _) in q_standalone.items()}

    if allow_ytd_diff:
        for fy_start, (fy_end, fy_val) in fy_by_start.items():
            fy_start_dt = _parse_date(fy_start)
            fy_end_dt = _parse_date(fy_end)
            if not fy_start_dt or not fy_end_dt:
                continue

            def _near_start(candidate_map: dict[str, tuple[str, float]]) -> Optional[tuple[str, float]]:
                if fy_start in candidate_map:
                    return candidate_map[fy_start]
                for s_key, pair in candidate_map.items():
                    s_dt = _parse_date(s_key)
                    if s_dt and abs((s_dt - fy_start_dt).days) <= 6:
                        return pair
                return None

            # Collect Q1 starting near fy_start
            q1_match: Optional[tuple[str, float]] = None
            for end_s, (s_s, q_val, _) in q_standalone.items():
                s_dt = _parse_date(s_s)
                e_dt = _parse_date(end_s)
                if s_dt and e_dt and abs((s_dt - fy_start_dt).days) <= 6:
                    q1_match = (end_s, q_val)
                    break

            m6_match = _near_start(ytd_6m)
            m9_match = _near_start(ytd_9m)

            if q1_match and m6_match and m6_match[0] not in quarterly_out:
                quarterly_out[m6_match[0]] = m6_match[1] - q1_match[1]
            if m6_match and m9_match and m9_match[0] not in quarterly_out:
                quarterly_out[m9_match[0]] = m9_match[1] - m6_match[1]

            if fy_end not in quarterly_out:
                if m9_match:
                    quarterly_out[fy_end] = fy_val - m9_match[1]
                else:
                    # Sum 3 standalone quarters falling inside (fy_start - 6d, fy_end - 45d)
                    sub_qs = []
                    for q_end, (q_start, q_val, _) in q_standalone.items():
                        qs_dt = _parse_date(q_start)
                        qe_dt = _parse_date(q_end)
                        if (
                            qs_dt
                            and qe_dt
                            and (qs_dt - fy_start_dt).days >= -6
                            and (fy_end_dt - qe_dt).days >= 45
                        ):
                            sub_qs.append((q_end, q_val))
                    if len(sub_qs) == 3:
                        quarterly_out[fy_end] = fy_val - sum(v for _, v in sub_qs)

    annual_out = {end_s: pair[1] for end_s, pair in annual_by_end.items()}
    return annual_out, quarterly_out


def _collect_instant_facts(
    facts_root: dict[str, Any],
    metric: str,
    unit_name: str,
    splits: Optional[list[dict[str, Any]]] = None,
    split_mode: Optional[str] = None,
) -> dict[str, float]:
    tags = TAG_PRIORITIES.get(metric, [])
    best_by_end: dict[str, tuple[int, str, float]] = {}
    valid_forms = {"10-K", "10-K/A", "10-Q", "10-Q/A"}

    for scope_name in ("us-gaap", "dei"):
        scope = facts_root.get(scope_name) or {}
        for prio, tag in enumerate(tags):
            tag_obj = scope.get(tag)
            if not isinstance(tag_obj, dict):
                continue
            items = (tag_obj.get("units") or {}).get(unit_name) or []
            for item in items:
                form = str(item.get("form") or "")
                if form not in valid_forms:
                    continue
                end_s = str(item.get("end") or "")[:10]
                filed_s = str(item.get("filed") or "")[:10]
                val = safe_float(item.get("val"))
                if not end_s or val is None:
                    continue
                if split_mode == "shares" and splits:
                    factor = _split_factor_for_filing(filed_s, splits)
                    if factor != 1.0:
                        val = val * factor
                prev = best_by_end.get(end_s)
                if prev is None or prio < prev[0] or (prio == prev[0] and filed_s > prev[1]):
                    best_by_end[end_s] = (prio, filed_s, val)

    return {end_s: trip[2] for end_s, trip in best_by_end.items()}


def _lookup_instant(instant_map: dict[str, float], target_date: str) -> Optional[float]:
    if target_date in instant_map:
        return instant_map[target_date]
    t_dt = _parse_date(target_date)
    if t_dt is None:
        return None
    best_diff = 8
    best_val: Optional[float] = None
    for d_str, val in instant_map.items():
        d_dt = _parse_date(d_str)
        if d_dt is None:
            continue
        diff = abs((d_dt - t_dt).days)
        if diff <= 7 and diff < best_diff:
            best_diff = diff
            best_val = val
    return best_val


def _build_records(
    dates: list[str],
    rev_m: dict[str, float],
    gp_m: dict[str, float],
    op_m: dict[str, float],
    ni_m: dict[str, float],
    pretax_m: dict[str, float],
    tax_m: dict[str, float],
    depr_m: dict[str, float],
    eps_m: dict[str, float],
    shares_m: dict[str, float],
    shares_inst_m: dict[str, float],
    ocf_m: dict[str, float],
    capex_m: dict[str, float],
    cash_m: dict[str, float],
    lt_debt_m: dict[str, float],
    st_debt_m: dict[str, float],
    tot_debt_m: dict[str, float],
    equity_m: dict[str, float],
    ca_m: dict[str, float],
    cl_m: dict[str, float],
    fallback_shares: Optional[float] = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for dt in sorted(dates):
        revenue = rev_m.get(dt)
        net_income = ni_m.get(dt)
        ocf = ocf_m.get(dt)
        if revenue is None and net_income is None and ocf is None:
            continue

        gross_profit = gp_m.get(dt)
        op_income = op_m.get(dt)
        depr = depr_m.get(dt)
        ebitda = (op_income + depr) if (op_income is not None and depr is not None) else None
        capex = capex_m.get(dt)
        fcf = (ocf - abs(capex)) if (ocf is not None and capex is not None) else None

        shares = shares_m.get(dt)
        if shares is None or shares <= 0:
            shares = _lookup_instant(shares_inst_m, dt)
        if shares is None or shares <= 0:
            shares = fallback_shares if (fallback_shares and fallback_shares > 0) else None
        eps = eps_m.get(dt)
        if eps is None and net_income is not None and shares and shares > 0:
            eps = net_income / shares

        cash = _lookup_instant(cash_m, dt)
        total_debt = _lookup_instant(tot_debt_m, dt)
        if total_debt is None:
            lt = _lookup_instant(lt_debt_m, dt)
            st = _lookup_instant(st_debt_m, dt)
            if lt is not None or st is not None:
                total_debt = (lt or 0.0) + (st or 0.0)

        net_debt = (total_debt - cash) if (total_debt is not None and cash is not None) else None
        total_equity = _lookup_instant(equity_m, dt)
        curr_assets = _lookup_instant(ca_m, dt)
        curr_liab = _lookup_instant(cl_m, dt)

        gross_margin = (gross_profit / revenue) if (gross_profit is not None and revenue and revenue > 0) else None
        op_margin = (op_income / revenue) if (op_income is not None and revenue and revenue > 0) else None
        net_margin = (net_income / revenue) if (net_income is not None and revenue and revenue > 0) else None
        roe = (net_income / total_equity) if (net_income is not None and total_equity and total_equity > 0) else None

        roic = None
        if op_income is not None and total_equity is not None and total_debt is not None:
            inv_cap = total_equity + total_debt - (cash or 0.0)
            if inv_cap > 0:
                tax_rate = 0.21
                pretax = pretax_m.get(dt)
                tax = tax_m.get(dt)
                if pretax and pretax > 0 and tax is not None and tax >= 0:
                    tax_rate = min(0.45, max(0.0, tax / pretax))
                roic = (op_income * (1.0 - tax_rate)) / inv_cap

        fcf_conversion = (fcf / net_income) if (fcf is not None and net_income and net_income > 0) else None
        net_debt_ebitda = (net_debt / ebitda) if (net_debt is not None and ebitda and ebitda > 0) else None
        debt_to_equity = (total_debt / total_equity) if (total_debt is not None and total_equity and total_equity > 0) else None
        current_ratio = (curr_assets / curr_liab) if (curr_assets is not None and curr_liab and curr_liab > 0) else None

        rev_ps = (revenue / shares) if (revenue is not None and shares and shares > 0) else None
        fcf_ps = (fcf / shares) if (fcf is not None and shares and shares > 0) else None
        ni_ps = (net_income / shares) if (net_income is not None and shares and shares > 0) else None

        records.append(
            {
                "period_end": dt,
                "fiscal_year": int(dt[:4]) if dt[:4].isdigit() else None,
                "revenue": revenue,
                "gross_profit": gross_profit,
                "operating_income": op_income,
                "net_income": net_income,
                "ebitda": ebitda,
                "operating_cash_flow": ocf,
                "capex": capex,
                "free_cash_flow": fcf,
                "eps": eps,
                "shares_outstanding": shares,
                "cash": cash,
                "total_debt": total_debt,
                "net_debt": net_debt,
                "total_equity": total_equity,
                "current_assets": curr_assets,
                "current_liabilities": curr_liab,
                "gross_margin": gross_margin,
                "op_margin": op_margin,
                "net_margin": net_margin,
                "roe": roe,
                "roic": roic,
                "fcf_conversion": fcf_conversion,
                "net_debt_ebitda": net_debt_ebitda,
                "debt_to_equity": debt_to_equity,
                "current_ratio": current_ratio,
                "revenue_per_share": rev_ps,
                "fcf_per_share": fcf_ps,
                "net_income_per_share": ni_ps,
            }
        )
    return records


def extract_financials_from_companyfacts(
    facts_payload: dict[str, Any],
    splits: Optional[list[dict[str, Any]]] = None,
    fallback_shares: Optional[float] = None,
) -> dict[str, list[dict[str, Any]]]:
    """Parse SEC EDGAR companyfacts JSON into up to 10 annual and 20 quarterly fundamental records."""
    facts_root = facts_payload.get("facts") or {}
    if not facts_root:
        return {"annual": [], "quarterly": []}

    rev_a, rev_q = _collect_duration_facts(facts_root, "revenue", "USD")
    gp_a, gp_q = _collect_duration_facts(facts_root, "gross_profit", "USD")
    op_a, op_q = _collect_duration_facts(facts_root, "operating_income", "USD")
    ni_a, ni_q = _collect_duration_facts(facts_root, "net_income", "USD")
    pretax_a, pretax_q = _collect_duration_facts(facts_root, "pretax_income", "USD")
    tax_a, tax_q = _collect_duration_facts(facts_root, "tax_provision", "USD")
    depr_a, depr_q = _collect_duration_facts(facts_root, "depreciation", "USD")
    eps_a, eps_q = _collect_duration_facts(facts_root, "eps", "USD/shares", splits=splits, split_mode="eps")
    sh_a, sh_q = _collect_duration_facts(facts_root, "shares", "shares", splits=splits, split_mode="shares", allow_ytd_diff=False)
    ocf_a, ocf_q = _collect_duration_facts(facts_root, "operating_cash_flow", "USD")
    cap_a, cap_q = _collect_duration_facts(facts_root, "capex", "USD")

    sh_inst = _collect_instant_facts(facts_root, "shares_instant", "shares", splits=splits, split_mode="shares")
    cash_m = _collect_instant_facts(facts_root, "cash", "USD")
    lt_debt_m = _collect_instant_facts(facts_root, "long_term_debt", "USD")
    st_debt_m = _collect_instant_facts(facts_root, "short_term_debt", "USD")
    tot_debt_m = _collect_instant_facts(facts_root, "total_debt", "USD")
    equity_m = _collect_instant_facts(facts_root, "total_equity", "USD")
    ca_m = _collect_instant_facts(facts_root, "current_assets", "USD")
    cl_m = _collect_instant_facts(facts_root, "current_liabilities", "USD")

    annual_dates = sorted(set(rev_a) | set(ni_a) | set(ocf_a))
    quarterly_dates = sorted(set(rev_q) | set(ni_q) | set(ocf_q))

    annual = _build_records(
        annual_dates,
        rev_a,
        gp_a,
        op_a,
        ni_a,
        pretax_a,
        tax_a,
        depr_a,
        eps_a,
        sh_a,
        sh_inst,
        ocf_a,
        cap_a,
        cash_m,
        lt_debt_m,
        st_debt_m,
        tot_debt_m,
        equity_m,
        ca_m,
        cl_m,
        fallback_shares=fallback_shares,
    )[-10:]

    quarterly = _build_records(
        quarterly_dates,
        rev_q,
        gp_q,
        op_q,
        ni_q,
        pretax_q,
        tax_q,
        depr_q,
        eps_q,
        sh_q,
        sh_inst,
        ocf_q,
        cap_q,
        cash_m,
        lt_debt_m,
        st_debt_m,
        tot_debt_m,
        equity_m,
        ca_m,
        cl_m,
        fallback_shares=fallback_shares,
    )[-20:]

    return {"annual": annual, "quarterly": quarterly}


def fetch_sec_financials(
    db: Session,
    ticker: str,
    splits: Optional[list[dict[str, Any]]] = None,
    fallback_shares: Optional[float] = None,
) -> Optional[dict[str, list[dict[str, Any]]]]:
    sym = ticker.strip().upper()
    if "." in sym:
        return None

    cik_map = _load_cik_map(db)
    cik = cik_map.get(sym)
    if not cik:
        return None

    try:
        with httpx.Client(timeout=12.0, headers=SEC_HEADERS) as client:
            resp = client.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
            if resp.status_code != 200:
                logger.debug("SEC companyfacts %s returned %s", sym, resp.status_code)
                return None
            payload = resp.json()
        return extract_financials_from_companyfacts(
            payload,
            splits=splits,
            fallback_shares=fallback_shares,
        )
    except Exception as exc:
        logger.warning("SEC EDGAR fetch failed for %s: %s", sym, exc)
        return None
