import csv
import io
import logging
import threading
import time
from bisect import bisect_right
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Any, Callable, Literal, Optional

from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db.models import (
    Asset,
    PortfolioLot,
    PortfolioPosition,
    PortfolioSale,
    UserSetting,
    WatchlistItem,
)
from app.schemas.portfolio import (
    DcaPlanRequest,
    DcaSettings,
    PortfolioBackupPayload,
    PortfolioPositionCreate,
    PortfolioPositionUpdate,
    PortfolioReinforceRequest,
    PortfolioSellRequest,
    WatchlistItemCreate,
    WatchlistItemUpdate,
)
from app.services.decision_engine import compute_dca_plan, detect_red_flags
from app.services.etf_lookthrough import (
    get_etf_lookthrough,
    normalize_geo_fr,
    normalize_sector_fr,
)
from app.services.market_data import detect_asset_type, market_data_service, normalize_ticker
from app.services.scoring_engine import (
    get_cached_sector_averages,
    persist_asset_scores,
    score_equity,
    score_etf,
)
from app.services.valuation_engine import compute_default_fair_value
from app.utils.math_utils import safe_float, sanitize_for_json, utc_now

logger = logging.getLogger(__name__)


def _to_eur(
    amount: Optional[float],
    currency: Optional[str],
    eurusd: float,
    db: Optional[Session] = None,
) -> Optional[float]:
    val = safe_float(amount)
    if val is None:
        return None
    raw_cur = (currency or "EUR").strip()
    cur = raw_cur.upper()
    if cur == "EUR":
        return val
    if cur == "USD" and eurusd > 0:
        return val / eurusd
    if db is not None and raw_cur:
        fx = market_data_service.get_fx_rate(db, raw_cur, "EUR")
        rate = safe_float(fx.get("rate"))
        if rate and rate > 0:
            return val * rate
    return val


def _convert_currency(amount: float, from_cur: str, to_cur: str, eurusd: float) -> float:
    f = (from_cur or "EUR").strip().upper()
    t = (to_cur or "EUR").strip().upper()
    if f == t or eurusd <= 0:
        return amount
    if f == "USD" and t == "EUR":
        return amount / eurusd
    if f == "EUR" and t == "USD":
        return amount * eurusd
    return amount


def _enrich_single_ticker(
    ticker: str,
    session_factory: Callable[[], Session],
    refresh: bool = False,
) -> Optional[dict[str, Any]]:
    sym = normalize_ticker(ticker)
    with session_factory() as db:
        try:
            quote = market_data_service.get_quote_and_info(db, sym, refresh=refresh)
            prices: Optional[dict[str, Any]] = None
            if quote.get("asset_type") == "ETF":
                prices = market_data_service.get_price_history(db, sym, period="MAX", refresh=refresh)
                scores = score_etf(quote, prices)
                fair_value = None
                red_flags: list[dict[str, Any]] = []
            else:
                try:
                    prices = market_data_service.get_price_history(db, sym, period="MAX", refresh=refresh)
                except Exception:
                    prices = None
                funds = market_data_service.get_fundamentals(db, sym, refresh=refresh)
                sec_avg = get_cached_sector_averages(
                    db, quote.get("sector"), quote.get("industry"), sym
                )
                scores = score_equity(quote, funds, sector_averages=sec_avg)
                fair_value = compute_default_fair_value(quote, funds)
                red_flags = detect_red_flags(quote, funds)
            new_score = safe_float((scores.get("global") or {}).get("score"))
            asset_row = db.get(Asset, sym)
            should_persist = refresh or asset_row is None or asset_row.score_global is None
            if not should_persist and new_score is not None and asset_row is not None:
                if abs(float(asset_row.score_global) - new_score) > 0.5:
                    should_persist = True
            if should_persist:
                persist_asset_scores(db, sym, scores)
            return {
                "quote": quote,
                "prices": prices,
                "scores": scores,
                "metrics": scores.get("metrics") or {},
                "roa": safe_float(quote.get("roa")),
                "fair_value": fair_value,
                "red_flags": red_flags,
            }
        except Exception as exc:
            logger.warning("Enrichment failed for %s: %s", sym, exc)
            asset = db.get(Asset, sym)
            if asset is None:
                return None
            return {
                "quote": {
                    "ticker": asset.ticker,
                    "name": asset.name,
                    "logo_url": asset.logo_url,
                    "asset_type": asset.asset_type,
                    "region": asset.region,
                    "pea_eligible": asset.pea_eligible,
                    "sector": asset.sector,
                    "currency": asset.currency,
                    "price": asset.price,
                    "market_cap": asset.market_cap,
                    "day_change_pct": None,
                },
                "scores": {
                    "global": {"score": asset.score_global},
                    "valuation": {"score": asset.score_valuation},
                    "summary_badge": None,
                    "summary_tone": None,
                },
                "metrics": {
                    "pe": asset.pe,
                    "forward_pe": asset.forward_pe,
                    "p_fcf": asset.p_fcf,
                    "peg": asset.peg,
                    "rev_growth_1y": asset.rev_growth_1y,
                    "eps_growth_1y": asset.eps_growth_1y,
                    "gross_margin": asset.gross_margin,
                    "op_margin": asset.op_margin,
                    "net_margin": asset.net_margin,
                    "roe": asset.roe,
                    "net_debt_ebitda": asset.net_debt_ebitda,
                },
                "roa": None,
            }


def _enrich_tickers_parallel(
    db: Session,
    tickers: list[str],
    refresh: bool = False,
) -> dict[str, dict[str, Any]]:
    unique_tickers = sorted({normalize_ticker(t) for t in tickers if t and t.strip()})
    if not unique_tickers:
        return {}

    bind = db.get_bind()
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=bind)
    is_static_pool = isinstance(getattr(bind, "pool", None), StaticPool)
    settings = get_settings()
    max_workers = 1 if is_static_pool else max(1, min(settings.PEER_FETCH_CONCURRENCY, len(unique_tickers)))

    results: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(_enrich_single_ticker, sym, session_factory, refresh): sym
            for sym in unique_tickers
        }
        for fut in as_completed(future_map):
            sym = future_map[fut]
            try:
                data = fut.result()
                if data is not None:
                    results[sym] = data
            except Exception as exc:
                logger.warning("Parallel enrichment future failed for %s: %s", sym, exc)
    return results


def _build_donut_slices(totals: dict[str, float], total_value: float) -> list[dict[str, Any]]:
    if total_value <= 0:
        return []
    slices = [
        {
            "name": name,
            "value_eur": round(val, 2),
            "weight_pct": round((val / total_value) * 100.0, 2),
        }
        for name, val in totals.items()
        if val > 0
    ]
    slices.sort(key=lambda x: x["value_eur"], reverse=True)
    return slices


def _weighted_avg(
    rows: list[tuple[Optional[float], float]],
    min_val: Optional[float] = None,
    max_val: Optional[float] = None,
    decimals: int = 4,
) -> Optional[float]:
    valid: list[tuple[float, float]] = []
    for raw_v, w in rows:
        v = safe_float(raw_v)
        if v is None or w <= 0:
            continue
        if min_val is not None and v < min_val:
            continue
        if max_val is not None and v > max_val:
            continue
        valid.append((v, w))
    if not valid:
        return None
    total_w = sum(w for _, w in valid)
    if total_w <= 0:
        return None
    return round(sum(v * w for v, w in valid) / total_w, decimals)


def _pct_to_eur_and_pct(
    current_val_eur: float, pct: Optional[float]
) -> tuple[Optional[float], Optional[float]]:
    if pct is None:
        return None, None
    denom = 1.0 + (pct / 100.0)
    eur_val: Optional[float] = None
    if current_val_eur > 0 and denom > 0:
        prev_val = current_val_eur / denom
        eur_val = round(current_val_eur - prev_val, 2)
    elif current_val_eur == 0:
        eur_val = 0.0
    return eur_val, round(pct, 2)


def _compute_period_perf(
    current_value_eur: float,
    quote: dict[str, Any],
    prices: Optional[dict[str, Any]],
) -> dict[str, Optional[float]]:
    raw_points = (prices or {}).get("points") or []
    hist_pts: list[tuple[str, float]] = []
    for pt in raw_points:
        dt = pt.get("date")
        c = safe_float(pt.get("close"))
        if dt and c is not None and c > 0:
            hist_pts.append((str(dt)[:10], float(c)))

    day_pct = safe_float(quote.get("day_change_pct"))
    if day_pct is None and len(hist_pts) >= 2:
        prev_c = hist_pts[-2][1]
        last_c = hist_pts[-1][1]
        if prev_c > 0:
            day_pct = ((last_c - prev_c) / prev_c) * 100.0

    pct_1m: Optional[float] = None
    pct_1y: Optional[float] = None
    if len(hist_pts) >= 2:
        dates = [d for d, _ in hist_pts]
        closes = [c for _, c in hist_pts]
        try:
            first_dt = datetime.strptime(dates[0], "%Y-%m-%d")
            last_dt = datetime.strptime(dates[-1], "%Y-%m-%d")
            span_days = (last_dt - first_dt).days
            last_close = closes[-1]

            def _hist_horizon_pct(days: int, min_span: int) -> Optional[float]:
                if span_days < min_span or last_close <= 0:
                    return None
                target_str = (last_dt - timedelta(days=days)).strftime("%Y-%m-%d")
                idx = bisect_right(dates, target_str) - 1
                base_c = closes[idx] if idx >= 0 else closes[0]
                if base_c <= 0:
                    return None
                return ((last_close - base_c) / base_c) * 100.0

            pct_1m = _hist_horizon_pct(30, 14)
            pct_1y = _hist_horizon_pct(365, 250)
        except Exception:
            pass

    day_eur, day_pct_out = _pct_to_eur_and_pct(current_value_eur, day_pct)
    eur_1m, pct_1m_out = _pct_to_eur_and_pct(current_value_eur, pct_1m)
    eur_1y, pct_1y_out = _pct_to_eur_and_pct(current_value_eur, pct_1y)
    return {
        "day_change_eur": day_eur,
        "day_change_pct": day_pct_out,
        "perf_1m_eur": eur_1m,
        "perf_1m_pct": pct_1m_out,
        "perf_1y_eur": eur_1y,
        "perf_1y_pct": pct_1y_out,
    }


def _aggregate_horizon_stats(
    items: list[dict[str, Any]], eur_key: str, pct_key: str
) -> tuple[Optional[float], Optional[float]]:
    valid_eur_sum = 0.0
    prev_val_sum = 0.0
    has_any = False
    for item in items:
        d_eur = safe_float(item.get(eur_key))
        d_pct = safe_float(item.get(pct_key))
        cur_val = safe_float(item.get("current_value_eur")) or 0.0
        if d_eur is None or d_pct is None or cur_val <= 0:
            continue
        prev_val = cur_val - d_eur
        if prev_val <= 0:
            continue
        valid_eur_sum += d_eur
        prev_val_sum += prev_val
        has_any = True
    if not has_any or prev_val_sum <= 0:
        return None, None
    return round(valid_eur_sum, 2), round((valid_eur_sum / prev_val_sum) * 100.0, 2)


def _extract_dividend_yield_pct(
    quote: dict[str, Any], live_price: Optional[float]
) -> Optional[float]:
    div_rate = safe_float(quote.get("dividend_rate"))
    if div_rate is not None and div_rate > 0 and live_price is not None and live_price > 0:
        pct = (div_rate / live_price) * 100.0
        if 0.0 < pct <= 25.0:
            return round(pct, 2)
    raw_y = safe_float(quote.get("dividend_yield"))
    if raw_y is not None and raw_y > 0:
        pct = raw_y * 100.0 if raw_y < 0.25 else raw_y
        if 0.0 < pct <= 25.0:
            return round(pct, 2)
    return None


_DASHBOARD_TTL_SEC = 30.0
_PERF_TTL_SEC = 60.0


class PortfolioService:
    def __init__(self) -> None:
        self._resp_lock = threading.RLock()
        self._dashboard_cache: dict[int, tuple[float, Any, dict[str, Any]]] = {}
        self._perf_cache: dict[tuple[int, str, str, str, str], tuple[float, Any, dict[str, Any]]] = {}

    @staticmethod
    def _bind_id(db: Session) -> int:
        try:
            bind = db.get_bind()
            return id(getattr(bind, "engine", bind))
        except Exception:
            return 0

    def invalidate_response_cache(self, db: Optional[Session] = None) -> None:
        with self._resp_lock:
            if db is None:
                self._dashboard_cache.clear()
                self._perf_cache.clear()
                return
            bid = self._bind_id(db)
            self._dashboard_cache.pop(bid, None)
            for k in [key for key in self._perf_cache if key[0] == bid]:
                self._perf_cache.pop(k, None)

    @staticmethod
    def _serialize_sale(sale: PortfolioSale) -> dict[str, Any]:
        return {
            "id": sale.id,
            "ticker": sale.ticker,
            "name": sale.name or sale.ticker,
            "asset_type": sale.asset_type or "EQUITY",
            "envelope": sale.envelope,
            "quantity_sold": round(float(sale.quantity_sold), 6),
            "pru_eur": round(float(sale.pru_eur), 4),
            "sell_price_eur": round(float(sale.sell_price_eur), 4),
            "sell_price_input": round(float(sale.sell_price_input), 4),
            "sell_currency": sale.sell_currency or "EUR",
            "proceeds_eur": round(float(sale.proceeds_eur), 2),
            "cost_basis_eur": round(float(sale.cost_basis_eur), 2),
            "realized_pnl_eur": round(float(sale.realized_pnl_eur), 2),
            "realized_pnl_pct": round(float(sale.realized_pnl_pct), 2)
            if sale.realized_pnl_pct is not None
            else None,
            "sale_date": sale.sale_date,
            "is_full_sale": bool(sale.is_full_sale),
            "notes": sale.notes,
            "created_at": (sale.created_at or utc_now()).isoformat(),
        }

    @staticmethod
    def get_portfolio_cash(db: Session) -> float:
        row = db.get(UserSetting, "portfolio_cash")
        if row and isinstance(row.value, dict):
            val = safe_float(row.value.get("cash_eur"))
            if val is not None and val >= 0:
                return round(val, 2)
        return 0.0

    def save_portfolio_cash(self, db: Session, cash_eur: float) -> dict[str, float]:
        cleaned = round(max(0.0, float(cash_eur or 0.0)), 2)
        row = db.get(UserSetting, "portfolio_cash")
        if row is None:
            row = UserSetting(key="portfolio_cash", value={"cash_eur": cleaned})
            db.add(row)
        else:
            row.value = {"cash_eur": cleaned}
        db.commit()
        self.invalidate_response_cache(db)
        return {"cash_eur": cleaned}

    def get_portfolio_dashboard(self, db: Session, refresh: bool = False) -> dict[str, Any]:
        bid = self._bind_id(db)
        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.id.asc()).all()
        cash_eur = self.get_portfolio_cash(db)
        sale_rows = (
            db.query(PortfolioSale)
            .order_by(PortfolioSale.sale_date.desc(), PortfolioSale.id.desc())
            .all()
        )
        dash_sig = (
            tuple(
                (p.id, p.ticker, p.asset_type, p.envelope, p.quantity, p.pru, p.invested_amount, p.currency, p.purchase_date, p.fees_eur)
                for p in positions
            ),
            cash_eur,
            tuple((s.id, s.realized_pnl_eur) for s in sale_rows),
        )
        if not refresh:
            with self._resp_lock:
                cached_entry = self._dashboard_cache.get(bid)
                if (
                    cached_entry is not None
                    and (time.monotonic() - cached_entry[0]) < _DASHBOARD_TTL_SEC
                    and cached_entry[1] == dash_sig
                ):
                    return cached_entry[2]

        serialized_sales = [self._serialize_sale(s) for s in sale_rows]
        total_realized_pnl_eur = round(sum(float(s.realized_pnl_eur or 0.0) for s in sale_rows), 2)

        fx = market_data_service.get_eurusd_rate(db, refresh=refresh)
        eurusd = safe_float(fx.get("rate")) or 1.08

        if not positions:
            return sanitize_for_json(
                {
                    "eurusd_rate": eurusd,
                    "stats": {
                        "total_value_eur": round(cash_eur, 2),
                        "total_cost_eur": round(cash_eur, 2),
                        "cash_eur": round(cash_eur, 2),
                        "total_fees_eur": 0.0,
                        "total_pnl_eur": 0.0,
                        "total_pnl_pct": None,
                        "day_pnl_eur": 0.0,
                        "day_pnl_pct": None,
                        "perf_1m_eur": 0.0,
                        "perf_1m_pct": None,
                        "perf_1y_eur": 0.0,
                        "perf_1y_pct": None,
                        "positions_count": 0,
                        "equities_count": 0,
                        "etfs_count": 0,
                        "equities_weight_pct": 0.0,
                        "etfs_weight_pct": 0.0,
                        "top5_weight_pct": 0.0,
                    },
                    "donuts": {"by_position": [], "by_envelope": [], "by_sector": []},
                    "dividends": {
                        "annual_gross_eur": 0.0,
                        "annual_net_eur": 0.0,
                        "monthly_net_eur": 0.0,
                        "portfolio_yield_pct": 0.0,
                        "yield_on_cost_pct": 0.0,
                        "cto_tax_rate_pct": 31.4,
                        "payers_count": 0,
                        "items": [],
                    },
                    "positions": [],
                    "sales": serialized_sales,
                    "total_realized_pnl_eur": total_realized_pnl_eur,
                    "updated_at": utc_now().isoformat(),
                }
            )

        enriched_map = _enrich_tickers_parallel(
            db, [p.ticker for p in positions], refresh=refresh
        )

        valued_items: list[dict[str, Any]] = []
        for pos in positions:
            info_bundle = enriched_map.get(pos.ticker) or {}
            quote = info_bundle.get("quote") or {}
            scores = info_bundle.get("scores") or {}

            detected_type = detect_asset_type(quote.get("asset_type"), quote.get("name"), pos.ticker)
            asset_type = pos.asset_type_override or detected_type or pos.asset_type or "EQUITY"
            asset_currency = quote.get("currency") or pos.currency or "EUR"
            live_price = safe_float(quote.get("price"))

            current_value_eur, cost_basis_eur = self._position_value_and_cost_eur(
                pos, live_price, asset_currency, eurusd, db=db
            )

            pnl_eur = current_value_eur - cost_basis_eur
            pnl_pct = ((pnl_eur / cost_basis_eur) * 100.0) if cost_basis_eur > 0 else None
            horizon_perfs = _compute_period_perf(
                current_value_eur, quote, info_bundle.get("prices")
            )
            div_yield_pct = _extract_dividend_yield_pct(quote, live_price)
            annual_div_eur = (
                round(current_value_eur * (div_yield_pct / 100.0), 2)
                if (div_yield_pct is not None and current_value_eur > 0)
                else 0.0
            )
            yoc_pct = (
                round((annual_div_eur / cost_basis_eur) * 100.0, 2)
                if (annual_div_eur > 0 and cost_basis_eur > 0)
                else None
            )

            score_global = safe_float((scores.get("global") or {}).get("score"))
            score_val = safe_float((scores.get("valuation") or {}).get("score"))

            valued_items.append(
                {
                    "id": pos.id,
                    "ticker": pos.ticker,
                    "name": quote.get("name") or pos.ticker,
                    "logo_url": quote.get("logo_url"),
                    "asset_type": asset_type,
                    "sector": "ETF" if asset_type == "ETF" else quote.get("sector"),
                    "envelope": pos.envelope,
                    "quantity": pos.quantity,
                    "pru": pos.pru,
                    "invested_amount": pos.invested_amount,
                    "currency": pos.currency,
                    "purchase_date": pos.purchase_date,
                    "fees_eur": round(float(pos.fees_eur or 0.0), 2),
                    "current_price": live_price,
                    "asset_currency": asset_currency,
                    "current_value_eur": round(current_value_eur, 2),
                    "cost_basis_eur": round(cost_basis_eur, 2),
                    "pnl_eur": round(pnl_eur, 2),
                    "pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
                    **horizon_perfs,
                    "dividend_yield_pct": div_yield_pct,
                    "annual_dividend_eur": annual_div_eur,
                    "yield_on_cost_pct": yoc_pct,
                    "ex_dividend_date": quote.get("ex_dividend_date"),
                    "weight_pct": 0.0,
                    "score_global": score_global,
                    "score_valuation": score_val,
                    "notes": pos.notes,
                    "updated_at": (pos.updated_at or utc_now()).isoformat(),
                    "_bundle": info_bundle,
                }
            )

        valued_items.sort(key=lambda x: x["current_value_eur"], reverse=True)
        positions_total_value = sum(item["current_value_eur"] for item in valued_items)
        positions_total_cost = sum(item["cost_basis_eur"] for item in valued_items)
        total_value = positions_total_value + cash_eur
        total_cost = positions_total_cost + cash_eur
        total_fees = sum(item["fees_eur"] for item in valued_items)
        total_pnl = total_value - total_cost
        total_pnl_pct = ((total_pnl / total_cost) * 100.0) if total_cost > 0 else None

        by_position_map: dict[str, float] = defaultdict(float)
        by_envelope_map: dict[str, float] = defaultdict(float)
        by_sector_map: dict[str, float] = defaultdict(float)
        by_sector_lt_map: dict[str, float] = defaultdict(float)
        by_geo_map: dict[str, float] = defaultdict(float)

        equities_items = [i for i in valued_items if i["asset_type"] == "EQUITY"]
        etfs_items = [i for i in valued_items if i["asset_type"] == "ETF"]
        equities_total = sum(i["current_value_eur"] for i in equities_items)
        etfs_total = sum(i["current_value_eur"] for i in etfs_items)

        for item in valued_items:
            val = item["current_value_eur"]
            item["weight_pct"] = (
                round((val / positions_total_value) * 100.0, 2) if positions_total_value > 0 else 0.0
            )
            by_position_map[item["ticker"]] += val
            by_envelope_map[item["envelope"]] += val
            quote_info = (item.get("_bundle") or {}).get("quote") or {}

            if item["asset_type"] != "ETF":
                sec_label = item["sector"] or "Autre"
                by_sector_map[sec_label] += val
                by_sector_lt_map[normalize_sector_fr(item["sector"])] += val
                geo_label = normalize_geo_fr(
                    quote_info.get("country"),
                    quote_info.get("region"),
                    item["ticker"],
                )
                by_geo_map[geo_label] += val
            else:
                sec_weights, geo_weights = get_etf_lookthrough(item["ticker"], item.get("name"))
                if sec_weights:
                    for sec_name, w in sec_weights.items():
                        by_sector_lt_map[sec_name] += val * w
                else:
                    by_sector_lt_map["ETF non ventilé"] += val

                if geo_weights:
                    for geo_name, w in geo_weights.items():
                        by_geo_map[geo_name] += val * w
                else:
                    geo_label = normalize_geo_fr(
                        quote_info.get("country"),
                        quote_info.get("region"),
                        item["ticker"],
                    )
                    by_geo_map[geo_label] += val

        by_position_slices = _build_donut_slices(by_position_map, positions_total_value)
        by_envelope_slices = _build_donut_slices(by_envelope_map, positions_total_value)
        by_sector_slices = _build_donut_slices(by_sector_map, equities_total)
        by_sector_lt_slices = _build_donut_slices(by_sector_lt_map, positions_total_value)
        by_geo_slices = _build_donut_slices(by_geo_map, positions_total_value)

        top5_weight_pct = round(sum(s["weight_pct"] for s in by_position_slices[:5]), 2)
        equities_weight_pct = (
            round((equities_total / positions_total_value) * 100.0, 2)
            if positions_total_value > 0
            else 0.0
        )
        etfs_weight_pct = (
            round((etfs_total / positions_total_value) * 100.0, 2)
            if positions_total_value > 0
            else 0.0
        )

        # Equities-only weighted fundamental stats
        def eq_rows(getter: Callable[[dict[str, Any]], Optional[float]]) -> list[tuple[Optional[float], float]]:
            return [(getter(item["_bundle"]), item["current_value_eur"]) for item in equities_items]

        avg_market_cap_eur = _weighted_avg(
            eq_rows(
                lambda b: _to_eur(
                    (b.get("quote") or {}).get("market_cap"),
                    (b.get("quote") or {}).get("currency"),
                    eurusd,
                )
            ),
            min_val=1.0,
            decimals=0,
        )

        day_pnl_eur, day_pnl_pct = _aggregate_horizon_stats(
            valued_items, "day_change_eur", "day_change_pct"
        )
        perf_1m_eur, perf_1m_pct = _aggregate_horizon_stats(
            valued_items, "perf_1m_eur", "perf_1m_pct"
        )
        perf_1y_eur, perf_1y_pct = _aggregate_horizon_stats(
            valued_items, "perf_1y_eur", "perf_1y_pct"
        )

        stats = {
            "total_value_eur": round(total_value, 2),
            "total_cost_eur": round(total_cost, 2),
            "cash_eur": round(cash_eur, 2),
            "total_fees_eur": round(total_fees, 2),
            "total_pnl_eur": round(total_pnl, 2),
            "total_pnl_pct": round(total_pnl_pct, 2) if total_pnl_pct is not None else None,
            "day_pnl_eur": day_pnl_eur,
            "day_pnl_pct": day_pnl_pct,
            "perf_1m_eur": perf_1m_eur,
            "perf_1m_pct": perf_1m_pct,
            "perf_1y_eur": perf_1y_eur,
            "perf_1y_pct": perf_1y_pct,
            "positions_count": len(valued_items),
            "equities_count": len({i["ticker"] for i in equities_items}),
            "etfs_count": len({i["ticker"] for i in etfs_items}),
            "equities_weight_pct": equities_weight_pct,
            "etfs_weight_pct": etfs_weight_pct,
            "top5_weight_pct": top5_weight_pct,
            "avg_market_cap_eur": avg_market_cap_eur,
            "gross_margin": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("gross_margin")), -1.0, 1.0),
            "op_margin": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("op_margin")), -1.0, 1.0),
            "net_margin": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("net_margin")), -1.0, 1.0),
            "roe": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("roe")), -1.0, 3.0),
            "roa": _weighted_avg(eq_rows(lambda b: b.get("roa")), -1.0, 1.5),
            "rev_growth_1y": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("rev_growth_1y")), -1.0, 3.0),
            "eps_growth_1y": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("eps_growth_1y")), -1.0, 3.0),
            "net_debt_ebitda": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("net_debt_ebitda")), -5.0, 15.0, decimals=2),
            "pe": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("pe")), 0.01, 150.0, decimals=2),
            "forward_pe": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("forward_pe")), 0.01, 150.0, decimals=2),
            "p_fcf": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("p_fcf")), 0.01, 150.0, decimals=2),
            "peg": _weighted_avg(eq_rows(lambda b: (b.get("metrics") or {}).get("peg")), 0.01, 10.0, decimals=2),
            "avg_score_global": _weighted_avg(
                [(i["score_global"], i["current_value_eur"]) for i in valued_items],
                0.0,
                100.0,
                decimals=1,
            ),
            "equities_avg_score_global": _weighted_avg(
                [(i["score_global"], i["current_value_eur"]) for i in equities_items],
                0.0,
                100.0,
                decimals=1,
            ),
        }

        cto_tax_rate = 31.4
        div_items: list[dict[str, Any]] = []
        for item in valued_items:
            gross = item.get("annual_dividend_eur") or 0.0
            dy_pct = item.get("dividend_yield_pct")
            if gross <= 0 or dy_pct is None:
                continue
            net = round(gross * (1.0 - cto_tax_rate / 100.0), 2) if item["envelope"] == "CTO" else round(gross, 2)
            div_items.append(
                {
                    "position_id": item["id"],
                    "ticker": item["ticker"],
                    "name": item["name"],
                    "envelope": item["envelope"],
                    "dividend_yield_pct": dy_pct,
                    "yield_on_cost_pct": item.get("yield_on_cost_pct"),
                    "annual_gross_eur": round(gross, 2),
                    "annual_net_eur": net,
                    "ex_dividend_date": item.get("ex_dividend_date"),
                }
            )
        div_items.sort(key=lambda d: d["annual_gross_eur"], reverse=True)
        div_gross_sum = round(sum(d["annual_gross_eur"] for d in div_items), 2)
        div_net_sum = round(sum(d["annual_net_eur"] for d in div_items), 2)
        dividends_summary = {
            "annual_gross_eur": div_gross_sum,
            "annual_net_eur": div_net_sum,
            "monthly_net_eur": round(div_net_sum / 12.0, 2),
            "portfolio_yield_pct": round((div_gross_sum / total_value) * 100.0, 2) if total_value > 0 else 0.0,
            "yield_on_cost_pct": round((div_gross_sum / total_cost) * 100.0, 2) if total_cost > 0 else 0.0,
            "cto_tax_rate_pct": cto_tax_rate,
            "payers_count": len(div_items),
            "items": div_items,
        }

        clean_positions = [{k: v for k, v in item.items() if k != "_bundle"} for item in valued_items]

        result = sanitize_for_json(
            {
                "eurusd_rate": round(eurusd, 6),
                "stats": stats,
                "donuts": {
                    "by_position": by_position_slices,
                    "by_envelope": by_envelope_slices,
                    "by_sector": by_sector_slices,
                    "by_sector_lookthrough": by_sector_lt_slices,
                    "by_geography": by_geo_slices,
                },
                "dividends": dividends_summary,
                "positions": clean_positions,
                "sales": serialized_sales,
                "total_realized_pnl_eur": total_realized_pnl_eur,
                "updated_at": utc_now().isoformat(),
            }
        )
        with self._resp_lock:
            self._dashboard_cache[bid] = (time.monotonic(), dash_sig, result)
        return result

    def create_position(self, db: Session, data: PortfolioPositionCreate) -> dict[str, Any]:
        sym = normalize_ticker(data.ticker)
        quote = market_data_service.get_quote_and_info(db, sym, refresh=False)
        detected_type = detect_asset_type(quote.get("asset_type"), quote.get("name"), sym)
        asset_type = data.asset_type or detected_type or "EQUITY"
        currency = (data.currency or "EUR").strip().upper()
        purchase_date = (data.purchase_date or "").strip() or utc_now().strftime("%Y-%m-%d")

        row = PortfolioPosition(
            ticker=sym,
            asset_type=asset_type,
            asset_type_override=data.asset_type,
            envelope=data.envelope,
            quantity=data.quantity,
            pru=data.pru,
            invested_amount=data.invested_amount,
            currency=currency,
            purchase_date=purchase_date,
            fees_eur=round(float(data.fees_eur or 0.0), 2),
            notes=data.notes,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        self.invalidate_response_cache(db)

        dash = self.get_portfolio_dashboard(db, refresh=False)
        for item in dash["positions"]:
            if item["id"] == row.id:
                return item
        raise ValueError("Position created but failed to load")

    def update_position(
        self, db: Session, position_id: int, data: PortfolioPositionUpdate
    ) -> dict[str, Any]:
        row = db.get(PortfolioPosition, position_id)
        if row is None:
            raise ValueError(f"Position {position_id} introuvable")

        if data.asset_type is not None:
            row.asset_type = data.asset_type
            row.asset_type_override = data.asset_type
        if data.envelope is not None:
            row.envelope = data.envelope
        if data.clear_quantity_pru:
            row.quantity = None
            row.pru = None
        if data.quantity is not None:
            row.quantity = data.quantity
        if data.pru is not None:
            row.pru = data.pru
        if data.invested_amount is not None:
            row.invested_amount = data.invested_amount
        if data.currency is not None:
            row.currency = data.currency.strip().upper()
        if data.purchase_date is not None:
            row.purchase_date = data.purchase_date.strip() or None
        if data.fees_eur is not None:
            row.fees_eur = round(float(data.fees_eur), 2)
        if data.notes is not None:
            row.notes = data.notes
        row.updated_at = utc_now()
        db.commit()
        self.invalidate_response_cache(db)

        dash = self.get_portfolio_dashboard(db, refresh=False)
        for item in dash["positions"]:
            if item["id"] == row.id:
                return item
        raise ValueError("Position updated but failed to load")

    def delete_position(self, db: Session, position_id: int) -> None:
        row = db.get(PortfolioPosition, position_id)
        if row is None:
            raise ValueError(f"Position {position_id} introuvable")
        db.query(PortfolioLot).filter(PortfolioLot.position_id == position_id).delete(
            synchronize_session=False
        )
        db.delete(row)
        db.commit()
        self.invalidate_response_cache(db)

    def reinforce_position(
        self, db: Session, position_id: int, data: PortfolioReinforceRequest
    ) -> dict[str, Any]:
        pos = db.get(PortfolioPosition, position_id)
        if pos is None:
            raise ValueError(f"Position {position_id} introuvable")

        fx = market_data_service.get_eurusd_rate(db, refresh=False)
        eurusd = safe_float(fx.get("rate")) or 1.08

        in_cur = (data.currency or "EUR").strip().upper()
        unit_price_in = float(data.price)
        if data.quantity is not None:
            added_qty = float(data.quantity)
            added_amount_in = added_qty * unit_price_in
        elif data.amount is not None:
            added_amount_in = float(data.amount)
            added_qty = added_amount_in / unit_price_in
        else:
            raise ValueError("Précisez un montant ou une quantité à ajouter.")

        if added_qty <= 0 or added_amount_in <= 0:
            raise ValueError("La quantité ou le montant ajouté doit être strictement positif.")

        pos_cur = (pos.currency or "EUR").strip().upper()
        unit_price_pos = _convert_currency(unit_price_in, in_cur, pos_cur, eurusd)
        added_amount_pos = added_qty * unit_price_pos

        if pos.quantity is not None and pos.pru is not None and pos.quantity > 0:
            old_qty = float(pos.quantity)
            old_pru = float(pos.pru)
            new_qty = old_qty + added_qty
            new_pru = ((old_qty * old_pru) + added_amount_pos) / new_qty
            pos.quantity = round(new_qty, 6)
            pos.pru = round(new_pru, 4)
        elif pos.invested_amount is not None and pos.pru is not None and pos.pru > 0:
            old_qty = float(pos.invested_amount) / float(pos.pru)
            old_pru = float(pos.pru)
            new_qty = old_qty + added_qty
            new_pru = ((old_qty * old_pru) + added_amount_pos) / new_qty
            pos.quantity = round(new_qty, 6)
            pos.pru = round(new_pru, 4)
            pos.invested_amount = None
        else:
            old_amt = float(pos.invested_amount or 0.0)
            pos.invested_amount = round(old_amt + added_amount_pos, 4)

        tx_date = (data.purchase_date or "").strip() or utc_now().strftime("%Y-%m-%d")
        if not pos.purchase_date:
            pos.purchase_date = tx_date

        price_eur = _to_eur(unit_price_in, in_cur, eurusd) or unit_price_in
        amount_eur = _to_eur(added_amount_in, in_cur, eurusd) or added_amount_in
        fee_eur = round(float(data.fees_eur or 0.0), 2)
        pos.fees_eur = round(float(pos.fees_eur or 0.0) + fee_eur, 2)

        lot_row = PortfolioLot(
            position_id=pos.id,
            ticker=pos.ticker,
            quantity_added=round(added_qty, 6),
            price_input=round(unit_price_in, 4),
            currency=in_cur,
            price_eur=round(price_eur, 4),
            amount_eur=round(amount_eur, 2),
            fees_eur=fee_eur,
            tx_date=tx_date,
            notes=data.notes.strip() if data.notes else None,
        )
        db.add(lot_row)
        pos.updated_at = utc_now()
        db.commit()
        self.invalidate_response_cache(db)

        dash = self.get_portfolio_dashboard(db, refresh=False)
        for item in dash["positions"]:
            if item["id"] == pos.id:
                return item
        raise ValueError("Position renforcée mais échec du rechargement")

    def sell_position(
        self, db: Session, position_id: int, data: PortfolioSellRequest
    ) -> dict[str, Any]:
        pos = db.get(PortfolioPosition, position_id)
        if pos is None:
            raise ValueError(f"Position {position_id} introuvable")

        fx = market_data_service.get_eurusd_rate(db, refresh=False)
        eurusd = safe_float(fx.get("rate")) or 1.08

        sell_currency = (data.sell_currency or "EUR").strip().upper()
        sell_price_eur = _to_eur(data.sell_price, sell_currency, eurusd)
        if sell_price_eur is None or sell_price_eur <= 0:
            raise ValueError("Prix de vente invalide.")

        name = pos.ticker
        asset_type = pos.asset_type_override or pos.asset_type or "EQUITY"
        try:
            quote = market_data_service.get_quote_and_info(db, pos.ticker, refresh=False)
            name = quote.get("name") or pos.ticker
            asset_type = pos.asset_type_override or detect_asset_type(
                quote.get("asset_type"), quote.get("name"), pos.ticker
            )
        except Exception:
            asset = db.get(Asset, pos.ticker)
            if asset is not None and asset.name:
                name = asset.name

        if pos.quantity is not None and pos.pru is not None and pos.quantity > 0:
            total_qty = float(pos.quantity)
            pru_eur = _to_eur(pos.pru, pos.currency, eurusd) or float(pos.pru)
            total_cost_eur = total_qty * pru_eur
        elif pos.invested_amount is not None and pos.pru is not None and pos.pru > 0:
            total_qty = float(pos.invested_amount) / float(pos.pru)
            pru_eur = _to_eur(pos.pru, pos.currency, eurusd) or float(pos.pru)
            total_cost_eur = _to_eur(pos.invested_amount, pos.currency, eurusd) or 0.0
        elif pos.invested_amount is not None and pos.invested_amount > 0:
            total_cost_eur = _to_eur(pos.invested_amount, pos.currency, eurusd) or float(
                pos.invested_amount
            )
            total_qty = total_cost_eur / sell_price_eur
            pru_eur = sell_price_eur
        else:
            raise ValueError("Impossible de déterminer la quantité détenue pour cette position.")

        if total_qty <= 0:
            raise ValueError("Quantité détenue invalide.")

        total_cost_eur += float(pos.fees_eur or 0.0)

        if data.mode == "full":
            fraction = 1.0
            qty_sold = total_qty
        else:
            if data.sell_percent is not None:
                fraction = min(1.0, float(data.sell_percent) / 100.0)
                qty_sold = total_qty * fraction
            elif data.sell_quantity is not None:
                qty_sold = min(total_qty, float(data.sell_quantity))
                fraction = qty_sold / total_qty
            elif data.sell_amount is not None:
                amount_eur = _to_eur(data.sell_amount, sell_currency, eurusd) or float(data.sell_amount)
                qty_sold = min(total_qty, amount_eur / sell_price_eur)
                fraction = qty_sold / total_qty
            else:
                raise ValueError(
                    "Indiquez un pourcentage, une quantité ou un montant pour une vente partielle."
                )

        if qty_sold <= 0 or fraction <= 0:
            raise ValueError("La fraction vendue doit être strictement positive.")

        is_full_sale = fraction >= 0.9999
        if is_full_sale:
            fraction = 1.0
            qty_sold = total_qty

        proceeds_eur = qty_sold * sell_price_eur
        cost_basis_sold_eur = total_cost_eur * fraction
        realized_pnl_eur = proceeds_eur - cost_basis_sold_eur
        realized_pnl_pct = (
            (realized_pnl_eur / cost_basis_sold_eur) * 100.0
            if cost_basis_sold_eur > 0
            else None
        )
        sale_date = (data.sale_date or "").strip() or utc_now().strftime("%Y-%m-%d")

        sale_row = PortfolioSale(
            ticker=pos.ticker,
            name=name[:255],
            asset_type=asset_type,
            envelope=pos.envelope,
            quantity_sold=round(qty_sold, 6),
            pru_eur=round(pru_eur, 4),
            sell_price_eur=round(sell_price_eur, 4),
            sell_price_input=round(float(data.sell_price), 4),
            sell_currency=sell_currency,
            proceeds_eur=round(proceeds_eur, 2),
            cost_basis_eur=round(cost_basis_sold_eur, 2),
            realized_pnl_eur=round(realized_pnl_eur, 2),
            realized_pnl_pct=round(realized_pnl_pct, 2) if realized_pnl_pct is not None else None,
            sale_date=sale_date,
            is_full_sale=is_full_sale,
            notes=data.notes.strip() if data.notes else None,
        )
        db.add(sale_row)

        pos_id = pos.id
        if is_full_sale:
            db.query(PortfolioLot).filter(PortfolioLot.position_id == pos_id).delete(
                synchronize_session=False
            )
            db.delete(pos)
        else:
            if pos.quantity is not None:
                pos.quantity = round(max(1e-6, float(pos.quantity) - qty_sold), 6)
            if pos.invested_amount is not None:
                pos.invested_amount = round(
                    max(1e-4, float(pos.invested_amount) * (1.0 - fraction)), 4
                )
            if pos.fees_eur:
                pos.fees_eur = round(max(0.0, float(pos.fees_eur) * (1.0 - fraction)), 2)
            for lot in db.query(PortfolioLot).filter(PortfolioLot.position_id == pos_id).all():
                lot.quantity_added = round(max(1e-8, float(lot.quantity_added) * (1.0 - fraction)), 6)
            pos.updated_at = utc_now()

        db.commit()
        db.refresh(sale_row)
        self.invalidate_response_cache(db)

        remaining_item = None
        if not is_full_sale:
            dash = self.get_portfolio_dashboard(db, refresh=False)
            for item in dash["positions"]:
                if item["id"] == pos_id:
                    remaining_item = item
                    break

        return sanitize_for_json(
            {
                "sale": self._serialize_sale(sale_row),
                "remaining_position": remaining_item,
                "position_closed": is_full_sale,
            }
        )

    def delete_sale(self, db: Session, sale_id: int) -> None:
        row = db.get(PortfolioSale, sale_id)
        if row is None:
            raise ValueError(f"Vente {sale_id} introuvable")
        db.delete(row)
        db.commit()
        self.invalidate_response_cache(db)

    def get_portfolio_performance(
        self,
        db: Session,
        period: str = "1Y",
        benchmark: str = "^GSPC",
        currency: str = "EUR",
        mode: str = "real",
        refresh: bool = False,
    ) -> dict[str, Any]:
        period_map = {"1J": "1D", "5J": "5D", "1A": "1Y"}
        period_norm = period_map.get(period.strip().upper(), period.strip().upper())
        if period_norm not in {"1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "MAX"}:
            period_norm = "1Y"
        cur_norm = "USD" if currency.strip().upper() == "USD" else "EUR"
        mode_req = "backtest" if mode.strip().lower() == "backtest" else "real"
        raw_bench = benchmark.strip() or "^GSPC"
        bench_sym = normalize_ticker(raw_bench)

        bid = self._bind_id(db)
        perf_cache_key = (bid, period_norm, bench_sym, cur_norm, mode_req)
        bench_labels = {
            "^GSPC": "S&P 500",
            "CW8.PA": "MSCI World (CW8)",
            "^NDX": "NASDAQ-100",
        }

        def _fetch_hist(sym: str) -> Optional[dict[str, Any]]:
            bind = db.get_bind()
            sf = sessionmaker(autocommit=False, autoflush=False, bind=bind)
            with sf() as local_db:
                try:
                    return market_data_service.get_price_history(
                        local_db, sym, period=period_norm, currency=cur_norm, refresh=refresh
                    )
                except Exception:
                    return None

        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.id.asc()).all()
        cash_eur = self.get_portfolio_cash(db)
        lots_all = (
            db.query(PortfolioLot)
            .filter(PortfolioLot.position_id.in_([p.id for p in positions]))
            .order_by(PortfolioLot.tx_date.asc(), PortfolioLot.id.asc())
            .all()
            if positions
            else []
        )
        perf_sig = (
            tuple(
                (p.id, p.ticker, p.quantity, p.pru, p.invested_amount, p.currency, p.purchase_date, p.fees_eur)
                for p in positions
            ),
            cash_eur,
            tuple((l.id, l.position_id, l.quantity_added, l.amount_eur, l.tx_date) for l in lots_all),
        )
        if not refresh:
            with self._resp_lock:
                cached_perf = self._perf_cache.get(perf_cache_key)
                if (
                    cached_perf is not None
                    and (time.monotonic() - cached_perf[0]) < _PERF_TTL_SEC
                    and cached_perf[1] == perf_sig
                ):
                    return cached_perf[2]

        bench_hist = _fetch_hist(bench_sym)
        if bench_hist is None or not bench_hist.get("points"):
            matches = market_data_service.search_assets(db, raw_bench, limit=3)
            for m in matches:
                cand_sym = normalize_ticker(m["ticker"])
                cand_hist = _fetch_hist(cand_sym)
                if cand_hist and cand_hist.get("points"):
                    bench_sym = cand_sym
                    bench_hist = cand_hist
                    break

        if bench_hist is None or not bench_hist.get("points"):
            raise ValueError(f"Impossible de charger l'historique du benchmark '{raw_bench}'.")

        bench_name = bench_labels.get(bench_sym)
        if not bench_name:
            asset_row = db.get(Asset, bench_sym)
            bench_name = asset_row.name if asset_row and asset_row.name else bench_sym
            if bench_name == bench_sym:
                try:
                    q = market_data_service.get_quote_and_info(db, bench_sym, refresh=False)
                    bench_name = q.get("name") or bench_sym
                except Exception:
                    pass

        def _empty_perf(calc_mode: str, calc_label: str) -> dict[str, Any]:
            return sanitize_for_json(
                {
                    "period": period_norm,
                    "benchmark": bench_sym,
                    "benchmark_name": bench_name,
                    "currency": cur_norm,
                    "calculation_mode": calc_mode,
                    "calculation_label": calc_label,
                    "portfolio_perf_pct": None,
                    "benchmark_perf_pct": None,
                    "portfolio_cagr_pct": None,
                    "benchmark_cagr_pct": None,
                    "elapsed_years": None,
                    "alpha_pts": None,
                    "avg_alpha_pts": None,
                    "annual_returns": [],
                    "quarterly_returns": [],
                    "points": [],
                    "positions_included": 0,
                    "updated_at": utc_now().isoformat(),
                }
            )

        if not positions:
            default_lbl = (
                "Backtest composition actuelle"
                if mode_req == "backtest"
                else "Performance réelle (selon dates d'achat)"
            )
            return _empty_perf(mode_req, default_lbl)

        fx = market_data_service.get_eurusd_rate(db, refresh=refresh)
        eurusd = safe_float(fx.get("rate")) or 1.08
        cash_target = cash_eur * eurusd if cur_norm == "USD" else cash_eur

        unique_tickers = sorted({p.ticker for p in positions})
        bind = db.get_bind()
        is_static_pool = isinstance(getattr(bind, "pool", None), StaticPool)
        settings = get_settings()
        max_workers = 1 if is_static_pool else max(1, min(settings.PEER_FETCH_CONCURRENCY, len(unique_tickers)))

        hist_by_ticker: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            fmap = {executor.submit(_fetch_hist, t): t for t in unique_tickers}
            for fut in as_completed(fmap):
                t = fmap[fut]
                try:
                    res = fut.result()
                    if res and res.get("points"):
                        hist_by_ticker[t] = res
                except Exception:
                    pass

        bench_points = [
            (pt["date"], float(pt["close"]))
            for pt in bench_hist["points"]
            if pt.get("date") and safe_float(pt.get("close")) and float(pt["close"]) > 0
        ]
        if len(bench_points) < 2:
            return _empty_perf("backtest", "Backtest composition actuelle")

        bench_dates = [d for d, _ in bench_points]
        bench_closes = [c for _, c in bench_points]

        # Append / update a live "Today" point from real-time quotes on weekdays so today's curve is never missing
        now_dt = utc_now()
        today_date = now_dt.date()
        today_str = today_date.isoformat()
        live_quotes_target: dict[str, float] = {}
        if today_date.weekday() < 5 and bench_dates:
            try:
                last_bench_date = date.fromisoformat(bench_dates[-1])
                days_gap = (today_date - last_bench_date).days
            except Exception:
                days_gap = 99
            if 0 <= days_gap <= 3:
                def _live_quote_target(sym_q: str, fallback_cur: str = "USD") -> Optional[float]:
                    try:
                        q = market_data_service.get_quote_and_info(db, sym_q, refresh=refresh)
                        raw_px = safe_float(q.get("price"))
                        if raw_px is None or raw_px <= 0:
                            return None
                        q_cur = q.get("currency") or fallback_cur
                        eur_px = _to_eur(raw_px, q_cur, eurusd, db=db)
                        if eur_px is None or eur_px <= 0:
                            return None
                        return round(eur_px * eurusd if cur_norm == "USD" else eur_px, 4)
                    except Exception:
                        return None

                live_bench = _live_quote_target(bench_sym, str(bench_hist.get("native_currency") or "USD"))
                if bench_dates[-1] < today_str:
                    bench_dates.append(today_str)
                    bench_closes.append(live_bench if live_bench is not None else bench_closes[-1])
                elif bench_dates[-1] == today_str and live_bench is not None:
                    bench_closes[-1] = live_bench

                if period_norm == "1D" and len(bench_dates) > 2:
                    bench_dates = bench_dates[-2:]
                    bench_closes = bench_closes[-2:]

                for t_sym in unique_tickers:
                    lq = _live_quote_target(t_sym)
                    if lq is not None and lq > 0:
                        live_quotes_target[t_sym] = lq

        lots_by_pos: dict[int, list[PortfolioLot]] = defaultdict(list)
        for lot in lots_all:
            lots_by_pos[lot.position_id].append(lot)

        pos_entries: list[dict[str, Any]] = []
        has_any_purchase_date = False

        for pos in positions:
            h = hist_by_ticker.get(pos.ticker)
            if not h:
                continue
            pts = [
                (pt["date"], float(pt["close"]))
                for pt in h["points"]
                if pt.get("date") and safe_float(pt.get("close")) and float(pt["close"]) > 0
            ]
            if not pts:
                continue

            p_dates = [d for d, _ in pts]
            p_closes = [c for _, c in pts]
            live_px = live_quotes_target.get(pos.ticker)
            if live_px is not None and live_px > 0 and bench_dates and bench_dates[-1] == today_str:
                if p_dates[-1] < today_str:
                    p_dates.append(today_str)
                    p_closes.append(live_px)
                elif p_dates[-1] == today_str:
                    p_closes[-1] = live_px
            last_close = p_closes[-1]

            if pos.quantity is not None and pos.quantity > 0:
                eff_qty = float(pos.quantity)
            elif pos.invested_amount is not None and pos.pru is not None and pos.pru > 0:
                eff_qty = float(pos.invested_amount) / float(pos.pru)
            elif pos.invested_amount is not None and pos.invested_amount > 0:
                cost_eur = _to_eur(pos.invested_amount, pos.currency, eurusd) or float(
                    pos.invested_amount
                )
                cost_target = cost_eur * eurusd if cur_norm == "USD" else cost_eur
                eff_qty = cost_target / last_close
            else:
                continue

            raw_pdate = (pos.purchase_date or "").strip()[:10]
            if raw_pdate:
                has_any_purchase_date = True
            start_date = raw_pdate if raw_pdate else bench_dates[0]

            aligned_closes: list[float] = []
            for dt_str in bench_dates:
                idx = bisect_right(p_dates, dt_str) - 1
                aligned_closes.append(p_closes[idx] if idx >= 0 else p_closes[0])

            _, base_cost_eur = self._position_value_and_cost_eur(
                pos, None, "EUR", eurusd, db=db
            )
            total_cost_target = base_cost_eur * eurusd if cur_norm == "USD" else base_cost_eur

            pos_lots = lots_by_pos.get(pos.id) or []
            first_price_date = p_dates[0]
            history_len = len(p_dates)
            if pos_lots:
                has_any_purchase_date = True
                lots_qty_sum = sum(float(l.quantity_added) for l in pos_lots if l.quantity_added > 0)
                lots_cost_sum = sum(
                    _convert_currency(
                        float(l.amount_eur or 0.0) + float(l.fees_eur or 0.0),
                        "EUR",
                        cur_norm,
                        eurusd,
                    )
                    for l in pos_lots
                    if l.quantity_added > 0
                )
                initial_qty = max(0.0, eff_qty - lots_qty_sum)
                if initial_qty > 1e-6:
                    pos_entries.append(
                        {
                            "qty": initial_qty,
                            "cost": max(0.0, total_cost_target - lots_cost_sum),
                            "start_date": start_date,
                            "first_price_date": first_price_date,
                            "history_len": history_len,
                            "has_explicit_date": bool(raw_pdate),
                            "closes": aligned_closes,
                        }
                    )
                for lot in pos_lots:
                    if lot.quantity_added > 0:
                        lot_dt = (lot.tx_date or "").strip()[:10] or start_date
                        lot_cost = _convert_currency(
                            float(lot.amount_eur or 0.0) + float(lot.fees_eur or 0.0),
                            "EUR",
                            cur_norm,
                            eurusd,
                        )
                        pos_entries.append(
                            {
                                "qty": float(lot.quantity_added),
                                "cost": lot_cost,
                                "start_date": lot_dt,
                                "first_price_date": first_price_date,
                                "history_len": history_len,
                                "has_explicit_date": True,
                                "closes": aligned_closes,
                            }
                        )
            else:
                pos_entries.append(
                    {
                        "qty": eff_qty,
                        "cost": total_cost_target,
                        "start_date": start_date,
                        "first_price_date": first_price_date,
                        "history_len": history_len,
                        "has_explicit_date": bool(raw_pdate),
                        "closes": aligned_closes,
                    }
                )

        if not pos_entries:
            return _empty_perf("backtest", "Backtest composition actuelle")

        rich_entries = [e for e in pos_entries if e["history_len"] >= 2] or pos_entries
        explicit_dates = [e["start_date"] for e in pos_entries if e["has_explicit_date"]]
        earliest_explicit_date = min(explicit_dates) if explicit_dates else None
        common_asset_start = max(e["first_price_date"] for e in rich_entries)
        earliest_asset_start = min(e["first_price_date"] for e in rich_entries)

        for e in pos_entries:
            if e["has_explicit_date"]:
                e["real_start_date"] = max(e["start_date"], e["first_price_date"])
            elif earliest_explicit_date:
                e["real_start_date"] = max(e["first_price_date"], earliest_explicit_date)
            else:
                e["real_start_date"] = common_asset_start

        def _first_idx_at_or_after(target_dt: str) -> int:
            for idx_day, dt_str in enumerate(bench_dates):
                if dt_str >= target_dt:
                    return idx_day
            return max(0, len(bench_dates) - 2)

        def _compute_series(use_real: bool) -> Optional[list[dict[str, Any]]]:
            if not use_real:
                totals = [
                    sum(e["qty"] * e["closes"][i] for e in rich_entries)
                    for i in range(len(bench_dates))
                ]
                i0 = _first_idx_at_or_after(common_asset_start)
                if len(bench_dates) - i0 < 2:
                    i0 = _first_idx_at_or_after(earliest_asset_start)
                if len(bench_dates) - i0 < 2:
                    i0 = 0
                if totals[i0] <= 0 or bench_closes[i0] <= 0:
                    return None
                base_p = totals[i0]
                base_b = bench_closes[i0]
                inv_total = sum(e.get("cost", 0.0) for e in rich_entries) + cash_target
                out: list[dict[str, Any]] = []
                for i in range(i0, len(bench_dates)):
                    dt_str = bench_dates[i]
                    p_b100 = (totals[i] / base_p) * 100.0
                    b_b100 = (bench_closes[i] / base_b) * 100.0
                    out.append(
                        {
                            "date": dt_str,
                            "portfolio_base100": round(p_b100, 2),
                            "benchmark_base100": round(b_b100, 2),
                            "portfolio_pct": round(p_b100 - 100.0, 2),
                            "benchmark_pct": round(b_b100 - 100.0, 2),
                            "portfolio_value": round(totals[i] + cash_target, 2),
                            "invested_value": round(inv_total, 2),
                            "benchmark_price": round(bench_closes[i], 2),
                        }
                    )
                return out

            # Real TWR mode using purchase_date (or earliest portfolio inception for un-dated positions)
            i0: Optional[int] = None
            for idx_day, dt_str in enumerate(bench_dates):
                v_start = sum(
                    e["qty"] * e["closes"][idx_day]
                    for e in pos_entries
                    if e["real_start_date"] <= dt_str
                )
                if v_start > 0 and bench_closes[idx_day] > 0:
                    i0 = idx_day
                    break

            if i0 is None or len(bench_dates) - i0 < 2:
                return None

            twr = 100.0
            base_bench = bench_closes[i0]
            v_start_val = (
                sum(
                    e["qty"] * e["closes"][i0]
                    for e in pos_entries
                    if e["real_start_date"] <= bench_dates[i0]
                )
                + cash_target
            )
            v_inv_start = (
                sum(
                    e.get("cost", 0.0)
                    for e in pos_entries
                    if e["real_start_date"] <= bench_dates[i0]
                )
                + cash_target
            )
            out = [
                {
                    "date": bench_dates[i0],
                    "portfolio_base100": 100.0,
                    "benchmark_base100": 100.0,
                    "portfolio_pct": 0.0,
                    "benchmark_pct": 0.0,
                    "portfolio_value": round(v_start_val, 2),
                    "invested_value": round(v_inv_start, 2),
                    "benchmark_price": round(bench_closes[i0], 2),
                }
            ]

            for i in range(i0 + 1, len(bench_dates)):
                dt_str = bench_dates[i]
                prev_dt = bench_dates[i - 1]
                # Positions already held at close of day i-1 drive day i return;
                # new buys on day i count as end-of-day inflows (excluded from day i return).
                held_prev = [e for e in pos_entries if e["real_start_date"] <= prev_dt]
                v_prev = sum(e["qty"] * e["closes"][i - 1] for e in held_prev)
                v_held_today = sum(e["qty"] * e["closes"][i] for e in held_prev)
                if v_prev > 0 and v_held_today > 0:
                    twr = twr * (v_held_today / v_prev)
                v_day = (
                    sum(
                        e["qty"] * e["closes"][i]
                        for e in pos_entries
                        if e["real_start_date"] <= dt_str
                    )
                    + cash_target
                )
                v_inv_day = (
                    sum(
                        e.get("cost", 0.0)
                        for e in pos_entries
                        if e["real_start_date"] <= dt_str
                    )
                    + cash_target
                )
                b_b100 = (bench_closes[i] / base_bench) * 100.0
                out.append(
                    {
                        "date": dt_str,
                        "portfolio_base100": round(twr, 2),
                        "benchmark_base100": round(b_b100, 2),
                        "portfolio_pct": round(twr - 100.0, 2),
                        "benchmark_pct": round(b_b100 - 100.0, 2),
                        "portfolio_value": round(v_day, 2),
                        "invested_value": round(v_inv_day, 2),
                        "benchmark_price": round(bench_closes[i], 2),
                    }
                )
            return out

        series_points: Optional[list[dict[str, Any]]] = None
        if mode_req == "real" and has_any_purchase_date:
            series_points = _compute_series(use_real=True)
            if series_points and len(series_points) >= 2:
                calc_mode = "real"
                calc_label = "Performance réelle (selon dates d'achat)"
            else:
                series_points = _compute_series(use_real=False)
                calc_mode = "backtest"
                calc_label = "Backtest composition actuelle (dates d'achat trop récentes)"
        else:
            series_points = _compute_series(use_real=False)
            calc_mode = "backtest"
            calc_label = "Backtest composition actuelle"

        if not series_points or len(series_points) < 2:
            return _empty_perf(calc_mode, calc_label)

        port_perf = series_points[-1]["portfolio_pct"]
        bench_perf = series_points[-1]["benchmark_pct"]
        alpha = round(port_perf - bench_perf, 2)
        daily_diffs = [
            pt["portfolio_pct"] - pt["benchmark_pct"]
            for pt in series_points[1:]
        ]
        avg_alpha = round(sum(daily_diffs) / len(daily_diffs), 2) if daily_diffs else alpha
        periodic_stats = self._compute_cagr_and_periodic_returns(series_points)

        perf_result = sanitize_for_json(
            {
                "period": period_norm,
                "benchmark": bench_sym,
                "benchmark_name": bench_name,
                "currency": cur_norm,
                "calculation_mode": calc_mode,
                "calculation_label": calc_label,
                "portfolio_perf_pct": port_perf,
                "benchmark_perf_pct": bench_perf,
                "portfolio_cagr_pct": periodic_stats["portfolio_cagr_pct"],
                "benchmark_cagr_pct": periodic_stats["benchmark_cagr_pct"],
                "elapsed_years": periodic_stats["elapsed_years"],
                "alpha_pts": alpha,
                "avg_alpha_pts": avg_alpha,
                "annual_returns": periodic_stats["annual_returns"],
                "quarterly_returns": periodic_stats["quarterly_returns"],
                "points": series_points,
                "positions_included": len(pos_entries),
                "updated_at": utc_now().isoformat(),
            }
        )
        with self._resp_lock:
            self._perf_cache[perf_cache_key] = (time.monotonic(), perf_sig, perf_result)
        return perf_result

    @staticmethod
    def _compute_cagr_and_periodic_returns(series_points: list[dict[str, Any]]) -> dict[str, Any]:
        if len(series_points) < 2:
            return {
                "portfolio_cagr_pct": None,
                "benchmark_cagr_pct": None,
                "elapsed_years": None,
                "annual_returns": [],
                "quarterly_returns": [],
            }

        start_dt = date.fromisoformat(str(series_points[0]["date"])[:10])
        end_dt = date.fromisoformat(str(series_points[-1]["date"])[:10])
        elapsed_days = max(0, (end_dt - start_dt).days)
        elapsed_years = round(elapsed_days / 365.25, 2)

        start_p = float(series_points[0]["portfolio_base100"])
        end_p = float(series_points[-1]["portfolio_base100"])
        start_b = float(series_points[0]["benchmark_base100"])
        end_b = float(series_points[-1]["benchmark_base100"])

        port_cagr: Optional[float] = None
        bench_cagr: Optional[float] = None
        if elapsed_days >= 30 and start_p > 0 and end_p > 0 and start_b > 0 and end_b > 0:
            exponent = 365.25 / float(elapsed_days)
            port_cagr = round(((end_p / start_p) ** exponent - 1.0) * 100.0, 2)
            bench_cagr = round(((end_b / start_b) ** exponent - 1.0) * 100.0, 2)

        def _group_buckets(key_fn: Callable[[date], str], limit: int) -> list[dict[str, Any]]:
            groups: list[tuple[str, list[dict[str, Any]]]] = []
            current_key: Optional[str] = None
            current_pts: list[dict[str, Any]] = []
            for pt in series_points:
                dt = date.fromisoformat(str(pt["date"])[:10])
                k = key_fn(dt)
                if k != current_key:
                    if current_pts:
                        groups.append((current_key or "", current_pts))
                    current_key = k
                    current_pts = [pt]
                else:
                    current_pts.append(pt)
            if current_pts and current_key is not None:
                groups.append((current_key, current_pts))

            buckets: list[dict[str, Any]] = []
            prev_end_p = float(groups[0][1][0]["portfolio_base100"]) if groups else 100.0
            prev_end_b = float(groups[0][1][0]["benchmark_base100"]) if groups else 100.0
            for idx_g, (label, pts) in enumerate(groups):
                end_bucket_p = float(pts[-1]["portfolio_base100"])
                end_bucket_b = float(pts[-1]["benchmark_base100"])
                base_p = float(pts[0]["portfolio_base100"]) if idx_g == 0 else prev_end_p
                base_b = float(pts[0]["benchmark_base100"]) if idx_g == 0 else prev_end_b
                start_label = str(pts[0]["date"])[:10]
                end_label = str(pts[-1]["date"])[:10]

                prev_end_p = end_bucket_p
                prev_end_b = end_bucket_b

                # Skip single-point t=0 stub if subsequent periods exist
                if idx_g == 0 and len(pts) == 1 and len(groups) > 1:
                    continue
                if base_p <= 0 or base_b <= 0:
                    continue

                p_ret = round(((end_bucket_p / base_p) - 1.0) * 100.0, 2)
                b_ret = round(((end_bucket_b / base_b) - 1.0) * 100.0, 2)
                buckets.append(
                    {
                        "label": label,
                        "start_date": start_label,
                        "end_date": end_label,
                        "portfolio_return_pct": p_ret,
                        "benchmark_return_pct": b_ret,
                        "alpha_pts": round(p_ret - b_ret, 2),
                    }
                )
            return buckets[-limit:]

        annual_returns = _group_buckets(lambda dt: f"{dt.year}", 10)
        quarterly_returns = _group_buckets(lambda dt: f"T{((dt.month - 1) // 3) + 1} {dt.year}", 16)

        return {
            "portfolio_cagr_pct": port_cagr,
            "benchmark_cagr_pct": bench_cagr,
            "elapsed_years": elapsed_years,
            "annual_returns": annual_returns,
            "quarterly_returns": quarterly_returns,
        }

    def get_watchlist(self, db: Session, refresh: bool = False) -> dict[str, Any]:
        items = db.query(WatchlistItem).order_by(WatchlistItem.created_at.desc()).all()
        fx = market_data_service.get_eurusd_rate(db, refresh=refresh)
        eurusd = safe_float(fx.get("rate")) or 1.08

        if not items:
            return sanitize_for_json(
                {"items": [], "alerts_count": 0, "updated_at": utc_now().isoformat()}
            )

        enriched_map = _enrich_tickers_parallel(db, [i.ticker for i in items], refresh=refresh)
        output: list[dict[str, Any]] = []

        for item in items:
            bundle = enriched_map.get(item.ticker) or {}
            quote = bundle.get("quote") or {}
            scores = bundle.get("scores") or {}

            asset_currency = quote.get("currency") or item.target_currency or "USD"
            current_price = safe_float(quote.get("price"))
            target_price = safe_float(item.target_price)
            target_currency = item.target_currency or asset_currency

            distance_pct: Optional[float] = None
            alert_triggered = False
            if current_price is not None and current_price > 0 and target_price is not None and target_price > 0:
                px_eur = _to_eur(current_price, asset_currency, eurusd, db=db)
                tgt_eur = _to_eur(target_price, target_currency, eurusd, db=db)
                if px_eur is not None and tgt_eur is not None and tgt_eur > 0:
                    distance_pct = round(((px_eur - tgt_eur) / tgt_eur) * 100.0, 1)
                    alert_triggered = px_eur <= tgt_eur

            output.append(
                {
                    "id": item.id,
                    "ticker": item.ticker,
                    "name": quote.get("name") or item.ticker,
                    "logo_url": quote.get("logo_url"),
                    "asset_type": quote.get("asset_type") or "EQUITY",
                    "region": quote.get("region") or "US",
                    "pea_eligible": bool(quote.get("pea_eligible", False)),
                    "sector": quote.get("sector"),
                    "currency": asset_currency,
                    "current_price": current_price,
                    "day_change_pct": safe_float(quote.get("day_change_pct")),
                    "score_global": safe_float((scores.get("global") or {}).get("score")),
                    "score_valuation": safe_float((scores.get("valuation") or {}).get("score")),
                    "summary_badge": scores.get("summary_badge"),
                    "summary_tone": scores.get("summary_tone"),
                    "target_price": target_price,
                    "target_currency": target_currency if target_price is not None else None,
                    "distance_to_target_pct": distance_pct,
                    "alert_triggered": alert_triggered,
                    "notes": item.notes,
                    "created_at": (item.created_at or utc_now()).isoformat(),
                }
            )

        output.sort(key=lambda x: (not x["alert_triggered"], x["created_at"]), reverse=False)
        # Re-sort non-alerted newest first while keeping alerts on top
        alerts = sorted([x for x in output if x["alert_triggered"]], key=lambda x: x["created_at"], reverse=True)
        others = sorted([x for x in output if not x["alert_triggered"]], key=lambda x: x["created_at"], reverse=True)
        final_items = alerts + others

        return sanitize_for_json(
            {
                "items": final_items,
                "alerts_count": len(alerts),
                "updated_at": utc_now().isoformat(),
            }
        )

    def upsert_watchlist_item(self, db: Session, data: WatchlistItemCreate) -> dict[str, Any]:
        sym = normalize_ticker(data.ticker)
        quote = market_data_service.get_quote_and_info(db, sym, refresh=False)
        target_currency = (data.target_currency or quote.get("currency") or "USD").strip().upper()

        existing = db.query(WatchlistItem).filter(WatchlistItem.ticker == sym).first()
        if existing is None:
            existing = WatchlistItem(
                ticker=sym,
                target_price=data.target_price,
                target_currency=target_currency if data.target_price is not None else None,
                notes=data.notes,
            )
            db.add(existing)
        else:
            if data.target_price is not None:
                existing.target_price = data.target_price
                existing.target_currency = target_currency
            if data.notes is not None:
                existing.notes = data.notes
        db.commit()
        db.refresh(existing)

        wl = self.get_watchlist(db, refresh=False)
        for item in wl["items"]:
            if item["id"] == existing.id:
                return item
        raise ValueError("Watchlist item saved but failed to load")

    def update_watchlist_item(
        self, db: Session, item_id: int, data: WatchlistItemUpdate
    ) -> dict[str, Any]:
        row = db.get(WatchlistItem, item_id)
        if row is None:
            raise ValueError(f"Watchlist item {item_id} introuvable")

        if data.clear_target:
            row.target_price = None
            row.target_currency = None
        elif data.target_price is not None:
            row.target_price = data.target_price
            if data.target_currency:
                row.target_currency = data.target_currency.strip().upper()
            elif not row.target_currency:
                quote = market_data_service.get_quote_and_info(db, row.ticker, refresh=False)
                row.target_currency = (quote.get("currency") or "USD").upper()
        elif data.target_currency is not None and row.target_price is not None:
            row.target_currency = data.target_currency.strip().upper()

        if data.notes is not None:
            row.notes = data.notes
        db.commit()

        wl = self.get_watchlist(db, refresh=False)
        for item in wl["items"]:
            if item["id"] == row.id:
                return item
        raise ValueError("Watchlist item updated but failed to load")

    def delete_watchlist_item(self, db: Session, item_id: int) -> None:
        row = db.get(WatchlistItem, item_id)
        if row is None:
            raise ValueError(f"Watchlist item {item_id} introuvable")
        db.delete(row)
        db.commit()

    def delete_watchlist_by_ticker(self, db: Session, ticker: str) -> None:
        sym = normalize_ticker(ticker)
        row = db.query(WatchlistItem).filter(WatchlistItem.ticker == sym).first()
        if row is None:
            raise ValueError(f"Ticker {sym} absent de la watchlist")
        db.delete(row)
        db.commit()

    @staticmethod
    def _position_value_and_cost_eur(
        pos: PortfolioPosition,
        live_price: Optional[float],
        asset_currency: str,
        eurusd: float,
        db: Optional[Session] = None,
    ) -> tuple[float, float]:
        fees_eur = float(pos.fees_eur or 0.0)
        if pos.quantity is not None and pos.pru is not None:
            cost_eur = (_to_eur(pos.quantity * pos.pru, pos.currency, eurusd, db=db) or 0.0) + fees_eur
            if live_price is not None and live_price > 0:
                val_eur = _to_eur(pos.quantity * live_price, asset_currency, eurusd, db=db) or cost_eur
            else:
                val_eur = cost_eur
            return val_eur, cost_eur
        if pos.invested_amount is not None and pos.pru is not None and pos.pru > 0:
            cost_eur = (_to_eur(pos.invested_amount, pos.currency, eurusd, db=db) or 0.0) + fees_eur
            if live_price is not None and live_price > 0:
                implied_qty = pos.invested_amount / pos.pru
                val_eur = _to_eur(implied_qty * live_price, asset_currency, eurusd, db=db) or cost_eur
            else:
                val_eur = cost_eur
            return val_eur, cost_eur
        cost_eur = (_to_eur(pos.invested_amount, pos.currency, eurusd, db=db) or 0.0) + fees_eur
        return cost_eur, cost_eur

    def get_opportunity_radar(self, db: Session, refresh: bool = False) -> dict[str, Any]:
        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.id.asc()).all()
        watchlist = db.query(WatchlistItem).order_by(WatchlistItem.created_at.desc()).all()

        tickers = sorted({p.ticker for p in positions} | {w.ticker for w in watchlist})
        if not tickers:
            return sanitize_for_json(
                {
                    "items": [],
                    "upcoming_earnings": [],
                    "buy_zone_count": 0,
                    "updated_at": utc_now().isoformat(),
                }
            )

        fx = market_data_service.get_eurusd_rate(db, refresh=refresh)
        eurusd = safe_float(fx.get("rate")) or 1.08
        enriched_map = _enrich_tickers_parallel(db, tickers, refresh=refresh)

        pos_by_ticker: dict[str, list[PortfolioPosition]] = defaultdict(list)
        for p in positions:
            pos_by_ticker[p.ticker].append(p)
        wl_set = {w.ticker for w in watchlist}

        radar_items: list[dict[str, Any]] = []
        earnings_items: list[dict[str, Any]] = []
        buy_zone_count = 0

        for sym in tickers:
            bundle = enriched_map.get(sym) or {}
            quote = bundle.get("quote") or {}
            scores = bundle.get("scores") or {}
            fv_obj = bundle.get("fair_value") or {}
            red_flags = bundle.get("red_flags") or []

            held_list = pos_by_ticker.get(sym) or []
            in_port = len(held_list) > 0
            in_wl = sym in wl_set

            detected_type = detect_asset_type(quote.get("asset_type"), quote.get("name"), sym)
            asset_type = (held_list[0].asset_type_override if held_list else None) or detected_type or "EQUITY"
            asset_cur = quote.get("currency") or (held_list[0].currency if held_list else "USD")
            price = safe_float(quote.get("price"))

            val_eur: Optional[float] = None
            envelope: Optional[str] = None
            if in_port:
                val_sum = 0.0
                for p in held_list:
                    v_eur, _ = self._position_value_and_cost_eur(p, price, asset_cur, eurusd, db=db)
                    val_sum += v_eur
                val_eur = round(val_sum, 2)
                envelope = held_list[0].envelope

            score_global = safe_float((scores.get("global") or {}).get("score"))
            fair_val = safe_float(fv_obj.get("fair_value")) if asset_type != "ETF" else None
            mos_pct = safe_float(fv_obj.get("margin_of_safety_pct")) if asset_type != "ETF" else None
            # Price deviation vs Fair Value: negative means discounted (e.g. -25% below FV)
            price_vs_fv_pct: Optional[float] = None
            if price is not None and fair_val is not None and fair_val > 0:
                price_vs_fv_pct = round(((price - fair_val) / fair_val) * 100.0, 1)
            elif mos_pct is not None:
                price_vs_fv_pct = round(-mos_pct, 1)

            high_52w = safe_float(quote.get("fifty_two_week_high"))
            if (high_52w is None or high_52w <= 0) and isinstance(bundle.get("prices"), dict):
                cutoff_52w = (utc_now().date() - timedelta(days=365)).isoformat()
                high_vals = [
                    safe_float(pt.get("high")) or safe_float(pt.get("close"))
                    for pt in (bundle["prices"].get("points") or [])
                    if str(pt.get("date") or "")[:10] >= cutoff_52w
                ]
                valid_highs = [v for v in high_vals if v is not None and v > 0]
                if valid_highs:
                    high_52w = max(valid_highs)

            dist_52w = (
                round(((price - high_52w) / high_52w) * 100.0, 1)
                if (price is not None and high_52w is not None and high_52w > 0)
                else None
            )

            next_earn = quote.get("next_earnings_date") if asset_type != "ETF" else None
            days_earn = safe_float(quote.get("days_until_earnings")) if next_earn else None
            days_earn_int = int(days_earn) if days_earn is not None and days_earn >= 0 else None

            if asset_type == "ETF":
                signal = "etf"
                signal_label = "Socle ETF"
                signal_tone = "slate"
            elif (score_global or 0.0) >= 70.0 and price_vs_fv_pct is not None and price_vs_fv_pct <= -5.0:
                signal = "buy"
                signal_label = "Zone d'achat"
                signal_tone = "emerald"
                buy_zone_count += 1
            elif price_vs_fv_pct is not None and price_vs_fv_pct > 15.0:
                signal = "wait"
                signal_label = "Patienter / Cher"
                signal_tone = "coral"
            else:
                signal = "watch"
                signal_label = "À surveiller"
                signal_tone = "amber"

            # Attractiveness score combines quality score + valuation discount + 52w pullback - red flag penalty
            sc_base = score_global if score_global is not None else 50.0
            mos_bonus = max(-25.0, min(40.0, mos_pct or 0.0)) * 0.75
            pullback_bonus = min(20.0, abs(min(0.0, dist_52w or 0.0))) * 0.35
            rf_penalty = len(red_flags) * 5.0
            attractiveness = round(sc_base + mos_bonus + pullback_bonus - rf_penalty, 1)

            name = quote.get("name") or sym
            radar_items.append(
                {
                    "ticker": sym,
                    "name": name,
                    "logo_url": quote.get("logo_url"),
                    "asset_type": asset_type,
                    "region": quote.get("region") or "US",
                    "pea_eligible": bool(quote.get("pea_eligible", False)),
                    "sector": "ETF" if asset_type == "ETF" else quote.get("sector"),
                    "currency": asset_cur,
                    "in_portfolio": in_port,
                    "in_watchlist": in_wl,
                    "envelope": envelope,
                    "current_value_eur": val_eur,
                    "current_price": price,
                    "day_change_pct": safe_float(quote.get("day_change_pct")),
                    "score_global": score_global,
                    "fair_value": fair_val,
                    "margin_of_safety_pct": mos_pct,
                    "price_vs_fair_value_pct": price_vs_fv_pct,
                    "distance_52w_high_pct": dist_52w,
                    "next_earnings_date": next_earn,
                    "days_until_earnings": days_earn_int,
                    "red_flags_count": len(red_flags),
                    "signal": signal,
                    "signal_label": signal_label,
                    "signal_tone": signal_tone,
                    "attractiveness_score": attractiveness,
                }
            )

            if next_earn and days_earn_int is not None:
                earnings_items.append(
                    {
                        "ticker": sym,
                        "name": name,
                        "logo_url": quote.get("logo_url"),
                        "in_portfolio": in_port,
                        "in_watchlist": in_wl,
                        "next_earnings_date": next_earn,
                        "days_until_earnings": days_earn_int,
                        "score_global": score_global,
                    }
                )

        radar_items.sort(
            key=lambda x: (
                0 if x["signal"] == "buy" else (1 if x["signal"] == "watch" else (2 if x["signal"] == "etf" else 3)),
                -x["attractiveness_score"],
            )
        )
        earnings_items.sort(key=lambda x: (x["days_until_earnings"], x["ticker"]))

        return sanitize_for_json(
            {
                "items": radar_items,
                "upcoming_earnings": earnings_items,
                "buy_zone_count": buy_zone_count,
                "updated_at": utc_now().isoformat(),
            }
        )

    def get_dca_settings(self, db: Session) -> dict[str, Any]:
        row = db.get(UserSetting, "dca_settings")
        defaults = DcaSettings().model_dump()
        if row and isinstance(row.value, dict):
            etf_pct = safe_float(row.value.get("etf_target_pct"))
            if etf_pct is not None:
                etf_pct = max(0.0, min(100.0, etf_pct))
            else:
                etf_pct = defaults["etf_target_pct"]
            merged = {
                "monthly_amount_eur": safe_float(row.value.get("monthly_amount_eur"))
                or defaults["monthly_amount_eur"],
                "etf_target_pct": round(etf_pct, 1),
                "equities_target_pct": round(100.0 - etf_pct, 1),
                "default_mode": (
                    row.value.get("default_mode")
                    if row.value.get("default_mode") in {"standard", "opportunistic"}
                    else "standard"
                ),
            }
            return merged
        return defaults

    def save_dca_settings(self, db: Session, data: DcaSettings) -> dict[str, Any]:
        etf_pct = round(max(0.0, min(100.0, float(data.etf_target_pct))), 1)
        payload = {
            "monthly_amount_eur": round(float(data.monthly_amount_eur), 2),
            "etf_target_pct": etf_pct,
            "equities_target_pct": round(100.0 - etf_pct, 1),
            "default_mode": data.default_mode,
        }
        row = db.get(UserSetting, "dca_settings")
        if row is None:
            row = UserSetting(key="dca_settings", value=payload)
            db.add(row)
        else:
            row.value = payload
        db.commit()
        return payload

    def build_dca_plan(self, db: Session, req: DcaPlanRequest) -> dict[str, Any]:
        if req.save_settings:
            self.save_dca_settings(
                db,
                DcaSettings(
                    monthly_amount_eur=req.amount_eur,
                    etf_target_pct=req.etf_target_pct,
                    equities_target_pct=round(100.0 - req.etf_target_pct, 1),
                    default_mode=req.mode,
                ),
            )

        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.id.asc()).all()
        watchlist = db.query(WatchlistItem).order_by(WatchlistItem.created_at.desc()).all()
        tickers = sorted({p.ticker for p in positions} | {w.ticker for w in watchlist})

        fx = market_data_service.get_eurusd_rate(db, refresh=False)
        eurusd = safe_float(fx.get("rate")) or 1.08
        enriched_map = _enrich_tickers_parallel(db, tickers, refresh=False) if tickers else {}

        pos_payloads: list[dict[str, Any]] = []
        for pos in positions:
            bundle = enriched_map.get(pos.ticker) or {}
            quote = bundle.get("quote") or {}
            scores = bundle.get("scores") or {}
            fv_obj = bundle.get("fair_value") or {}
            detected = detect_asset_type(quote.get("asset_type"), quote.get("name"), pos.ticker)
            asset_type = pos.asset_type_override or detected or pos.asset_type or "EQUITY"
            asset_cur = quote.get("currency") or pos.currency or "EUR"
            live_price = safe_float(quote.get("price"))
            val_eur, _ = self._position_value_and_cost_eur(pos, live_price, asset_cur, eurusd, db=db)
            pos_payloads.append(
                {
                    "ticker": pos.ticker,
                    "name": quote.get("name") or pos.ticker,
                    "asset_type": asset_type,
                    "envelope": pos.envelope,
                    "pea_eligible": bool(quote.get("pea_eligible", False)),
                    "current_value_eur": val_eur,
                    "score_global": safe_float((scores.get("global") or {}).get("score")),
                    "margin_of_safety_pct": safe_float(fv_obj.get("margin_of_safety_pct"))
                    if asset_type != "ETF"
                    else None,
                }
            )

        wl_payloads: list[dict[str, Any]] = []
        for item in watchlist:
            bundle = enriched_map.get(item.ticker) or {}
            quote = bundle.get("quote") or {}
            scores = bundle.get("scores") or {}
            fv_obj = bundle.get("fair_value") or {}
            asset_type = detect_asset_type(quote.get("asset_type"), quote.get("name"), item.ticker)
            wl_payloads.append(
                {
                    "ticker": item.ticker,
                    "name": quote.get("name") or item.ticker,
                    "asset_type": asset_type,
                    "pea_eligible": bool(quote.get("pea_eligible", False)),
                    "score_global": safe_float((scores.get("global") or {}).get("score")),
                    "margin_of_safety_pct": safe_float(fv_obj.get("margin_of_safety_pct"))
                    if asset_type != "ETF"
                    else None,
                }
            )

        return compute_dca_plan(
            amount_eur=req.amount_eur,
            etf_target_pct=req.etf_target_pct,
            mode=req.mode,
            positions=pos_payloads,
            watchlist_items=wl_payloads,
        )

    def get_projection_defaults(self, db: Session, refresh: bool = False) -> dict[str, Any]:
        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.id.asc()).all()
        fx = market_data_service.get_eurusd_rate(db, refresh=refresh)
        eurusd = safe_float(fx.get("rate")) or 1.08

        enriched_map = (
            _enrich_tickers_parallel(db, [p.ticker for p in positions], refresh=refresh)
            if positions
            else {}
        )

        pea_val = 0.0
        pea_contrib = 0.0
        cto_val = 0.0
        cto_contrib = 0.0

        for pos in positions:
            quote = (enriched_map.get(pos.ticker) or {}).get("quote") or {}
            asset_cur = quote.get("currency") or pos.currency or "EUR"
            live_price = safe_float(quote.get("price"))
            val_eur, cost_eur = self._position_value_and_cost_eur(pos, live_price, asset_cur, eurusd, db=db)
            if pos.envelope == "PEA":
                pea_val += val_eur
                pea_contrib += cost_eur
            else:
                cto_val += val_eur
                cto_contrib += cost_eur

        dca = self.get_dca_settings(db)
        return sanitize_for_json(
            {
                "initial_pea_value": round(pea_val, 2),
                "initial_pea_contributions": round(pea_contrib, 2),
                "initial_cto_value": round(cto_val, 2),
                "initial_cto_contributions": round(cto_contrib, 2),
                "monthly_contribution": dca["monthly_amount_eur"],
                "pea_share_pct": dca["etf_target_pct"],
                "pea_cap_eur": 150_000.0,
                "pea_tax_rate_pct": 18.6,
                "cto_tax_rate_pct": 31.4,
            }
        )

    def export_csv(self, db: Session, kind: Literal["positions", "sales"]) -> tuple[str, str]:
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=";")

        if kind == "sales":
            sales = (
                db.query(PortfolioSale)
                .order_by(PortfolioSale.sale_date.desc(), PortfolioSale.id.desc())
                .all()
            )
            writer.writerow(
                [
                    "Date de vente",
                    "Ticker",
                    "Nom",
                    "Type",
                    "Enveloppe",
                    "Quantite vendue",
                    "PRU (EUR)",
                    "Prix de vente (EUR)",
                    "Produit de cession (EUR)",
                    "Cout de revient (EUR)",
                    "Plus-value realisee (EUR)",
                    "Plus-value (%)",
                    "Vente totale",
                    "Notes",
                ]
            )
            for s in sales:
                writer.writerow(
                    [
                        s.sale_date,
                        s.ticker,
                        s.name,
                        s.asset_type,
                        s.envelope,
                        s.quantity_sold,
                        s.pru_eur,
                        s.sell_price_eur,
                        s.proceeds_eur,
                        s.cost_basis_eur,
                        s.realized_pnl_eur,
                        s.realized_pnl_pct if s.realized_pnl_pct is not None else "",
                        "Oui" if s.is_full_sale else "Non",
                        s.notes or "",
                    ]
                )
            filename = f"finscope-ventes-{utc_now().strftime('%Y-%m-%d')}.csv"
        else:
            dash = self.get_portfolio_dashboard(db, refresh=False)
            writer.writerow(
                [
                    "Ticker",
                    "Nom",
                    "Type",
                    "Enveloppe",
                    "Secteur",
                    "Date d'achat",
                    "Quantite",
                    "PRU",
                    "Devise saisie",
                    "Cours actuel",
                    "Valeur (EUR)",
                    "Montant investi (EUR)",
                    "Plus-value latente (EUR)",
                    "Plus-value (%)",
                    "Poids (%)",
                    "Note /100",
                    "Notes",
                ]
            )
            for p in dash["positions"]:
                writer.writerow(
                    [
                        p["ticker"],
                        p["name"],
                        p["asset_type"],
                        p["envelope"],
                        p.get("sector") or "",
                        p.get("purchase_date") or "",
                        p.get("quantity") if p.get("quantity") is not None else "",
                        p.get("pru") if p.get("pru") is not None else "",
                        p.get("currency") or "EUR",
                        p.get("current_price") if p.get("current_price") is not None else "",
                        p.get("current_value_eur"),
                        p.get("cost_basis_eur"),
                        p.get("pnl_eur"),
                        p.get("pnl_pct") if p.get("pnl_pct") is not None else "",
                        p.get("weight_pct"),
                        p.get("score_global") if p.get("score_global") is not None else "",
                        p.get("notes") or "",
                    ]
                )
            filename = f"finscope-positions-{utc_now().strftime('%Y-%m-%d')}.csv"

        # UTF-8 BOM for seamless Excel opening
        return filename, "\ufeff" + buf.getvalue()

    def export_backup(self, db: Session) -> dict[str, Any]:
        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.id.asc()).all()
        lots = db.query(PortfolioLot).order_by(PortfolioLot.id.asc()).all()
        sales = db.query(PortfolioSale).order_by(PortfolioSale.id.asc()).all()
        watchlist = db.query(WatchlistItem).order_by(WatchlistItem.id.asc()).all()
        settings_rows = db.query(UserSetting).all()

        return sanitize_for_json(
            {
                "version": 1,
                "exported_at": utc_now().isoformat(),
                "positions": [
                    {
                        "id": p.id,
                        "ticker": p.ticker,
                        "asset_type": p.asset_type,
                        "asset_type_override": p.asset_type_override,
                        "envelope": p.envelope,
                        "quantity": p.quantity,
                        "pru": p.pru,
                        "invested_amount": p.invested_amount,
                        "currency": p.currency,
                        "purchase_date": p.purchase_date,
                        "fees_eur": float(p.fees_eur or 0.0),
                        "notes": p.notes,
                    }
                    for p in positions
                ],
                "lots": [
                    {
                        "position_id": l.position_id,
                        "ticker": l.ticker,
                        "quantity_added": l.quantity_added,
                        "price_input": l.price_input,
                        "currency": l.currency,
                        "price_eur": l.price_eur,
                        "amount_eur": l.amount_eur,
                        "fees_eur": float(l.fees_eur or 0.0),
                        "tx_date": l.tx_date,
                        "notes": l.notes,
                    }
                    for l in lots
                ],
                "sales": [
                    {
                        "ticker": s.ticker,
                        "name": s.name,
                        "asset_type": s.asset_type,
                        "envelope": s.envelope,
                        "quantity_sold": s.quantity_sold,
                        "pru_eur": s.pru_eur,
                        "sell_price_eur": s.sell_price_eur,
                        "sell_price_input": s.sell_price_input,
                        "sell_currency": s.sell_currency,
                        "proceeds_eur": s.proceeds_eur,
                        "cost_basis_eur": s.cost_basis_eur,
                        "realized_pnl_eur": s.realized_pnl_eur,
                        "realized_pnl_pct": s.realized_pnl_pct,
                        "sale_date": s.sale_date,
                        "is_full_sale": s.is_full_sale,
                        "notes": s.notes,
                    }
                    for s in sales
                ],
                "watchlist": [
                    {
                        "ticker": w.ticker,
                        "target_price": w.target_price,
                        "target_currency": w.target_currency,
                        "notes": w.notes,
                    }
                    for w in watchlist
                ],
                "settings": {r.key: r.value for r in settings_rows},
            }
        )

    def restore_backup(self, db: Session, payload: PortfolioBackupPayload) -> dict[str, Any]:
        db.query(PortfolioLot).delete()
        db.query(PortfolioPosition).delete()
        db.query(PortfolioSale).delete()
        db.query(WatchlistItem).delete()
        db.query(UserSetting).delete()
        db.flush()

        id_map: dict[Any, int] = {}
        pos_count = 0
        for item in payload.positions:
            sym = normalize_ticker(str(item.get("ticker") or ""))
            if not sym:
                continue
            row = PortfolioPosition(
                ticker=sym,
                asset_type=str(item.get("asset_type") or "EQUITY"),
                asset_type_override=item.get("asset_type_override"),
                envelope=str(item.get("envelope") or "CTO"),
                quantity=safe_float(item.get("quantity")),
                pru=safe_float(item.get("pru")),
                invested_amount=safe_float(item.get("invested_amount")),
                currency=str(item.get("currency") or "EUR"),
                purchase_date=item.get("purchase_date"),
                fees_eur=round(float(safe_float(item.get("fees_eur")) or 0.0), 2),
                notes=item.get("notes"),
            )
            db.add(row)
            db.flush()
            if item.get("id") is not None:
                id_map[item.get("id")] = row.id
            pos_count += 1

        lots_count = 0
        for item in payload.lots:
            new_pid = id_map.get(item.get("position_id"))
            sym = normalize_ticker(str(item.get("ticker") or ""))
            qty = safe_float(item.get("quantity_added"))
            if new_pid is None or not sym or qty is None:
                continue
            db.add(
                PortfolioLot(
                    position_id=new_pid,
                    ticker=sym,
                    quantity_added=qty,
                    price_input=safe_float(item.get("price_input")) or 0.0,
                    currency=str(item.get("currency") or "EUR"),
                    price_eur=safe_float(item.get("price_eur")) or 0.0,
                    amount_eur=safe_float(item.get("amount_eur")) or 0.0,
                    fees_eur=round(float(safe_float(item.get("fees_eur")) or 0.0), 2),
                    tx_date=str(item.get("tx_date") or utc_now().strftime("%Y-%m-%d")),
                    notes=item.get("notes"),
                )
            )
            lots_count += 1

        sales_count = 0
        for item in payload.sales:
            sym = normalize_ticker(str(item.get("ticker") or ""))
            if not sym:
                continue
            db.add(
                PortfolioSale(
                    ticker=sym,
                    name=str(item.get("name") or sym),
                    asset_type=str(item.get("asset_type") or "EQUITY"),
                    envelope=str(item.get("envelope") or "CTO"),
                    quantity_sold=safe_float(item.get("quantity_sold")) or 0.0,
                    pru_eur=safe_float(item.get("pru_eur")) or 0.0,
                    sell_price_eur=safe_float(item.get("sell_price_eur")) or 0.0,
                    sell_price_input=safe_float(item.get("sell_price_input")) or 0.0,
                    sell_currency=str(item.get("sell_currency") or "EUR"),
                    proceeds_eur=safe_float(item.get("proceeds_eur")) or 0.0,
                    cost_basis_eur=safe_float(item.get("cost_basis_eur")) or 0.0,
                    realized_pnl_eur=safe_float(item.get("realized_pnl_eur")) or 0.0,
                    realized_pnl_pct=safe_float(item.get("realized_pnl_pct")),
                    sale_date=str(item.get("sale_date") or utc_now().strftime("%Y-%m-%d")),
                    is_full_sale=bool(item.get("is_full_sale", False)),
                    notes=item.get("notes"),
                )
            )
            sales_count += 1

        seen_wl: set[str] = set()
        wl_count = 0
        for item in payload.watchlist:
            sym = normalize_ticker(str(item.get("ticker") or ""))
            if not sym or sym in seen_wl:
                continue
            seen_wl.add(sym)
            db.add(
                WatchlistItem(
                    ticker=sym,
                    target_price=safe_float(item.get("target_price")),
                    target_currency=item.get("target_currency"),
                    notes=item.get("notes"),
                )
            )
            wl_count += 1

        settings_count = 0
        for k, v in (payload.settings or {}).items():
            db.add(UserSetting(key=str(k)[:64], value=v))
            settings_count += 1

        db.commit()
        self.invalidate_response_cache(db)
        return {
            "restored": True,
            "positions_count": pos_count,
            "lots_count": lots_count,
            "sales_count": sales_count,
            "watchlist_count": wl_count,
            "settings_count": settings_count,
        }


portfolio_service = PortfolioService()
