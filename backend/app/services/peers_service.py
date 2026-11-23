import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db.models import PeerOverride
from app.services.cache_service import cache_service
from app.services.market_data import market_data_service, normalize_ticker
from app.services.scoring_engine import persist_asset_scores, score_equity
from app.utils.math_utils import safe_float, sanitize_for_json, utc_now

logger = logging.getLogger(__name__)

LOWER_IS_BETTER_METRICS = {"pe", "forward_pe", "p_fcf", "peg", "net_debt_ebitda"}
RATIO_HIGHER_IS_BETTER_METRICS = {
    "rev_growth_1y",
    "rev_growth_3y",
    "eps_growth_1y",
    "gross_margin",
    "op_margin",
    "net_margin",
    "roe",
}
SCORE_METRICS = {
    "score_global",
    "score_valuation",
    "score_growth",
    "score_quality",
    "score_health",
}

CLIP_BOUNDS: dict[str, tuple[float, float]] = {
    "pe": (0.01, 150.0),
    "forward_pe": (0.01, 150.0),
    "p_fcf": (0.01, 150.0),
    "peg": (0.01, 10.0),
    "net_debt_ebitda": (-5.0, 15.0),
    "rev_growth_1y": (-1.0, 2.5),
    "rev_growth_3y": (-1.0, 2.5),
    "eps_growth_1y": (-1.0, 2.5),
    "gross_margin": (-1.0, 1.0),
    "op_margin": (-1.0, 1.0),
    "net_margin": (-1.0, 1.0),
    "roe": (-1.0, 3.0),
    "score_global": (0.0, 100.0),
    "score_valuation": (0.0, 100.0),
    "score_growth": (0.0, 100.0),
    "score_quality": (0.0, 100.0),
    "score_health": (0.0, 100.0),
}


def get_peer_overrides(db: Session, ticker: str) -> tuple[list[str], list[str]]:
    sym = normalize_ticker(ticker)
    rows = db.query(PeerOverride).filter(PeerOverride.ticker == sym).all()
    added = [r.peer_ticker for r in rows if r.action == "ADD"]
    excluded = [r.peer_ticker for r in rows if r.action == "EXCLUDE"]
    return added, excluded


def update_peer_override(
    db: Session,
    ticker: str,
    peer_ticker: Optional[str],
    action: str,
) -> dict[str, Any]:
    sym = normalize_ticker(ticker)
    act = action.strip().upper()
    if act not in {"ADD", "EXCLUDE", "REMOVE", "RESET"}:
        raise ValueError(f"Unsupported action '{action}'")

    if act == "RESET":
        db.query(PeerOverride).filter(PeerOverride.ticker == sym).delete(synchronize_session=False)
        db.commit()
    else:
        if not peer_ticker or not peer_ticker.strip():
            raise ValueError("peer_ticker is required")
        peer_sym = normalize_ticker(peer_ticker)
        if peer_sym == sym:
            raise ValueError("Cannot override the analyzed ticker itself")

        existing = (
            db.query(PeerOverride)
            .filter(PeerOverride.ticker == sym, PeerOverride.peer_ticker == peer_sym)
            .first()
        )
        if act == "REMOVE":
            if existing is not None:
                db.delete(existing)
                db.commit()
        else:
            if existing is None:
                db.add(PeerOverride(ticker=sym, peer_ticker=peer_sym, action=act))
            else:
                existing.action = act
            db.commit()

    cache_service.invalidate(db, f"peers:{sym}")
    cache_service.invalidate(db, f"peers_list:{sym}")
    added, excluded = get_peer_overrides(db, sym)
    return {"ticker": sym, "added": added, "excluded": excluded}


def _row_from_quote_and_scores(
    quote: dict[str, Any],
    scores: dict[str, Any],
    is_target: bool = False,
) -> dict[str, Any]:
    m = scores.get("metrics") or {}
    return sanitize_for_json(
        {
            "ticker": quote["ticker"],
            "name": quote.get("name") or quote["ticker"],
            "logo_url": quote.get("logo_url"),
            "currency": quote.get("currency"),
            "market_cap": quote.get("market_cap"),
            "price": quote.get("price"),
            "pe": m.get("pe"),
            "forward_pe": m.get("forward_pe"),
            "p_fcf": m.get("p_fcf"),
            "peg": m.get("peg"),
            "rev_growth_1y": m.get("rev_growth_1y"),
            "rev_growth_3y": m.get("rev_growth_3y"),
            "eps_growth_1y": m.get("eps_growth_1y"),
            "gross_margin": m.get("gross_margin"),
            "op_margin": m.get("op_margin"),
            "net_margin": m.get("net_margin"),
            "roe": m.get("roe"),
            "net_debt_ebitda": m.get("net_debt_ebitda"),
            "score_global": (scores.get("global") or {}).get("score"),
            "score_valuation": (scores.get("valuation") or {}).get("score"),
            "score_growth": (scores.get("growth") or {}).get("score"),
            "score_quality": (scores.get("quality") or {}).get("score"),
            "score_health": (scores.get("health") or {}).get("score"),
            "is_target": is_target,
        }
    )


def _fetch_single_peer_snapshot(
    peer_ticker: str,
    session_factory: Callable[[], Session],
    refresh: bool = False,
) -> Optional[dict[str, Any]]:
    with session_factory() as db:
        try:
            quote = market_data_service.get_quote_and_info(db, peer_ticker, refresh=refresh)
            if quote.get("asset_type") == "ETF":
                return None
            fundamentals = market_data_service.get_fundamentals(db, peer_ticker, refresh=refresh)
            scores = score_equity(quote, fundamentals)
            persist_asset_scores(db, quote["ticker"], scores)
            return _row_from_quote_and_scores(quote, scores, is_target=False)
        except Exception as exc:
            logger.warning("Skipping peer %s: %s", peer_ticker, exc)
            return None


def compute_sector_averages(peer_rows: list[dict[str, Any]]) -> dict[str, Optional[float]]:
    """Compute outlier-clipped averages across peer rows (excluding the analyzed company)."""
    averages: dict[str, Optional[float]] = {}
    for metric, (low, high) in CLIP_BOUNDS.items():
        vals = [
            v
            for row in peer_rows
            if (v := safe_float(row.get(metric))) is not None and low <= v <= high
        ]
        if vals:
            avg = sum(vals) / len(vals)
            decimals = 4 if metric in RATIO_HIGHER_IS_BETTER_METRICS else (1 if metric in SCORE_METRICS else 2)
            averages[metric] = round(avg, decimals)
        else:
            averages[metric] = None
    return averages


def compute_deltas(
    company_row: dict[str, Any],
    sector_averages: dict[str, Optional[float]],
) -> dict[str, dict[str, Any]]:
    """Compute metric deltas and semantic status ('better'|'worse'|'neutral') vs sector average."""
    deltas: dict[str, dict[str, Any]] = {}

    for metric in CLIP_BOUNDS:
        val = safe_float(company_row.get(metric))
        avg = safe_float(sector_averages.get(metric))
        if val is None or avg is None:
            deltas[metric] = {"diff_pct": None, "diff_pts": None, "status": "neutral"}
            continue

        if metric in LOWER_IS_BETTER_METRICS:
            if abs(avg) > 1e-6:
                diff_pct = round(((val - avg) / abs(avg)) * 100.0, 1)
                diff_pts = round(val - avg, 2)
                if diff_pct <= -5.0:
                    status = "better"
                elif diff_pct >= 5.0:
                    status = "worse"
                else:
                    status = "neutral"
            else:
                diff_pts = round(val - avg, 2)
                diff_pct = None
                if diff_pts <= -0.3:
                    status = "better"
                elif diff_pts >= 0.3:
                    status = "worse"
                else:
                    status = "neutral"
            deltas[metric] = {"diff_pct": diff_pct, "diff_pts": diff_pts, "status": status}

        elif metric in RATIO_HIGHER_IS_BETTER_METRICS:
            diff_pts = round((val - avg) * 100.0, 1)
            diff_pct = round(((val - avg) / abs(avg)) * 100.0, 1) if abs(avg) > 1e-6 else None
            if diff_pts >= 1.5:
                status = "better"
            elif diff_pts <= -1.5:
                status = "worse"
            else:
                status = "neutral"
            deltas[metric] = {"diff_pct": diff_pct, "diff_pts": diff_pts, "status": status}

        else:
            # Score metrics (/100)
            diff_pts = round(val - avg, 1)
            diff_pct = round(((val - avg) / abs(avg)) * 100.0, 1) if abs(avg) > 1e-6 else None
            if diff_pts >= 4.0:
                status = "better"
            elif diff_pts <= -4.0:
                status = "worse"
            else:
                status = "neutral"
            deltas[metric] = {"diff_pct": diff_pct, "diff_pts": diff_pts, "status": status}

    return deltas


def _fmt_fr(val: float, decimals: int = 1) -> str:
    txt = f"{abs(val):.{decimals}f}"
    return txt.replace(".", ",")


def build_peers_summary(deltas: dict[str, dict[str, Any]]) -> str:
    """Build a concise 1-sentence French synthesis comparing profitability, growth, and PE."""
    prof_clause: Optional[str] = None
    for metric, label in (("net_margin", "marge nette"), ("op_margin", "marge opé")):
        d = deltas.get(metric) or {}
        pts = safe_float(d.get("diff_pts"))
        if pts is not None:
            if pts >= 1.5:
                prof_clause = f"Plus rentable (+{_fmt_fr(pts)} pts de {label})"
            elif pts <= -1.5:
                prof_clause = f"Moins rentable (-{_fmt_fr(pts)} pts de {label})"
            else:
                prof_clause = f"Rentabilité en ligne ({label})"
            break

    growth_clause: Optional[str] = None
    for metric, label in (("rev_growth_1y", "de CA"), ("rev_growth_3y", "de CA 3A")):
        d = deltas.get(metric) or {}
        pts = safe_float(d.get("diff_pts"))
        if pts is not None:
            if pts >= 2.0:
                growth_clause = f"en plus forte croissance (+{_fmt_fr(pts)} pts {label})"
            elif pts <= -2.0:
                growth_clause = f"en croissance plus modérée (-{_fmt_fr(pts)} pts {label})"
            else:
                growth_clause = f"croissance similaire {label}"
            break

    val_clause: Optional[str] = None
    for metric, label in (("pe", "PER"), ("forward_pe", "PER prév.")):
        d = deltas.get(metric) or {}
        pct = safe_float(d.get("diff_pct"))
        if pct is not None:
            if pct >= 8.0:
                val_clause = f"{abs(pct):.0f} % plus chère en {label}"
            elif pct <= -8.0:
                val_clause = f"{abs(pct):.0f} % moins chère en {label}"
            else:
                val_clause = f"valorisée en ligne en {label}"
            break

    left_parts = [p for p in (prof_clause, growth_clause) if p]
    if left_parts and val_clause:
        left_str = " et ".join(left_parts)
        prof_better = (deltas.get("net_margin", {}).get("status") == "better") or (
            deltas.get("op_margin", {}).get("status") == "better"
        )
        val_worse = (deltas.get("pe", {}).get("status") == "worse") or (
            deltas.get("forward_pe", {}).get("status") == "worse"
        )
        connector = "mais" if (prof_better and val_worse) or (not prof_better and not val_worse) else "et"
        return f"{left_str} que ses concurrents, {connector} {val_clause}."
    if left_parts:
        return f"{' et '.join(left_parts)} que ses concurrents."
    if val_clause:
        return f"Entreprise {val_clause} par rapport à ses concurrents directs."
    return "Comparaison sectorielle calculée sur les données disponibles des concurrents directs."


class PeersService:
    def get_peers_comparison(
        self,
        db: Session,
        ticker: str,
        extra: Optional[list[str]] = None,
        exclude: Optional[list[str]] = None,
        refresh: bool = False,
        session_factory: Optional[Callable[[], Session]] = None,
    ) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        extra_list = [normalize_ticker(t) for t in (extra or []) if t and t.strip() and normalize_ticker(t) != sym]
        exclude_list = [normalize_ticker(t) for t in (exclude or []) if t and t.strip()]

        use_cache = not extra_list and not exclude_list
        cache_key = f"peers:{sym}"
        if use_cache and not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = dict(cached.payload)
                payload["updated_at"] = cached.updated_at.isoformat()
                payload["is_stale"] = cached.is_stale
                return payload

        target_quote = market_data_service.get_quote_and_info(db, sym, refresh=refresh)
        if target_quote.get("asset_type") == "ETF":
            return sanitize_for_json(
                {
                    "ticker": sym,
                    "available": False,
                    "reason": "ETF",
                    "company": None,
                    "peers": [],
                    "sector_averages": {},
                    "deltas": {},
                    "radar": None,
                    "summary_sentence": "La comparaison sectorielle concerne uniquement les actions individuelles.",
                    "added_overrides": [],
                    "excluded_overrides": [],
                    "updated_at": utc_now().isoformat(),
                    "is_stale": False,
                }
            )

        target_fundamentals = market_data_service.get_fundamentals(db, sym, refresh=refresh)

        db_added, db_excluded = get_peer_overrides(db, sym)
        all_excluded = set(db_excluded) | set(exclude_list) | {sym}

        ordered_added: list[str] = []
        for p in db_added + extra_list:
            if p not in all_excluded and p not in ordered_added:
                ordered_added.append(p)

        raw_candidates = market_data_service.get_raw_peers(db, sym, refresh=refresh)
        candidates: list[str] = list(ordered_added)
        for p in raw_candidates:
            if p not in all_excluded and p not in candidates:
                candidates.append(p)

        # Fetch up to 6-8 candidates in parallel so we reliably keep 4-6 valid peers
        max_to_fetch = max(6, len(ordered_added) + 2)
        fetch_list = candidates[: min(8, max_to_fetch)]

        settings = get_settings()
        bind = db.get_bind()
        if session_factory is None:
            session_factory = sessionmaker(autocommit=False, autoflush=False, bind=bind)

        is_static_pool = isinstance(getattr(bind, "pool", None), StaticPool)
        max_workers = 1 if is_static_pool else max(1, min(settings.PEER_FETCH_CONCURRENCY, len(fetch_list) or 1))
        fetched_by_ticker: dict[str, dict[str, Any]] = {}

        if fetch_list:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_map = {
                    executor.submit(_fetch_single_peer_snapshot, peer_sym, session_factory, refresh): peer_sym
                    for peer_sym in fetch_list
                }
                for fut in as_completed(future_map):
                    peer_sym = future_map[fut]
                    try:
                        snap = fut.result()
                        if snap is not None:
                            fetched_by_ticker[peer_sym] = snap
                    except Exception as exc:
                        logger.warning("Peer future failed for %s: %s", peer_sym, exc)

        # Preserve manual additions first, then sort remaining auto peers by market-cap proximity (or original order)
        added_rows = [fetched_by_ticker[p] for p in ordered_added if p in fetched_by_ticker]
        auto_rows = [
            fetched_by_ticker[p]
            for p in fetch_list
            if p not in ordered_added and p in fetched_by_ticker
        ]
        target_mcap = safe_float(target_quote.get("market_cap"))
        if target_mcap and target_mcap > 0:
            auto_rows.sort(
                key=lambda r: abs((safe_float(r.get("market_cap")) or target_mcap * 10) - target_mcap)
            )

        selected_peers = (added_rows + auto_rows)[: max(6, len(added_rows))]

        sector_averages = compute_sector_averages(selected_peers)
        target_scores = score_equity(
            target_quote,
            target_fundamentals,
            sector_averages={
                "pe": sector_averages.get("pe"),
                "forward_pe": sector_averages.get("forward_pe"),
                "p_fcf": sector_averages.get("p_fcf"),
                "ev_ebitda": None,
            },
        )
        persist_asset_scores(db, sym, target_scores)

        company_row = _row_from_quote_and_scores(target_quote, target_scores, is_target=True)
        deltas = compute_deltas(company_row, sector_averages)

        radar = {
            "company": {
                "valuation": company_row.get("score_valuation"),
                "growth": company_row.get("score_growth"),
                "quality": company_row.get("score_quality"),
                "health": company_row.get("score_health"),
            },
            "sector_avg": {
                "valuation": sector_averages.get("score_valuation"),
                "growth": sector_averages.get("score_growth"),
                "quality": sector_averages.get("score_quality"),
                "health": sector_averages.get("score_health"),
            },
        }
        summary_sentence = build_peers_summary(deltas)

        payload = {
            "ticker": sym,
            "available": len(selected_peers) > 0,
            "reason": None if selected_peers else "NO_PEERS",
            "company": company_row,
            "peers": selected_peers,
            "sector_averages": sector_averages,
            "deltas": deltas,
            "radar": radar,
            "summary_sentence": summary_sentence,
            "added_overrides": db_added,
            "excluded_overrides": db_excluded,
        }

        if use_cache:
            updated_at = cache_service.set(db, cache_key, "peers", payload)
            return sanitize_for_json(
                {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
            )

        return sanitize_for_json(
            {**payload, "updated_at": utc_now().isoformat(), "is_stale": False}
        )


peers_service = PeersService()
