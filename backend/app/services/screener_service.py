import logging
import math
import threading
import time
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Asset
from app.schemas.screener import SeedJobStartRequest
from app.services.market_data import market_data_service, seed_assets_metadata
from app.services.scoring_engine import (
    get_cached_sector_averages,
    persist_asset_scores,
    score_equity,
    score_etf,
)
from app.utils.math_utils import sanitize_for_json, utc_now

logger = logging.getLogger(__name__)

SCREENER_PRESETS: dict[str, dict[str, Any]] = {
    "quality_on_sale": {
        "min_quality": 70.0,
        "min_valuation": 60.0,
        "asset_type": "EQUITY",
    },
    "profitable_hypergrowth": {
        "min_growth": 70.0,
        "min_quality": 60.0,
        "min_rev_growth_pct": 15.0,
        "asset_type": "EQUITY",
    },
    "financial_fortresses": {
        "min_health": 75.0,
        "min_quality": 65.0,
        "max_net_debt_ebitda": 1.0,
        "asset_type": "EQUITY",
    },
    "pea_eligible": {
        "pea_only": True,
    },
}

SORT_COLUMNS = {
    "score_global": Asset.score_global,
    "score_valuation": Asset.score_valuation,
    "score_growth": Asset.score_growth,
    "score_quality": Asset.score_quality,
    "score_health": Asset.score_health,
    "pe": Asset.pe,
    "forward_pe": Asset.forward_pe,
    "p_fcf": Asset.p_fcf,
    "rev_growth_1y": Asset.rev_growth_1y,
    "net_margin": Asset.net_margin,
    "roe": Asset.roe,
    "net_debt_ebitda": Asset.net_debt_ebitda,
    "market_cap": Asset.market_cap,
    "ticker": Asset.ticker,
}


def query_screener(
    db: Session,
    *,
    preset: Optional[str] = None,
    q: Optional[str] = None,
    asset_type: Optional[str] = None,
    region: Optional[str] = None,
    pea_only: Optional[bool] = None,
    sector: Optional[str] = None,
    only_scored: Optional[bool] = None,
    min_global: Optional[float] = None,
    min_valuation: Optional[float] = None,
    min_growth: Optional[float] = None,
    min_quality: Optional[float] = None,
    min_health: Optional[float] = None,
    max_pe: Optional[float] = None,
    min_rev_growth_pct: Optional[float] = None,
    max_net_debt_ebitda: Optional[float] = None,
    sort_by: str = "score_global",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    preset_cfg = SCREENER_PRESETS.get((preset or "").strip().lower(), {})

    eff_asset_type = asset_type if asset_type is not None else preset_cfg.get("asset_type")
    eff_pea_only = pea_only if pea_only is not None else bool(preset_cfg.get("pea_only", False))
    eff_min_global = min_global if min_global is not None else preset_cfg.get("min_global")
    eff_min_val = min_valuation if min_valuation is not None else preset_cfg.get("min_valuation")
    eff_min_growth = min_growth if min_growth is not None else preset_cfg.get("min_growth")
    eff_min_quality = min_quality if min_quality is not None else preset_cfg.get("min_quality")
    eff_min_health = min_health if min_health is not None else preset_cfg.get("min_health")
    eff_min_rev = (
        min_rev_growth_pct
        if min_rev_growth_pct is not None
        else preset_cfg.get("min_rev_growth_pct")
    )
    eff_max_debt = (
        max_net_debt_ebitda
        if max_net_debt_ebitda is not None
        else preset_cfg.get("max_net_debt_ebitda")
    )

    universe_count = db.query(Asset).count()
    scored_count = db.query(Asset).filter(Asset.score_global.is_not(None)).count()
    sector_rows = (
        db.query(Asset.sector)
        .filter(Asset.sector.is_not(None), Asset.sector != "")
        .distinct()
        .all()
    )
    sectors = sorted({s[0] for s in sector_rows if s[0]})

    query = db.query(Asset)

    if q and q.strip():
        pat = f"%{q.strip()}%"
        query = query.filter(or_(Asset.ticker.ilike(pat), Asset.name.ilike(pat)))

    if eff_asset_type and eff_asset_type.upper() in {"EQUITY", "ETF"}:
        query = query.filter(Asset.asset_type == eff_asset_type.upper())

    if region and region.upper() in {"US", "EU", "OTHER"}:
        query = query.filter(Asset.region == region.upper())

    if eff_pea_only:
        query = query.filter(Asset.pea_eligible.is_(True))

    if sector and sector.strip() and sector.strip().upper() != "ALL":
        query = query.filter(Asset.sector == sector.strip())

    if only_scored:
        query = query.filter(Asset.score_global.is_not(None))

    if eff_min_global is not None:
        query = query.filter(Asset.score_global >= eff_min_global)
    if eff_min_val is not None:
        query = query.filter(Asset.score_valuation >= eff_min_val)
    if eff_min_growth is not None:
        query = query.filter(Asset.score_growth >= eff_min_growth)
    if eff_min_quality is not None:
        query = query.filter(Asset.score_quality >= eff_min_quality)
    if eff_min_health is not None:
        query = query.filter(Asset.score_health >= eff_min_health)

    if max_pe is not None:
        query = query.filter(Asset.pe.is_not(None), Asset.pe > 0, Asset.pe <= max_pe)

    if eff_min_rev is not None:
        query = query.filter(Asset.rev_growth_1y >= (eff_min_rev / 100.0))

    if eff_max_debt is not None:
        query = query.filter(Asset.net_debt_ebitda <= eff_max_debt)

    total = query.count()

    sort_col = SORT_COLUMNS.get(sort_by, Asset.score_global)
    if sort_dir.strip().lower() == "asc":
        order_expr = sort_col.asc().nullslast()
    else:
        order_expr = sort_col.desc().nullslast()

    safe_page = max(1, page)
    safe_size = max(1, min(100, page_size))
    rows = (
        query.order_by(order_expr, Asset.market_cap.desc().nullslast(), Asset.ticker.asc())
        .offset((safe_page - 1) * safe_size)
        .limit(safe_size)
        .all()
    )

    items = [
        {
            "ticker": r.ticker,
            "name": r.name,
            "asset_type": r.asset_type,
            "region": r.region,
            "pea_eligible": r.pea_eligible,
            "sector": r.sector,
            "industry": r.industry,
            "logo_url": r.logo_url,
            "currency": r.currency,
            "price": r.price,
            "market_cap": r.market_cap,
            "pe": r.pe,
            "forward_pe": r.forward_pe,
            "p_fcf": r.p_fcf,
            "peg": r.peg,
            "rev_growth_1y": r.rev_growth_1y,
            "rev_growth_3y": r.rev_growth_3y,
            "eps_growth_1y": r.eps_growth_1y,
            "gross_margin": r.gross_margin,
            "op_margin": r.op_margin,
            "net_margin": r.net_margin,
            "roe": r.roe,
            "net_debt_ebitda": r.net_debt_ebitda,
            "score_global": r.score_global,
            "score_valuation": r.score_valuation,
            "score_growth": r.score_growth,
            "score_quality": r.score_quality,
            "score_health": r.score_health,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]

    return sanitize_for_json(
        {
            "total": total,
            "scored_count": scored_count,
            "universe_count": universe_count,
            "sectors": sectors,
            "items": items,
            "page": safe_page,
            "page_size": safe_size,
        }
    )


class ScreenerSeedManager:
    """Thread-safe batched background seeder for Screener universe enrichment."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: dict[str, Any] = self._initial_state()

    @staticmethod
    def _initial_state() -> dict[str, Any]:
        return {
            "status": "idle",
            "total": 0,
            "processed": 0,
            "succeeded": 0,
            "failed": 0,
            "current_batch": 0,
            "total_batches": 0,
            "progress_pct": 0.0,
            "started_at": None,
            "finished_at": None,
            "last_error": None,
            "failed_tickers": [],
        }

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            return sanitize_for_json(
                {**self._state, "failed_tickers": list(self._state["failed_tickers"])}
            )

    def reset_status(self) -> None:
        with self._lock:
            self._state = self._initial_state()

    def prepare_job(
        self, db: Session, req: SeedJobStartRequest
    ) -> tuple[bool, list[str], dict[str, Any]]:
        with self._lock:
            if self._state["status"] == "running":
                return False, [], sanitize_for_json(
                    {**self._state, "failed_tickers": list(self._state["failed_tickers"])}
                )

            seed_assets_metadata(db)

            q = db.query(Asset.ticker)
            if req.only_missing:
                q = q.filter(Asset.score_global.is_(None))
            q = q.order_by(Asset.ticker.asc())
            if req.limit is not None:
                q = q.limit(req.limit)
            tickers = [row[0] for row in q.all()]

            now_iso = utc_now().isoformat()
            if not tickers:
                self._state = {
                    "status": "completed",
                    "total": 0,
                    "processed": 0,
                    "succeeded": 0,
                    "failed": 0,
                    "current_batch": 0,
                    "total_batches": 0,
                    "progress_pct": 100.0,
                    "started_at": now_iso,
                    "finished_at": now_iso,
                    "last_error": None,
                    "failed_tickers": [],
                }
                return False, [], dict(self._state)

            total_batches = math.ceil(len(tickers) / req.batch_size)
            self._state = {
                "status": "running",
                "total": len(tickers),
                "processed": 0,
                "succeeded": 0,
                "failed": 0,
                "current_batch": 0,
                "total_batches": total_batches,
                "progress_pct": 0.0,
                "started_at": now_iso,
                "finished_at": None,
                "last_error": None,
                "failed_tickers": [],
            }
            return True, tickers, dict(self._state)

    def run_seed_batches(
        self,
        bind: Any,
        tickers: list[str],
        batch_size: int,
        delay_seconds: float,
        force_refresh: bool,
    ) -> None:
        session_factory = sessionmaker(autocommit=False, autoflush=False, bind=bind)
        batches = [tickers[i : i + batch_size] for i in range(0, len(tickers), batch_size)]

        try:
            for batch_idx, batch in enumerate(batches, start=1):
                with self._lock:
                    self._state["current_batch"] = batch_idx

                for sym in batch:
                    ok = False
                    err_msg: Optional[str] = None
                    try:
                        with session_factory() as db:
                            quote = market_data_service.get_quote_and_info(
                                db, sym, refresh=force_refresh
                            )
                            if quote.get("asset_type") == "ETF":
                                prices = market_data_service.get_price_history(
                                    db, sym, period="MAX", refresh=force_refresh
                                )
                                scores = score_etf(quote, prices)
                            else:
                                funds = market_data_service.get_fundamentals(
                                    db, sym, refresh=force_refresh
                                )
                                sec_avg = get_cached_sector_averages(
                                    db, quote.get("sector"), quote.get("industry"), sym
                                )
                                scores = score_equity(quote, funds, sector_averages=sec_avg)
                            persist_asset_scores(db, sym, scores)
                        ok = True
                    except Exception as exc:
                        err_msg = str(exc)
                        logger.warning("Screener seed failed for %s: %s", sym, exc)

                    with self._lock:
                        self._state["processed"] += 1
                        if ok:
                            self._state["succeeded"] += 1
                        else:
                            self._state["failed"] += 1
                            self._state["failed_tickers"].append(sym)
                            self._state["last_error"] = err_msg
                        total = max(1, self._state["total"])
                        self._state["progress_pct"] = round(
                            (self._state["processed"] / total) * 100.0, 1
                        )

                if batch_idx < len(batches) and delay_seconds > 0:
                    time.sleep(delay_seconds)

            with self._lock:
                self._state["status"] = "completed"
                self._state["progress_pct"] = 100.0
                self._state["finished_at"] = utc_now().isoformat()
        except Exception as exc:
            logger.exception("Screener seed job aborted unexpectedly")
            with self._lock:
                self._state["status"] = "error"
                self._state["last_error"] = str(exc)
                self._state["finished_at"] = utc_now().isoformat()


screener_seed_manager = ScreenerSeedManager()
