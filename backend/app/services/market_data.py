import json
import logging
import math
import threading
from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

import httpx
import numpy as np
import pandas as pd
import yfinance as yf
from sqlalchemy import case, or_
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db.models import Asset
from app.services.cache_service import _is_sqlite_session, _sqlite_write_lock, cache_service
from app.services.sec_edgar import fetch_sec_financials
from app.utils.math_utils import (
    compute_cagr,
    compute_percent_change,
    safe_float,
    safe_int,
    sanitize_for_json,
    utc_now,
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SEED_FILE = DATA_DIR / "universe_seed.json"

EEA_SUFFIXES = (
    ".PA",
    ".AS",
    ".DE",
    ".DU",
    ".MI",
    ".MC",
    ".BR",
    ".LS",
    ".HE",
    ".VI",
    ".IR",
    ".AT",
    ".CO",
    ".OL",
    ".ST",
)
NON_EEA_EU_SUFFIXES = (".SW", ".L")
KNOWN_PEA_ETFS = {
    "CW8.PA",
    "ESE.PA",
    "EWLD.PA",
    "WPEA.PA",
    "PE500.PA",
    "PAEEM.PA",
    "PANX.PA",
    "PUST.PA",
    "18MH.DU",
    "PTPXH.PA",
    "RS2K.PA",
    "PCEU.PA",
}
EU_COUNTRIES = {
    "France",
    "Germany",
    "Netherlands",
    "Italy",
    "Spain",
    "Belgium",
    "Ireland",
    "Luxembourg",
    "Finland",
    "Austria",
    "Portugal",
    "Sweden",
    "Denmark",
    "Norway",
    "Switzerland",
    "United Kingdom",
}
EEA_COUNTRIES = {
    "France",
    "Germany",
    "Netherlands",
    "Italy",
    "Spain",
    "Belgium",
    "Ireland",
    "Luxembourg",
    "Finland",
    "Austria",
    "Portugal",
    "Sweden",
    "Denmark",
    "Norway",
}

SHARE_CLASS_GROUPS = [
    {"GOOG", "GOOGL"},
    {"BRK-A", "BRK-B", "BRK.A", "BRK.B"},
    {"FOX", "FOXA"},
    {"NWS", "NWSA"},
    {"Z", "ZG"},
    {"UA", "UAA"},
]


ETF_NAME_KEYWORDS = (
    "ETF",
    "UCITS",
    "AMUNDI",
    "ISHARES",
    "VANGUARD",
    "LYXOR",
    "BNP PARIBAS EASY",
)


def normalize_ticker(ticker: str) -> str:
    return ticker.strip().upper()


def detect_asset_type(
    quote_type: Optional[str],
    name: Optional[str] = None,
    ticker: Optional[str] = None,
) -> str:
    qtype = (quote_type or "").strip().upper()
    if qtype in {"ETF", "ETP"}:
        return "ETF"
    if ticker and normalize_ticker(ticker) in KNOWN_PEA_ETFS:
        return "ETF"
    upper_name = (name or "").upper()
    if any(kw in upper_name for kw in ETF_NAME_KEYWORDS):
        return "ETF"
    return "EQUITY"


def _share_class_siblings(ticker: str) -> set[str]:
    norm = normalize_ticker(ticker)
    for group in SHARE_CLASS_GROUPS:
        if norm in group:
            return group
    return {norm}


@lru_cache
def load_universe_seed() -> list[dict[str, Any]]:
    if not SEED_FILE.exists():
        return []
    with SEED_FILE.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache
def _seed_by_ticker() -> dict[str, dict[str, Any]]:
    return {normalize_ticker(item["ticker"]): item for item in load_universe_seed()}


def seed_assets_metadata(db: Session) -> int:
    """Populate missing seed metadata in `assets` without making network calls."""
    seed_items = load_universe_seed()
    if not seed_items:
        return 0
    existing = {row[0] for row in db.query(Asset.ticker).all()}
    added = 0
    for item in seed_items:
        sym = normalize_ticker(item["ticker"])
        if sym in existing:
            continue
        db.add(
            Asset(
                ticker=sym,
                name=item.get("name") or sym,
                asset_type=item.get("asset_type") or "EQUITY",
                region=item.get("region") or "US",
                pea_eligible=bool(item.get("pea_eligible", False)),
                sector=item.get("sector"),
                industry=item.get("industry"),
            )
        )
        added += 1
    if added:
        db.commit()
    return added


def infer_region_and_pea(
    ticker: str,
    country: Optional[str],
    exchange: Optional[str],
    asset_type: str,
) -> tuple[str, bool]:
    sym = normalize_ticker(ticker)
    seed_item = _seed_by_ticker().get(sym)
    if seed_item:
        return seed_item.get("region", "US"), bool(seed_item.get("pea_eligible", False))

    if any(sym.endswith(suf) for suf in EEA_SUFFIXES):
        if asset_type == "ETF":
            return "EU", sym in KNOWN_PEA_ETFS
        return "EU", True

    if any(sym.endswith(suf) for suf in NON_EEA_EU_SUFFIXES):
        return "EU", False

    if country in EEA_COUNTRIES:
        return "EU", asset_type == "EQUITY"
    if country in EU_COUNTRIES:
        return "EU", False

    if "." in sym and not sym.endswith((".US",)):
        # Other non-US suffix (e.g. .TO, .T, .HK, .AX)
        return "OTHER", False

    return "US", False


_SUFFIX_TO_COUNTRY: dict[str, str] = {
    ".PA": "France",
    ".DE": "Germany",
    ".DU": "Germany",
    ".AS": "Netherlands",
    ".MI": "Italy",
    ".MC": "Spain",
    ".BR": "Belgium",
    ".LS": "Portugal",
    ".HE": "Finland",
    ".VI": "Austria",
    ".IR": "Ireland",
    ".CO": "Denmark",
    ".OL": "Norway",
    ".ST": "Sweden",
    ".SW": "Switzerland",
    ".L": "United Kingdom",
    ".T": "Japan",
    ".HK": "Hong Kong",
    ".TO": "Canada",
    ".AX": "Australia",
}


def _infer_country_from_ticker(ticker: str, region: Optional[str] = None) -> Optional[str]:
    sym = normalize_ticker(ticker)
    for suf, country in _SUFFIX_TO_COUNTRY.items():
        if sym.endswith(suf):
            return country
    if region == "US" or ("." not in sym and region != "OTHER"):
        return "United States"
    if region == "EU":
        return "Europe"
    return None


_FINNHUB_INDUSTRY_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("semiconductor", "software", "technology", "hardware", "it services", "electronic", "cyber"), "Technology"),
    (("health", "biotech", "pharma", "medical", "life sciences", "drug"), "Healthcare"),
    (("bank", "financ", "insurance", "capital market", "credit", "asset management", "fintech"), "Financial Services"),
    (("telecom", "media", "communication", "entertainment", "interactive"), "Communication Services"),
    (("auto", "luxury", "retail", "apparel", "hotel", "restaurant", "leisure", "consumer cyclical"), "Consumer Cyclical"),
    (("food", "beverage", "tobacco", "household", "personal products", "consumer defensive"), "Consumer Defensive"),
    (("aerospace", "defense", "industrial", "machinery", "construction", "logistics", "transport", "airlines", "electrical"), "Industrials"),
    (("oil", "gas", "energy", "petroleum"), "Energy"),
    (("chemical", "mining", "metal", "steel", "materials", "paper", "forest"), "Basic Materials"),
    (("utilit", "electric", "water", "power"), "Utilities"),
    (("real estate", "reit"), "Real Estate"),
)


def _map_industry_to_sector(industry: Optional[str]) -> Optional[str]:
    if not industry:
        return None
    low = str(industry).strip().lower()
    if not low:
        return None
    for keywords, sector in _FINNHUB_INDUSTRY_KEYWORDS:
        if any(kw in low for kw in keywords):
            return sector
    return None


_KNOWN_BRAND_DOMAINS: tuple[tuple[str, str], ...] = (
    ("amundi", "amundietf.fr"),
    ("am. etf", "amundietf.fr"),
    ("lyxor", "amundietf.fr"),
    ("bnp paribas", "bnpparibas-am.com"),
    ("ishares", "ishares.com"),
    ("blackrock", "ishares.com"),
    ("vanguard", "vanguard.com"),
    ("invesco", "invesco.com"),
    ("xtrackers", "etf.dws.com"),
    ("spdr", "ssga.com"),
    ("wisdomtree", "wisdomtree.eu"),
    ("vaneck", "vaneck.com"),
    ("nvidia", "nvidia.com"),
    ("zscaler", "zscaler.com"),
    ("eli lilly", "lilly.com"),
    ("apple", "apple.com"),
    ("microsoft", "microsoft.com"),
    ("alphabet", "abc.xyz"),
    ("amazon", "amazon.com"),
    ("meta platforms", "meta.com"),
    ("tesla", "tesla.com"),
    ("lvmh", "lvmh.com"),
    ("asml", "asml.com"),
    ("totalenergies", "totalenergies.com"),
)

_KNOWN_TICKER_DOMAINS: dict[str, str] = {
    "PUST.PA": "amundietf.fr",
    "18MH.DU": "amundietf.fr",
    "CW8.PA": "amundietf.fr",
    "PAEEM.PA": "amundietf.fr",
    "PE500.PA": "amundietf.fr",
    "PANX.PA": "amundietf.fr",
    "EWLD.PA": "amundietf.fr",
    "ESE.PA": "bnpparibas-am.com",
    "WPEA.PA": "ishares.com",
}


def build_logo_url(
    ticker: str,
    finnhub_logo: Optional[str] = None,
    website: Optional[str] = None,
    name: Optional[str] = None,
) -> Optional[str]:
    if finnhub_logo and isinstance(finnhub_logo, str) and finnhub_logo.startswith(("http://", "https://")):
        return finnhub_logo
    if website and isinstance(website, str):
        url = website.strip()
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        if domain:
            return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
    lower_name = (name or "").strip().lower()
    for keyword, domain in _KNOWN_BRAND_DOMAINS:
        if keyword in lower_name:
            return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
    ticker_domain = _KNOWN_TICKER_DOMAINS.get(normalize_ticker(ticker))
    if ticker_domain:
        return f"https://www.google.com/s2/favicons?domain={ticker_domain}&sz=128"
    return None


def _col_to_date_str(col: Any) -> str:
    if isinstance(col, pd.Timestamp):
        return col.strftime("%Y-%m-%d")
    if isinstance(col, datetime):
        return col.strftime("%Y-%m-%d")
    return str(col)[:10]


def extract_row_series(df: Optional[pd.DataFrame], candidate_names: list[str]) -> dict[str, float]:
    """Safely extract a row from a yfinance financial statement DataFrame keyed by YYYY-MM-DD."""
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return {}

    index_map = {str(idx).strip().lower(): idx for idx in df.index}
    matched_idx = None
    for name in candidate_names:
        key = name.strip().lower()
        if key in index_map:
            matched_idx = index_map[key]
            break

    if matched_idx is None:
        return {}

    row = df.loc[matched_idx]
    if isinstance(row, pd.DataFrame):
        row = row.iloc[0]

    result: dict[str, float] = {}
    for col, raw_val in row.items():
        val = safe_float(raw_val)
        if val is not None:
            result[_col_to_date_str(col)] = val
    return result


_fmp_lock = threading.Lock()
_fmp_blocked_until: Optional[datetime] = None

_bg_lock = threading.Lock()
_bg_inflight: set[str] = set()


class MarketDataService:
    """Multi-source market data aggregator with DB-backed multi-TTL caching."""

    def _schedule_bg_refresh(
        self,
        db: Session,
        task_key: str,
        worker_fn: Callable[[Session], None],
    ) -> None:
        """Run a background cache refresh in a daemon thread (skipped on StaticPool tests)."""
        try:
            bind = db.get_bind()
        except Exception:
            return
        if bind is None or isinstance(getattr(bind, "pool", None), StaticPool):
            return

        with _bg_lock:
            if task_key in _bg_inflight:
                return
            _bg_inflight.add(task_key)

        session_factory = sessionmaker(autocommit=False, autoflush=False, bind=bind)

        def _run() -> None:
            try:
                with session_factory() as bg_db:
                    worker_fn(bg_db)
            except Exception as exc:
                logger.debug("Background SWR refresh failed for %s: %s", task_key, exc)
            finally:
                with _bg_lock:
                    _bg_inflight.discard(task_key)

        threading.Thread(target=_run, daemon=True).start()

    def is_fmp_rate_limited(self) -> bool:
        global _fmp_blocked_until
        with _fmp_lock:
            if _fmp_blocked_until is None:
                return False
            if utc_now() >= _fmp_blocked_until:
                _fmp_blocked_until = None
                return False
            return True

    def fmp_rate_limit_remaining_minutes(self) -> int:
        with _fmp_lock:
            if _fmp_blocked_until is None:
                return 0
            remaining_sec = (_fmp_blocked_until - utc_now()).total_seconds()
            if remaining_sec <= 0:
                return 0
            return int(math.ceil(remaining_sec / 60.0))

    def mark_fmp_rate_limited(self, hours: float = 2.0) -> None:
        global _fmp_blocked_until
        with _fmp_lock:
            _fmp_blocked_until = utc_now() + timedelta(hours=hours)

    def reset_fmp_rate_limit(self) -> None:
        global _fmp_blocked_until
        with _fmp_lock:
            _fmp_blocked_until = None

    def _finnhub_get(self, path: str, params: Optional[dict[str, Any]] = None) -> Optional[Any]:
        settings = get_settings()
        if not settings.FINNHUB_API_KEY:
            return None
        query = dict(params or {})
        query["token"] = settings.FINNHUB_API_KEY
        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.get(f"https://finnhub.io/api/v1{path}", params=query)
                if resp.status_code != 200:
                    logger.warning("Finnhub %s returned %s", path, resp.status_code)
                    return None
                return resp.json()
        except Exception as exc:
            logger.warning("Finnhub request failed for %s: %s", path, exc)
            return None

    def _fetch_yf_search_name(self, sym: str) -> Optional[str]:
        """Fallback lightweight Yahoo Search lookup when quoteSummary/info is unavailable."""
        norm = normalize_ticker(sym)
        if not norm:
            return None
        try:
            with httpx.Client(timeout=4.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
                resp = client.get(
                    "https://query1.finance.yahoo.com/v1/finance/search",
                    params={"q": norm, "quotesCount": 5, "newsCount": 0},
                )
                if resp.status_code != 200:
                    return None
                quotes = (resp.json() or {}).get("quotes") or []
                for entry in quotes:
                    if normalize_ticker(str(entry.get("symbol") or "")) == norm:
                        candidate = str(entry.get("longname") or entry.get("shortname") or "").strip()
                        if candidate and candidate.upper() != norm:
                            return candidate[:255]
                for entry in quotes:
                    candidate = str(entry.get("longname") or entry.get("shortname") or "").strip()
                    if candidate and candidate.upper() != norm:
                        return candidate[:255]
        except Exception:
            return None
        return None

    def _resolve_quote_name(
        self,
        db: Session,
        sym: str,
        initial_name: Optional[str],
        fh_name: Optional[str] = None,
    ) -> str:
        """Resolve a non-ticker display name via info -> Finnhub -> DB Asset -> seed -> Yahoo Search."""
        for candidate in (initial_name, fh_name):
            cleaned = str(candidate or "").strip()
            if cleaned and cleaned.upper() != sym:
                return cleaned[:255]

        existing_asset = db.get(Asset, sym)
        if existing_asset and existing_asset.name and existing_asset.name.strip().upper() != sym:
            return existing_asset.name.strip()[:255]

        seed_item = _seed_by_ticker().get(sym)
        if seed_item and seed_item.get("name"):
            seed_name = str(seed_item["name"]).strip()
            if seed_name and seed_name.upper() != sym:
                return seed_name[:255]

        searched = self._fetch_yf_search_name(sym)
        if searched:
            return searched

        return sym

    def _resolve_sector_and_industry(
        self,
        db: Session,
        sym: str,
        asset_type: str,
        sector: Optional[str],
        industry: Optional[str],
        fh_industry: Optional[str] = None,
    ) -> tuple[Optional[str], Optional[str]]:
        cur_industry = str(industry or fh_industry or "").strip() or None
        if asset_type == "ETF":
            return "ETF", cur_industry

        cur_sector = str(sector or "").strip() or None
        invalid_sectors = {"ETF", "AUTRE", "OTHER", "UNKNOWN", "N/A"}
        missing_sector = cur_sector is None or cur_sector.upper() in invalid_sectors

        if missing_sector or not cur_industry:
            existing_asset = db.get(Asset, sym)
            if existing_asset:
                if missing_sector and existing_asset.sector and existing_asset.sector.strip().upper() not in invalid_sectors:
                    cur_sector = existing_asset.sector.strip()
                    missing_sector = False
                if not cur_industry and existing_asset.industry:
                    cur_industry = existing_asset.industry.strip()

        if missing_sector or not cur_industry:
            seed_item = _seed_by_ticker().get(sym)
            if seed_item:
                if missing_sector and seed_item.get("sector"):
                    cur_sector = str(seed_item["sector"]).strip()
                    missing_sector = False
                if not cur_industry and seed_item.get("industry"):
                    cur_industry = str(seed_item["industry"]).strip()

        if missing_sector and cur_industry:
            mapped = _map_industry_to_sector(cur_industry)
            if mapped:
                cur_sector = mapped

        return cur_sector, cur_industry

    def _fmp_get(self, url_or_path: str, params: Optional[dict[str, Any]] = None) -> Optional[Any]:
        settings = get_settings()
        if not settings.FMP_API_KEY:
            return None
        if self.is_fmp_rate_limited():
            return None
        query = dict(params or {})
        query["apikey"] = settings.FMP_API_KEY
        url = (
            url_or_path
            if url_or_path.startswith("http")
            else f"https://financialmodelingprep.com{url_or_path}"
        )
        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.get(url, params=query)
                if resp.status_code == 429:
                    self.mark_fmp_rate_limited(hours=2.0)
                    logger.warning("FMP %s returned 429 (quota exhausted); pausing FMP calls for 2h", url_or_path)
                    return None
                if resp.status_code != 200:
                    logger.warning("FMP %s returned %s", url_or_path, resp.status_code)
                    return None
                data = resp.json()
                if isinstance(data, dict) and data.get("Error Message"):
                    return None
                return data
        except Exception as exc:
            logger.warning("FMP request failed for %s: %s", url_or_path, exc)
            return None

    def get_eurusd_rate(self, db: Session, refresh: bool = False) -> dict[str, Any]:
        cache_key = "fx:EURUSD"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = dict(cached.payload)
                payload["updated_at"] = cached.updated_at.isoformat()
                payload["is_stale"] = cached.is_stale
                return payload
            stale = cache_service.get(db, cache_key, allow_stale=True)
            if stale is not None and stale.age_seconds <= 86400:
                payload = dict(stale.payload)
                payload["updated_at"] = stale.updated_at.isoformat()
                payload["is_stale"] = True
                self._schedule_bg_refresh(
                    db,
                    cache_key,
                    lambda bg_db: self.get_eurusd_rate(bg_db, refresh=True),
                )
                return payload

        rate: Optional[float] = None
        try:
            tk = yf.Ticker("EURUSD=X")
            try:
                rate = safe_float(getattr(tk.fast_info, "last_price", None))
            except Exception:
                rate = None
            if rate is None or rate <= 0:
                hist = tk.history(period="5d")
                if hist is not None and not hist.empty and "Close" in hist.columns:
                    closes = hist["Close"].dropna()
                    if not closes.empty:
                        rate = safe_float(closes.iloc[-1])
        except Exception as exc:
            logger.warning("Failed to fetch EURUSD=X: %s", exc)

        if rate is not None and rate > 0:
            payload = {"pair": "EURUSD", "rate": round(rate, 6), "fallback": False}
            updated_at = cache_service.set(db, cache_key, "fx", payload)
            return {
                **payload,
                "updated_at": updated_at.isoformat(),
                "is_stale": False,
            }

        stale = cache_service.get(db, cache_key, allow_stale=True)
        if stale is not None:
            payload = dict(stale.payload)
            payload["updated_at"] = stale.updated_at.isoformat()
            payload["is_stale"] = True
            return payload

        return {
            "pair": "EURUSD",
            "rate": 1.08,
            "fallback": True,
            "updated_at": utc_now().isoformat(),
            "is_stale": True,
        }

    _FX_FALLBACK_TO_EUR: dict[str, float] = {
        "EUR": 1.0,
        "GBP": 1.18,
        "CHF": 1.06,
        "DKK": 0.134,
        "SEK": 0.087,
        "NOK": 0.085,
        "JPY": 0.0061,
        "CAD": 0.66,
        "HKD": 0.119,
        "AUD": 0.60,
        "PLN": 0.232,
        "TWD": 0.029,
        "KRW": 0.00067,
        "INR": 0.011,
        "BRL": 0.16,
        "ZAR": 0.052,
        "ILS": 0.25,
    }

    @staticmethod
    def _normalize_fx_currency(currency: Optional[str]) -> tuple[str, float]:
        raw = (currency or "EUR").strip()
        if raw in {"GBp", "GBX"}:
            return "GBP", 0.01
        if raw in {"ZAc", "ZAC"}:
            return "ZAR", 0.01
        if raw in {"ILa", "ILA"}:
            return "ILS", 0.01
        upper = raw.upper()
        return upper or "EUR", 1.0

    @staticmethod
    def _fetch_yf_pair_rate(pair_symbol: str) -> Optional[float]:
        try:
            tk = yf.Ticker(pair_symbol)
            rate = None
            try:
                rate = safe_float(getattr(tk.fast_info, "last_price", None))
            except Exception:
                rate = None
            if rate is None or rate <= 0:
                hist = tk.history(period="5d")
                if hist is not None and not hist.empty and "Close" in hist.columns:
                    closes = hist["Close"].dropna()
                    if not closes.empty:
                        rate = safe_float(closes.iloc[-1])
            return rate if (rate is not None and rate > 0) else None
        except Exception:
            return None

    def get_fx_rate(
        self,
        db: Session,
        from_currency: str,
        to_currency: str = "EUR",
        refresh: bool = False,
    ) -> dict[str, Any]:
        src, subunit_scale = self._normalize_fx_currency(from_currency)
        dst, dst_scale = self._normalize_fx_currency(to_currency)
        effective_scale = subunit_scale / (dst_scale or 1.0)
        pair_label = f"{(from_currency or 'EUR').strip()}{dst}"

        if src == dst:
            return {
                "pair": pair_label,
                "rate": round(effective_scale, 8),
                "fallback": False,
                "updated_at": utc_now().isoformat(),
                "is_stale": False,
            }

        if {src, dst} == {"EUR", "USD"}:
            eu = self.get_eurusd_rate(db, refresh=refresh)
            eu_rate = safe_float(eu.get("rate")) or 1.08
            conv = eu_rate if src == "EUR" else (1.0 / eu_rate if eu_rate > 0 else 1.0 / 1.08)
            return {
                "pair": pair_label,
                "rate": round(conv * effective_scale, 8),
                "fallback": bool(eu.get("fallback", False)),
                "updated_at": eu.get("updated_at") or utc_now().isoformat(),
                "is_stale": bool(eu.get("is_stale", False)),
            }

        cache_key = f"fx:{src}{dst}"
        base_rate: Optional[float] = None
        fallback_used = False
        is_stale = False
        updated_at_iso = utc_now().isoformat()

        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                cached_r = safe_float((cached.payload or {}).get("rate"))
                if cached_r and cached_r > 0:
                    return {
                        "pair": pair_label,
                        "rate": round(cached_r * effective_scale, 8),
                        "fallback": bool((cached.payload or {}).get("fallback", False)),
                        "updated_at": cached.updated_at.isoformat(),
                        "is_stale": cached.is_stale,
                    }

        base_rate = self._fetch_yf_pair_rate(f"{src}{dst}=X")
        if base_rate is None:
            inv = self._fetch_yf_pair_rate(f"{dst}{src}=X")
            if inv is not None and inv > 0:
                base_rate = 1.0 / inv

        if base_rate is not None and base_rate > 0:
            payload = {"pair": f"{src}{dst}", "rate": round(base_rate, 8), "fallback": False}
            updated_at = cache_service.set(db, cache_key, "fx", payload)
            return {
                "pair": pair_label,
                "rate": round(base_rate * effective_scale, 8),
                "fallback": False,
                "updated_at": updated_at.isoformat(),
                "is_stale": False,
            }

        stale = cache_service.get(db, cache_key, allow_stale=True)
        if stale is not None:
            stale_r = safe_float((stale.payload or {}).get("rate"))
            if stale_r and stale_r > 0:
                return {
                    "pair": pair_label,
                    "rate": round(stale_r * effective_scale, 8),
                    "fallback": bool((stale.payload or {}).get("fallback", False)),
                    "updated_at": stale.updated_at.isoformat(),
                    "is_stale": True,
                }

        # Fallback through static EUR anchor
        fallback_used = True
        is_stale = True
        if dst == "EUR":
            fb = self._FX_FALLBACK_TO_EUR.get(src, 1.0)
        elif src == "EUR" and dst in self._FX_FALLBACK_TO_EUR:
            fb = 1.0 / self._FX_FALLBACK_TO_EUR[dst]
        elif dst == "USD":
            eu_rate = safe_float(self.get_eurusd_rate(db).get("rate")) or 1.08
            src_eur = 1.0 / eu_rate if src == "USD" else self._FX_FALLBACK_TO_EUR.get(src, 1.0)
            fb = src_eur * eu_rate
        else:
            src_eur = self._FX_FALLBACK_TO_EUR.get(src, 1.0)
            dst_eur = self._FX_FALLBACK_TO_EUR.get(dst, 1.0)
            fb = src_eur / dst_eur if dst_eur > 0 else 1.0

        return {
            "pair": pair_label,
            "rate": round(fb * effective_scale, 8),
            "fallback": fallback_used,
            "updated_at": updated_at_iso,
            "is_stale": is_stale,
        }

    def _compute_eur_estimate_fields(
        self,
        db: Session,
        currency: Optional[str],
        price: Optional[float],
    ) -> tuple[Optional[float], Optional[float]]:
        cur_raw = (currency or "USD").strip()
        cur_upper = cur_raw.upper()
        if cur_raw == "EUR" or cur_upper == "EUR":
            fx_to_eur = 1.0
        elif cur_upper == "USD":
            eurusd = safe_float(self.get_eurusd_rate(db).get("rate")) or 1.08
            fx_to_eur = round(1.0 / eurusd, 6) if eurusd > 0 else None
        else:
            fx_res = self.get_fx_rate(db, cur_raw, "EUR")
            fx_to_eur = safe_float(fx_res.get("rate"))
        price_eur = (
            round(float(price) * float(fx_to_eur), 2)
            if (price is not None and fx_to_eur is not None and fx_to_eur > 0)
            else None
        )
        return fx_to_eur, price_eur

    def search_assets(self, db: Session, query: str, limit: int = 12) -> list[dict[str, Any]]:
        q = query.strip()
        if not q:
            rows = (
                db.query(Asset)
                .order_by(Asset.market_cap.desc().nullslast(), Asset.ticker.asc())
                .limit(limit)
                .all()
            )
            if not rows:
                seed_assets_metadata(db)
                rows = db.query(Asset).limit(limit).all()
            return [self._asset_to_search_item(row) for row in rows]

        q_upper = q.upper()
        pattern = f"%{q}%"
        prefix_pattern = f"{q_upper}%"

        rank_expr = case(
            (Asset.ticker == q_upper, 0),
            (Asset.ticker.ilike(prefix_pattern), 1),
            (Asset.name.ilike(f"{q}%"), 2),
            else_=3,
        )
        local_rows = (
            db.query(Asset)
            .filter(or_(Asset.ticker.ilike(pattern), Asset.name.ilike(pattern)))
            .order_by(rank_expr, Asset.market_cap.desc().nullslast(), Asset.ticker.asc())
            .limit(limit)
            .all()
        )
        results = [self._asset_to_search_item(r) for r in local_rows]
        seen = {item["ticker"] for item in results}

        # Supplement from universe_seed.json if DB wasn't seeded yet
        if len(results) < limit:
            for item in load_universe_seed():
                sym = normalize_ticker(item["ticker"])
                if sym in seen:
                    continue
                if q_upper in sym or q.lower() in (item.get("name") or "").lower():
                    results.append(
                        {
                            "ticker": sym,
                            "name": item.get("name") or sym,
                            "asset_type": item.get("asset_type") or "EQUITY",
                            "exchange": None,
                            "region": item.get("region") or "US",
                            "pea_eligible": bool(item.get("pea_eligible", False)),
                            "sector": item.get("sector"),
                            "industry": item.get("industry"),
                            "logo_url": None,
                            "price": None,
                            "score_global": None,
                        }
                    )
                    seen.add(sym)
                if len(results) >= limit:
                    break

        # Remote fallback if few local matches
        if len(results) < limit and len(q) >= 2:
            remote_items: list[dict[str, Any]] = []

            fh_data = self._finnhub_get("/search", {"q": q})
            if isinstance(fh_data, dict) and isinstance(fh_data.get("result"), list):
                for entry in fh_data["result"]:
                    sym = normalize_ticker(str(entry.get("symbol") or ""))
                    qtype = str(entry.get("type") or "").upper()
                    if not sym or sym in seen:
                        continue
                    if qtype and qtype not in {"COMMON STOCK", "ETP", "ETF", "ADR", "EQUITY", "MUTUALFUND"}:
                        continue
                    name_desc = entry.get("description") or sym
                    asset_type = detect_asset_type(qtype, name_desc, sym)
                    region, pea = infer_region_and_pea(sym, None, None, asset_type)
                    remote_items.append(
                        {
                            "ticker": sym,
                            "name": name_desc,
                            "asset_type": asset_type,
                            "exchange": None,
                            "region": region,
                            "pea_eligible": pea,
                            "sector": None,
                            "industry": None,
                            "logo_url": None,
                            "price": None,
                            "score_global": None,
                        }
                    )

            if len(results) + len(remote_items) < limit:
                try:
                    yf_search = yf.Search(q, max_results=limit)
                    quotes = getattr(yf_search, "quotes", None) or []
                    for entry in quotes:
                        sym = normalize_ticker(str(entry.get("symbol") or ""))
                        qtype = str(entry.get("quoteType") or "").upper()
                        disp_name = entry.get("shortname") or entry.get("longname") or sym
                        asset_type = detect_asset_type(qtype, disp_name, sym)
                        if not sym or sym in seen:
                            continue
                        if qtype not in {"EQUITY", "ETF", "ETP"} and asset_type != "ETF":
                            continue
                        exch = entry.get("exchange") or entry.get("exchDisp")
                        region, pea = infer_region_and_pea(sym, None, exch, asset_type)
                        remote_items.append(
                            {
                                "ticker": sym,
                                "name": disp_name,
                                "asset_type": asset_type,
                                "exchange": exch,
                                "region": region,
                                "pea_eligible": pea,
                                "sector": entry.get("sector"),
                                "industry": entry.get("industry"),
                                "logo_url": None,
                                "price": None,
                                "score_global": None,
                            }
                        )
                except Exception as exc:
                    logger.debug("yfinance Search fallback failed for %s: %s", q, exc)

            if remote_items:
                for item in remote_items:
                    sym = item["ticker"]
                    if sym in seen:
                        continue
                    seen.add(sym)
                    results.append(item)
                    if db.get(Asset, sym) is None:
                        db.add(
                            Asset(
                                ticker=sym,
                                name=item["name"][:255],
                                asset_type=item["asset_type"],
                                exchange=item["exchange"],
                                region=item["region"],
                                pea_eligible=item["pea_eligible"],
                                sector=item["sector"],
                                industry=item["industry"],
                            )
                        )
                    if len(results) >= limit:
                        break
                try:
                    db.commit()
                except Exception:
                    db.rollback()

        return results[:limit]

    @staticmethod
    def _asset_to_search_item(asset: Asset) -> dict[str, Any]:
        return {
            "ticker": asset.ticker,
            "name": asset.name,
            "asset_type": asset.asset_type,
            "exchange": asset.exchange,
            "region": asset.region,
            "pea_eligible": asset.pea_eligible,
            "sector": asset.sector,
            "industry": asset.industry,
            "logo_url": asset.logo_url,
            "price": asset.price,
            "score_global": asset.score_global,
        }

    @staticmethod
    def _compute_days_until_earnings(next_earnings_date: Optional[str]) -> Optional[int]:
        if not next_earnings_date:
            return None
        try:
            target = date.fromisoformat(str(next_earnings_date)[:10])
            days = (target - utc_now().date()).days
            return days if days >= 0 else None
        except Exception:
            return None

    def _extract_next_earnings_date(
        self,
        sym: str,
        tk: Any,
        info: dict[str, Any],
        asset_type: str,
    ) -> Optional[str]:
        if asset_type == "ETF":
            return None

        today = utc_now().date()
        candidates: list[date] = []

        def _push_candidate(raw_val: Any) -> None:
            if raw_val is None:
                return
            if isinstance(raw_val, (list, tuple)):
                for item in raw_val:
                    _push_candidate(item)
                return
            if isinstance(raw_val, (int, float)) and not isinstance(raw_val, bool):
                if raw_val > 1_000_000_000:
                    try:
                        candidates.append(datetime.fromtimestamp(float(raw_val), tz=timezone.utc).date())
                    except Exception:
                        pass
                return
            if isinstance(raw_val, datetime):
                candidates.append(raw_val.date())
                return
            if isinstance(raw_val, date):
                candidates.append(raw_val)
                return
            if isinstance(raw_val, pd.Timestamp):
                candidates.append(raw_val.date())
                return
            txt = str(raw_val).strip()[:10]
            if len(txt) == 10 and txt[4] == "-" and txt[7] == "-":
                try:
                    candidates.append(date.fromisoformat(txt))
                except Exception:
                    pass

        for ts_key in ("earningsTimestampStart", "earningsTimestamp", "earningsTimestampEnd"):
            _push_candidate(info.get(ts_key))

        future_dates = sorted(d for d in candidates if d >= today)
        if future_dates:
            return future_dates[0].isoformat()

        try:
            cal = getattr(tk, "calendar", None)
            if isinstance(cal, dict):
                _push_candidate(cal.get("Earnings Date") or cal.get("earningsDate"))
            elif isinstance(cal, pd.DataFrame) and not cal.empty:
                for idx in cal.index:
                    if "earning" in str(idx).lower():
                        _push_candidate(list(cal.loc[idx].values))
        except Exception:
            pass

        future_dates = sorted(d for d in candidates if d >= today)
        if future_dates:
            return future_dates[0].isoformat()

        fh_cal = self._finnhub_get(
            "/calendar/earnings",
            {
                "from": today.isoformat(),
                "to": (today + timedelta(days=120)).isoformat(),
                "symbol": sym,
            },
        )
        if isinstance(fh_cal, dict):
            for entry in fh_cal.get("earningsCalendar") or []:
                if isinstance(entry, dict):
                    _push_candidate(entry.get("date"))

        future_dates = sorted(d for d in candidates if d >= today)
        return future_dates[0].isoformat() if future_dates else None

    def _compute_52w_from_prices_payload(
        self, db: Session, sym: str
    ) -> tuple[Optional[float], Optional[float]]:
        cached_px = cache_service.get(db, f"prices:{sym}:MAX", allow_stale=True)
        if cached_px is None or not isinstance(cached_px.payload, dict):
            return None, None
        pts = cached_px.payload.get("points") or []
        if not pts:
            return None, None
        cutoff = (utc_now().date() - timedelta(days=365)).isoformat()
        highs: list[float] = []
        lows: list[float] = []
        for pt in pts:
            dt = str(pt.get("date") or "")[:10]
            if dt and dt < cutoff:
                continue
            hi = safe_float(pt.get("high")) or safe_float(pt.get("close"))
            lo = safe_float(pt.get("low")) or safe_float(pt.get("close"))
            if hi is not None and hi > 0:
                highs.append(hi)
            if lo is not None and lo > 0:
                lows.append(lo)
        return (round(max(highs), 4) if highs else None), (round(min(lows), 4) if lows else None)

    def _compute_forward_pe_from_analysts_cache(
        self, db: Session, sym: str, price: Optional[float]
    ) -> Optional[float]:
        if price is None or price <= 0:
            return None
        cached_an = cache_service.get(db, f"analysts:{sym}", allow_stale=True)
        if cached_an is None or not isinstance(cached_an.payload, dict):
            return None
        future_eps = [
            safe_float(item.get("avg"))
            for item in (cached_an.payload.get("eps_forecasts") or [])
            if not item.get("is_actual")
        ]
        future_eps = [v for v in future_eps if v is not None and v > 0]
        if not future_eps:
            return None
        target_eps = future_eps[1] if len(future_eps) >= 2 else future_eps[0]
        return round(price / target_eps, 2)

    @staticmethod
    def _extract_finnhub_metric_fallbacks(metric: dict[str, Any]) -> dict[str, Optional[float]]:
        def _pct_to_dec(val: Any) -> Optional[float]:
            v = safe_float(val)
            return round(v / 100.0, 6) if v is not None else None

        return {
            "pe": safe_float(metric.get("peTTM")) or safe_float(metric.get("peExclExtraTTM")),
            "forward_pe": safe_float(metric.get("forwardPE")),
            "fifty_two_week_high": safe_float(metric.get("52WeekHigh")),
            "fifty_two_week_low": safe_float(metric.get("52WeekLow")),
            "gross_margin": _pct_to_dec(metric.get("grossMarginTTM")),
            "op_margin": _pct_to_dec(metric.get("operatingMarginTTM")),
            "net_margin": _pct_to_dec(metric.get("netProfitMarginTTM")),
            "roe": _pct_to_dec(metric.get("roeTTM")),
        }

    def _repair_cached_quote_payload(self, db: Session, sym: str, payload: dict[str, Any], *, persist: bool = True) -> dict[str, Any]:
        repaired = False
        cur_name = str(payload.get("name") or "").strip()
        resolved_name = self._resolve_quote_name(db, sym, cur_name)
        if resolved_name != cur_name:
            payload["name"] = resolved_name
            repaired = True

        cur_logo = str(payload.get("logo_url") or "")
        if not cur_logo or "easy.bnpparibas.fr" in cur_logo:
            new_logo = build_logo_url(
                sym,
                website=payload.get("website"),
                name=payload.get("name"),
            )
            if new_logo and new_logo != cur_logo:
                payload["logo_url"] = new_logo
                repaired = True

        seed_item = _seed_by_ticker().get(sym)
        if seed_item:
            seed_region = seed_item.get("region")
            seed_pea = bool(seed_item.get("pea_eligible", False))
            if seed_region and payload.get("region") != seed_region:
                payload["region"] = seed_region
                repaired = True
            if bool(payload.get("pea_eligible", False)) != seed_pea:
                payload["pea_eligible"] = seed_pea
                repaired = True

        detected = detect_asset_type(payload.get("asset_type"), payload.get("name"), sym)
        if payload.get("asset_type") != detected:
            repaired = True
        payload["asset_type"] = detected

        if not payload.get("country"):
            inferred_country = _infer_country_from_ticker(sym, payload.get("region"))
            if inferred_country:
                payload["country"] = inferred_country
                repaired = True

        if detected == "ETF":
            if payload.get("sector") != "ETF":
                payload["sector"] = "ETF"
                repaired = True
            payload["next_earnings_date"] = None
            payload["days_until_earnings"] = None
        else:
            resolved_sec, resolved_ind = self._resolve_sector_and_industry(
                db,
                sym,
                detected,
                payload.get("sector"),
                payload.get("industry"),
            )
            if resolved_sec and resolved_sec != payload.get("sector"):
                payload["sector"] = resolved_sec
                repaired = True
            if resolved_ind and resolved_ind != payload.get("industry"):
                payload["industry"] = resolved_ind
                repaired = True
            days = self._compute_days_until_earnings(payload.get("next_earnings_date"))
            if days is None:
                payload["next_earnings_date"] = None
            payload["days_until_earnings"] = days

            if payload.get("pe") is None or payload.get("forward_pe") is None:
                existing_asset = db.get(Asset, sym)
                if existing_asset is not None:
                    if payload.get("pe") is None and existing_asset.pe is not None:
                        payload["pe"] = existing_asset.pe
                        repaired = True
                    if payload.get("forward_pe") is None and existing_asset.forward_pe is not None:
                        payload["forward_pe"] = existing_asset.forward_pe
                        repaired = True

            if payload.get("forward_pe") is None:
                est_fpe = self._compute_forward_pe_from_analysts_cache(
                    db, sym, safe_float(payload.get("price"))
                )
                if est_fpe is not None:
                    payload["forward_pe"] = est_fpe
                    repaired = True

        if payload.get("fifty_two_week_high") is None or payload.get("fifty_two_week_low") is None:
            px_h52, px_l52 = self._compute_52w_from_prices_payload(db, sym)
            if payload.get("fifty_two_week_high") is None and px_h52 is not None:
                payload["fifty_two_week_high"] = px_h52
                repaired = True
            if payload.get("fifty_two_week_low") is None and px_l52 is not None:
                payload["fifty_two_week_low"] = px_l52
                repaired = True

        if (
            persist
            and detected != "ETF"
            and (
                payload.get("forward_pe") is None
                or payload.get("pe") is None
                or payload.get("fifty_two_week_high") is None
            )
        ):
            fh_m = self._finnhub_get("/stock/metric", {"symbol": sym, "metric": "all"})
            metric = (fh_m or {}).get("metric") if isinstance(fh_m, dict) else None
            if isinstance(metric, dict) and metric:
                fb = self._extract_finnhub_metric_fallbacks(metric)
                for k, v in fb.items():
                    if payload.get(k) is None and v is not None:
                        payload[k] = v
                        repaired = True

        if payload.get("fx_to_eur_rate") is None or payload.get("price_eur") is None:
            fx_eur, px_eur = self._compute_eur_estimate_fields(
                db, payload.get("currency"), safe_float(payload.get("price"))
            )
            payload["fx_to_eur_rate"] = fx_eur
            payload["price_eur"] = px_eur

        if persist and repaired:
            try:
                cache_service.set(db, f"quote:{sym}", "quote", payload)
            except Exception:
                pass
            try:
                asset = db.get(Asset, sym)
                if asset is not None:
                    changed_asset = False
                    if payload.get("name") and str(payload["name"]).upper() != sym and asset.name != payload["name"]:
                        asset.name = str(payload["name"])[:255]
                        changed_asset = True
                    if payload.get("logo_url") and not asset.logo_url:
                        asset.logo_url = payload["logo_url"]
                        changed_asset = True
                    if asset.asset_type != detected:
                        asset.asset_type = detected
                        changed_asset = True
                    if payload.get("sector") and asset.sector != payload["sector"]:
                        asset.sector = str(payload["sector"])[:128]
                        changed_asset = True
                    if payload.get("industry") and asset.industry != payload["industry"]:
                        asset.industry = str(payload["industry"])[:128]
                        changed_asset = True
                    if payload.get("region") and asset.region != payload["region"]:
                        asset.region = str(payload["region"])[:16]
                        changed_asset = True
                    if bool(asset.pea_eligible) != bool(payload.get("pea_eligible", False)):
                        asset.pea_eligible = bool(payload.get("pea_eligible", False))
                        changed_asset = True
                    for col in ("pe", "forward_pe", "gross_margin", "op_margin", "net_margin", "roe"):
                        if getattr(asset, col) is None and payload.get(col) is not None:
                            setattr(asset, col, payload[col])
                            changed_asset = True
                    if changed_asset:
                        db.commit()
            except Exception:
                db.rollback()
        return payload

    def get_quote_and_info(self, db: Session, ticker: str, refresh: bool = False) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        cache_key = f"quote:{sym}"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = self._repair_cached_quote_payload(db, sym, dict(cached.payload), persist=True)
                payload["updated_at"] = cached.updated_at.isoformat()
                payload["is_stale"] = cached.is_stale
                return payload
            stale = cache_service.get(db, cache_key, allow_stale=True)
            if stale is not None and stale.age_seconds <= 86400:
                payload = self._repair_cached_quote_payload(db, sym, dict(stale.payload), persist=False)
                payload["updated_at"] = stale.updated_at.isoformat()
                payload["is_stale"] = True
                self._schedule_bg_refresh(
                    db,
                    cache_key,
                    lambda bg_db, _sym=sym: self.get_quote_and_info(bg_db, _sym, refresh=True),
                )
                return payload

        try:
            tk = yf.Ticker(sym)
            try:
                info = tk.info or {}
            except Exception:
                info = {}

            fast_price = None
            fast_prev_close = None
            fast_mcap = None
            fast_currency = None
            fast_year_high = None
            fast_year_low = None
            try:
                fi = tk.fast_info
                fast_price = safe_float(getattr(fi, "last_price", None))
                fast_prev_close = safe_float(getattr(fi, "previous_close", None))
                fast_mcap = safe_float(getattr(fi, "market_cap", None))
                fast_currency = getattr(fi, "currency", None)
                fast_year_high = safe_float(getattr(fi, "year_high", None))
                fast_year_low = safe_float(getattr(fi, "year_low", None))
            except Exception:
                pass

            price = (
                safe_float(info.get("currentPrice"))
                or safe_float(info.get("regularMarketPrice"))
                or safe_float(info.get("navPrice"))
                or fast_price
            )

            hist_1y = None
            if price is None or safe_float(info.get("52WeekChange")) is None:
                try:
                    hist_1y = tk.history(period="1y")
                except Exception:
                    hist_1y = None

            if price is None and hist_1y is not None and not hist_1y.empty and "Close" in hist_1y.columns:
                closes = hist_1y["Close"].dropna()
                if not closes.empty:
                    price = safe_float(closes.iloc[-1])

            raw_name = info.get("longName") or info.get("shortName") or info.get("displayName")
            if price is None and not raw_name:
                raise ValueError(f"Ticker '{sym}' not found")

            quote_type = str(info.get("quoteType") or "").upper()

            prev_close = (
                safe_float(info.get("regularMarketPreviousClose"))
                or safe_float(info.get("previousClose"))
                or fast_prev_close
            )
            day_change = (price - prev_close) if (price is not None and prev_close is not None) else None
            day_change_pct = (
                ((price - prev_close) / prev_close) * 100.0
                if (price is not None and prev_close is not None and prev_close > 0)
                else None
            )

            change_1y = safe_float(info.get("52WeekChange"))
            change_1y_pct = change_1y * 100.0 if change_1y is not None else None
            if change_1y_pct is None and hist_1y is not None and not hist_1y.empty and "Close" in hist_1y.columns:
                closes = hist_1y["Close"].dropna()
                if len(closes) >= 2:
                    first_c = safe_float(closes.iloc[0])
                    last_c = safe_float(closes.iloc[-1])
                    pct = compute_percent_change(first_c, last_c)
                    if pct is not None:
                        change_1y_pct = pct * 100.0

            # Optional Finnhub enrichment (real-time US quote + company profile)
            if "." not in sym and not sym.startswith("^"):
                fh_quote = self._finnhub_get("/quote", {"symbol": sym})
                if isinstance(fh_quote, dict):
                    fh_c = safe_float(fh_quote.get("c"))
                    if fh_c is not None and fh_c > 0:
                        price = fh_c
                        fh_pc = safe_float(fh_quote.get("pc"))
                        if fh_pc is not None and fh_pc > 0:
                            prev_close = fh_pc
                        fh_d = safe_float(fh_quote.get("d"))
                        fh_dp = safe_float(fh_quote.get("dp"))
                        day_change = (
                            fh_d
                            if fh_d is not None
                            else (price - prev_close if prev_close is not None else day_change)
                        )
                        day_change_pct = (
                            fh_dp
                            if fh_dp is not None
                            else (
                                ((price - prev_close) / prev_close) * 100.0
                                if (prev_close is not None and prev_close > 0)
                                else day_change_pct
                            )
                        )

            fh_logo = None
            fh_industry = None
            fh_name = None
            fh_weburl = None
            fh_profile = self._finnhub_get("/stock/profile2", {"symbol": sym})
            if isinstance(fh_profile, dict) and fh_profile:
                fh_logo = fh_profile.get("logo")
                fh_industry = fh_profile.get("finnhubIndustry")
                fh_name = fh_profile.get("name")
                fh_weburl = fh_profile.get("weburl")

            name = self._resolve_quote_name(db, sym, raw_name, fh_name=fh_name)
            asset_type = detect_asset_type(quote_type, name, sym)

            website = info.get("website") or fh_weburl
            logo_url = build_logo_url(sym, finnhub_logo=fh_logo, website=website, name=name)
            raw_country = info.get("country")
            exchange = info.get("exchange") or info.get("fullExchangeName")
            region, pea_eligible = infer_region_and_pea(sym, raw_country, exchange, asset_type)
            country = raw_country or _infer_country_from_ticker(sym, region)
            currency = info.get("currency") or fast_currency or ("EUR" if region == "EU" else "USD")
            sector, industry = self._resolve_sector_and_industry(
                db,
                sym,
                asset_type,
                info.get("sector"),
                info.get("industry"),
                fh_industry=fh_industry,
            )

            # Normalize ETF expense ratio: yfinance `netExpenseRatio` can be in % (e.g. 0.38) while `annualReportExpenseRatio` is decimal (0.0038)
            expense_ratio = safe_float(info.get("annualReportExpenseRatio"))
            if expense_ratio is None:
                net_exp = safe_float(info.get("netExpenseRatio"))
                if net_exp is not None:
                    expense_ratio = net_exp / 100.0 if net_exp > 0.05 else net_exp

            # ETF-specific fields
            expense_ratio = expense_ratio
            dividend_rate = safe_float(info.get("dividendRate")) or safe_float(
                info.get("trailingAnnualDividendRate")
            )
            ex_dividend_date: Optional[str] = None
            ex_div_raw = safe_int(info.get("exDividendDate"))
            if ex_div_raw is not None and ex_div_raw > 0:
                try:
                    ex_dividend_date = (
                        datetime(1970, 1, 1) + timedelta(seconds=ex_div_raw)
                    ).strftime("%Y-%m-%d")
                except Exception:
                    ex_dividend_date = None
            next_earnings_date = self._extract_next_earnings_date(sym, tk, info, asset_type)
            days_until_earnings = self._compute_days_until_earnings(next_earnings_date)
            fx_to_eur_rate, price_eur = self._compute_eur_estimate_fields(db, currency, price)

            pe_val = safe_float(info.get("trailingPE"))
            forward_pe_val = safe_float(info.get("forwardPE"))
            high_52w_val = safe_float(info.get("fiftyTwoWeekHigh")) or fast_year_high
            low_52w_val = safe_float(info.get("fiftyTwoWeekLow")) or fast_year_low
            gross_margin_val = safe_float(info.get("grossMargins"))
            op_margin_val = safe_float(info.get("operatingMargins"))
            net_margin_val = safe_float(info.get("profitMargins"))
            roe_val = safe_float(info.get("returnOnEquity"))

            if (high_52w_val is None or low_52w_val is None) and hist_1y is not None and not hist_1y.empty:
                h_col = "High" if "High" in hist_1y.columns else ("Close" if "Close" in hist_1y.columns else None)
                l_col = "Low" if "Low" in hist_1y.columns else ("Close" if "Close" in hist_1y.columns else None)
                if h_col and high_52w_val is None:
                    s_h = hist_1y[h_col].dropna()
                    if not s_h.empty:
                        high_52w_val = round(float(s_h.max()), 4)
                if l_col and low_52w_val is None:
                    s_l = hist_1y[l_col].dropna()
                    if not s_l.empty:
                        low_52w_val = round(float(s_l.min()), 4)

            if high_52w_val is None or low_52w_val is None:
                px_h52, px_l52 = self._compute_52w_from_prices_payload(db, sym)
                high_52w_val = high_52w_val or px_h52
                low_52w_val = low_52w_val or px_l52

            if asset_type != "ETF" and (
                forward_pe_val is None or pe_val is None or high_52w_val is None or roe_val is None
            ):
                fh_m = self._finnhub_get("/stock/metric", {"symbol": sym, "metric": "all"})
                metric = (fh_m or {}).get("metric") if isinstance(fh_m, dict) else None
                if isinstance(metric, dict) and metric:
                    fb = self._extract_finnhub_metric_fallbacks(metric)
                    pe_val = pe_val or fb["pe"]
                    forward_pe_val = forward_pe_val or fb["forward_pe"]
                    high_52w_val = high_52w_val or fb["fifty_two_week_high"]
                    low_52w_val = low_52w_val or fb["fifty_two_week_low"]
                    if gross_margin_val is None:
                        gross_margin_val = fb["gross_margin"]
                    if op_margin_val is None:
                        op_margin_val = fb["op_margin"]
                    if net_margin_val is None:
                        net_margin_val = fb["net_margin"]
                    if roe_val is None:
                        roe_val = fb["roe"]

            if asset_type != "ETF" and forward_pe_val is None:
                forward_pe_val = self._compute_forward_pe_from_analysts_cache(db, sym, price)

            payload: dict[str, Any] = {
                "ticker": sym,
                "name": name or sym,
                "asset_type": asset_type,
                "exchange": exchange,
                "currency": currency,
                "country": country,
                "region": region,
                "pea_eligible": pea_eligible,
                "sector": sector,
                "industry": industry,
                "website": website,
                "logo_url": logo_url,
                "description": info.get("longBusinessSummary"),
                "price": price,
                "previous_close": prev_close,
                "day_change": day_change,
                "day_change_pct": day_change_pct,
                "change_1y_pct": change_1y_pct,
                "market_cap": safe_float(info.get("marketCap")) or fast_mcap,
                "enterprise_value": safe_float(info.get("enterpriseValue")),
                "shares_outstanding": safe_float(info.get("sharesOutstanding")),
                "pe": pe_val,
                "forward_pe": forward_pe_val,
                "peg": safe_float(info.get("pegRatio")) or safe_float(info.get("trailingPegRatio")),
                "price_to_book": safe_float(info.get("priceToBook")),
                "ev_to_ebitda": safe_float(info.get("enterpriseToEbitda")),
                "dividend_yield": safe_float(info.get("dividendYield")),
                "dividend_rate": dividend_rate,
                "ex_dividend_date": ex_dividend_date,
                "beta": safe_float(info.get("beta")),
                "fifty_two_week_high": high_52w_val,
                "fifty_two_week_low": low_52w_val,
                "analyst_target_price": safe_float(info.get("targetMeanPrice")),
                "recommendation_key": info.get("recommendationKey"),
                # Snapshot ratios from Yahoo info (complemented by fundamentals)
                "gross_margin": gross_margin_val,
                "op_margin": op_margin_val,
                "net_margin": net_margin_val,
                "roe": roe_val,
                "roa": safe_float(info.get("returnOnAssets")),
                "revenue_growth_info": safe_float(info.get("revenueGrowth")),
                "earnings_growth_info": safe_float(info.get("earningsGrowth")),
                "current_ratio_info": safe_float(info.get("currentRatio")),
                "debt_to_equity_info": safe_float(info.get("debtToEquity")),
                "total_cash_info": safe_float(info.get("totalCash")),
                "total_debt_info": safe_float(info.get("totalDebt")),
                "free_cashflow_info": safe_float(info.get("freeCashflow")),
                "ebitda_info": safe_float(info.get("ebitda")),
                # ETF-specific fields
                "expense_ratio": expense_ratio,
                "total_assets": safe_float(info.get("totalAssets")),
                "fund_family": info.get("fundFamily"),
                "category": info.get("category"),
                "next_earnings_date": next_earnings_date,
                "days_until_earnings": days_until_earnings,
                "fx_to_eur_rate": fx_to_eur_rate,
                "price_eur": price_eur,
            }

            updated_at = cache_service.set(db, cache_key, "quote", payload)
            self._upsert_asset_from_quote(db, payload, updated_at)

            return sanitize_for_json(
                {
                    **payload,
                    "updated_at": updated_at.isoformat(),
                    "is_stale": False,
                }
            )
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Failed fetching quote for %s: %s", sym, exc)
            stale = cache_service.get(db, cache_key, allow_stale=True)
            if stale is not None:
                payload = self._repair_cached_quote_payload(db, sym, dict(stale.payload), persist=False)
                payload["updated_at"] = stale.updated_at.isoformat()
                payload["is_stale"] = True
                return payload
            raise ValueError(f"Unable to load market data for '{sym}'") from exc

    def _upsert_asset_from_quote(self, db: Session, quote: dict[str, Any], updated_at: datetime) -> None:
        if _is_sqlite_session(db):
            with _sqlite_write_lock:
                self._write_asset_row(db, quote, updated_at)
        else:
            self._write_asset_row(db, quote, updated_at)

    @staticmethod
    def _write_asset_row(db: Session, quote: dict[str, Any], updated_at: datetime) -> None:
        sym = quote["ticker"]
        asset = db.get(Asset, sym)
        if asset is None:
            asset = Asset(ticker=sym)
            db.add(asset)

        incoming_name = str(quote.get("name") or "").strip()
        existing_name = str(asset.name or "").strip()
        if incoming_name and incoming_name.upper() != sym.upper():
            asset.name = incoming_name[:255]
        elif not existing_name:
            asset.name = sym[:255]
        asset.asset_type = quote.get("asset_type") or "EQUITY"
        asset.exchange = quote.get("exchange")
        asset.currency = quote.get("currency")
        asset.region = quote.get("region") or "US"
        asset.pea_eligible = bool(quote.get("pea_eligible", False))
        if quote.get("sector"):
            asset.sector = str(quote["sector"])[:128]
        if quote.get("industry"):
            asset.industry = str(quote["industry"])[:128]
        if quote.get("logo_url"):
            asset.logo_url = quote["logo_url"]
        if quote.get("market_cap") is not None:
            asset.market_cap = quote["market_cap"]
        if quote.get("price") is not None:
            asset.price = quote["price"]
        if quote.get("pe") is not None:
            asset.pe = quote["pe"]
        if quote.get("forward_pe") is not None:
            asset.forward_pe = quote["forward_pe"]
        if quote.get("peg") is not None:
            asset.peg = quote["peg"]
        if quote.get("gross_margin") is not None:
            asset.gross_margin = quote["gross_margin"]
        if quote.get("op_margin") is not None:
            asset.op_margin = quote["op_margin"]
        if quote.get("net_margin") is not None:
            asset.net_margin = quote["net_margin"]
        if quote.get("roe") is not None:
            asset.roe = quote["roe"]
        asset.updated_at = updated_at
        try:
            db.commit()
        except Exception:
            db.rollback()

    def get_price_history(
        self,
        db: Session,
        ticker: str,
        period: str = "MAX",
        currency: Optional[str] = None,
        refresh: bool = False,
    ) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        period_map = {"1J": "1D", "5J": "5D", "1A": "1Y", "3A": "3Y", "5A": "5Y", "10A": "10Y"}
        period_norm = period_map.get(period.strip().upper(), period.strip().upper())
        if period_norm not in {"1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "MAX"}:
            period_norm = "MAX"

        cache_key = f"prices:{sym}:MAX"
        raw_payload: Optional[dict[str, Any]] = None
        updated_at = utc_now()
        is_stale = False

        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                raw_payload = cached.payload
                updated_at = cached.updated_at
                is_stale = cached.is_stale
            else:
                stale = cache_service.get(db, cache_key, allow_stale=True)
                if stale is not None and stale.age_seconds <= 7 * 86400:
                    raw_payload = stale.payload
                    updated_at = stale.updated_at
                    is_stale = True
                    self._schedule_bg_refresh(
                        db,
                        cache_key,
                        lambda bg_db, _sym=sym: self.get_price_history(bg_db, _sym, period="MAX", refresh=True),
                    )

        if raw_payload is None:
            try:
                tk = yf.Ticker(sym)
                hist = tk.history(period="max", interval="1d", auto_adjust=True, actions=True)
                if hist is None or hist.empty:
                    raise ValueError(f"No historical prices for '{sym}'")

                hist = hist.sort_index()
                hist["MM50"] = hist["Close"].rolling(window=50, min_periods=50).mean()
                hist["MM200"] = hist["Close"].rolling(window=200, min_periods=200).mean()

                native_currency = None
                try:
                    native_currency = getattr(tk.fast_info, "currency", None)
                except Exception:
                    native_currency = None
                if not native_currency:
                    quote = db.get(Asset, sym)
                    native_currency = (quote.currency if quote and quote.currency else None) or (
                        "EUR" if any(sym.endswith(s) for s in EEA_SUFFIXES) else "USD"
                    )

                points: list[dict[str, Any]] = []
                splits: list[dict[str, Any]] = []
                has_splits_col = "Stock Splits" in hist.columns

                for idx, row in hist.iterrows():
                    close_val = safe_float(row.get("Close"))
                    if close_val is None or close_val <= 0:
                        continue
                    date_str = _col_to_date_str(idx)
                    points.append(
                        {
                            "date": date_str,
                            "open": safe_float(row.get("Open")),
                            "high": safe_float(row.get("High")),
                            "low": safe_float(row.get("Low")),
                            "close": round(close_val, 4),
                            "volume": safe_int(row.get("Volume")),
                            "mm50": round(safe_float(row.get("MM50")), 4)
                            if safe_float(row.get("MM50")) is not None
                            else None,
                            "mm200": round(safe_float(row.get("MM200")), 4)
                            if safe_float(row.get("MM200")) is not None
                            else None,
                        }
                    )
                    if has_splits_col:
                        split_val = safe_float(row.get("Stock Splits"))
                        if split_val is not None and split_val > 0 and split_val != 1.0:
                            splits.append({"date": date_str, "ratio": round(split_val, 4)})

                if not points:
                    raise ValueError(f"No valid price points for '{sym}'")

                raw_payload = {
                    "ticker": sym,
                    "native_currency": native_currency,
                    "points": points,
                    "splits": splits,
                }
                updated_at = cache_service.set(db, cache_key, "prices", raw_payload)
                is_stale = False
            except ValueError:
                stale = cache_service.get(db, cache_key, allow_stale=True)
                if stale is None:
                    raise
                raw_payload = stale.payload
                updated_at = stale.updated_at
                is_stale = True
            except Exception as exc:
                logger.warning("Failed fetching price history for %s: %s", sym, exc)
                stale = cache_service.get(db, cache_key, allow_stale=True)
                if stale is None:
                    raise ValueError(f"Unable to load price history for '{sym}'") from exc
                raw_payload = stale.payload
                updated_at = stale.updated_at
                is_stale = True

        native_currency = raw_payload.get("native_currency") or "USD"
        target_currency = currency.strip().upper() if currency else native_currency
        fx_factor = 1.0
        if target_currency != native_currency:
            fx_res = self.get_fx_rate(db, native_currency, target_currency)
            fx_val = safe_float(fx_res.get("rate"))
            if fx_val and fx_val > 0:
                fx_factor = fx_val
            else:
                target_currency = native_currency

        all_points: list[dict[str, Any]] = raw_payload.get("points") or []
        all_splits: list[dict[str, Any]] = raw_payload.get("splits") or []

        if all_points and period_norm != "MAX":
            last_dt = datetime.strptime(all_points[-1]["date"], "%Y-%m-%d")
            if period_norm == "1D":
                sliced_points = all_points[-2:] if len(all_points) >= 2 else all_points[-1:]
            else:
                if period_norm == "YTD":
                    cutoff_str = f"{last_dt.year}-01-01"
                else:
                    days_map = {
                        "5D": 7,
                        "1M": 31,
                        "3M": 92,
                        "6M": 183,
                        "1Y": 365,
                        "3Y": 1096,
                        "5Y": 1826,
                        "10Y": 3652,
                    }
                    cutoff_dt = last_dt - timedelta(days=days_map[period_norm])
                    cutoff_str = cutoff_dt.strftime("%Y-%m-%d")
                sliced_points = [pt for pt in all_points if pt["date"] >= cutoff_str]
                if not sliced_points:
                    sliced_points = all_points[-1:]
                elif period_norm == "5D" and len(sliced_points) < 2 and len(all_points) >= 2:
                    sliced_points = all_points[-2:]
            sliced_splits = [sp for sp in all_splits if sp["date"] >= sliced_points[0]["date"]]
        else:
            sliced_points = all_points
            sliced_splits = all_splits

        if fx_factor != 1.0:
            converted_points = []
            for pt in sliced_points:
                converted_points.append(
                    {
                        **pt,
                        "open": round(pt["open"] * fx_factor, 4) if pt.get("open") is not None else None,
                        "high": round(pt["high"] * fx_factor, 4) if pt.get("high") is not None else None,
                        "low": round(pt["low"] * fx_factor, 4) if pt.get("low") is not None else None,
                        "close": round(pt["close"] * fx_factor, 4),
                        "mm50": round(pt["mm50"] * fx_factor, 4) if pt.get("mm50") is not None else None,
                        "mm200": round(pt["mm200"] * fx_factor, 4) if pt.get("mm200") is not None else None,
                    }
                )
            sliced_points = converted_points

        perf_pct: Optional[float] = None
        cagr_pct: Optional[float] = None
        max_drawdown_pct: Optional[float] = None
        annualized_volatility_pct: Optional[float] = None

        if len(sliced_points) >= 2:
            closes = [pt["close"] for pt in sliced_points if pt.get("close") is not None]
            if len(closes) >= 2 and closes[0] > 0:
                pct = compute_percent_change(closes[0], closes[-1])
                if pct is not None:
                    perf_pct = round(pct * 100.0, 2)

                d0 = datetime.strptime(sliced_points[0]["date"], "%Y-%m-%d")
                d1 = datetime.strptime(sliced_points[-1]["date"], "%Y-%m-%d")
                span_days = (d1 - d0).days
                if span_days >= 360:
                    cagr = compute_cagr(closes[0], closes[-1], span_days / 365.25)
                    if cagr is not None:
                        cagr_pct = round(cagr * 100.0, 2)

                # Max drawdown & annualized volatility
                arr = np.array(closes, dtype=float)
                running_max = np.maximum.accumulate(arr)
                drawdowns = (arr - running_max) / running_max
                mdd = safe_float(np.min(drawdowns))
                if mdd is not None:
                    max_drawdown_pct = round(mdd * 100.0, 2)

                if len(arr) >= 20:
                    rets = np.diff(arr) / arr[:-1]
                    vol = safe_float(np.std(rets, ddof=1) * np.sqrt(252))
                    if vol is not None:
                        annualized_volatility_pct = round(vol * 100.0, 2)

        return sanitize_for_json(
            {
                "ticker": sym,
                "period": period_norm,
                "native_currency": native_currency,
                "currency": target_currency,
                "fx_rate_applied": round(fx_factor, 6),
                "perf_pct": perf_pct,
                "cagr_pct": cagr_pct,
                "max_drawdown_pct": max_drawdown_pct,
                "annualized_volatility_pct": annualized_volatility_pct,
                "points": sliced_points,
                "splits": sliced_splits,
                "updated_at": updated_at.isoformat(),
                "is_stale": is_stale,
            }
        )

    def get_fundamentals(self, db: Session, ticker: str, refresh: bool = False) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        cache_key = f"fundamentals:{sym}"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = dict(cached.payload)
                payload["updated_at"] = cached.updated_at.isoformat()
                payload["is_stale"] = cached.is_stale
                return payload

        quote = self.get_quote_and_info(db, sym, refresh=False)
        if quote.get("asset_type") == "ETF":
            payload = {
                "ticker": sym,
                "available": False,
                "reason": "ETF",
                "currency": quote.get("currency"),
                "annual": [],
                "quarterly": [],
                "estimates": {},
                "historical_multiples": [],
                "historical_years_count": 0,
            }
            updated_at = cache_service.set(db, cache_key, "fundamentals", payload)
            return sanitize_for_json(
                {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
            )

        try:
            tk = yf.Ticker(sym)
            yf_annual = self._extract_statement_records(
                tk.financials,
                tk.balance_sheet,
                tk.cashflow,
                fallback_shares=quote.get("shares_outstanding"),
            )
            yf_quarterly = self._extract_statement_records(
                tk.quarterly_financials,
                tk.quarterly_balance_sheet,
                tk.quarterly_cashflow,
                fallback_shares=quote.get("shares_outstanding"),
            )

            # Deep history via SEC EDGAR for US equities + FMP (limit=5) optional fill
            splits: list[dict[str, Any]] = []
            try:
                px_max = self.get_price_history(db, sym, period="MAX")
                splits = px_max.get("splits") or []
            except Exception:
                splits = []

            sec_data = fetch_sec_financials(
                db,
                sym,
                splits=splits,
                fallback_shares=quote.get("shares_outstanding"),
            )
            sec_annual = (sec_data or {}).get("annual") or []
            sec_quarterly = (sec_data or {}).get("quarterly") or []
            fmp_annual = (
                self._fetch_fmp_statements(sym, "annual")
                if not yf_annual and not sec_annual
                else []
            )
            fmp_quarterly = (
                self._fetch_fmp_statements(sym, "quarter")
                if not yf_quarterly and not sec_quarterly
                else []
            )

            annual_records = self._merge_statement_series(
                yf_annual,
                sec_annual,
                fmp_annual,
                max_items=10,
            )
            quarterly_records = self._merge_statement_series(
                yf_quarterly,
                sec_quarterly,
                fmp_quarterly,
                max_items=20,
            )

            ttm_record = self.compute_ttm_record(quarterly_records)
            dividends_annual = self._extract_dividends_annual(tk)
            estimates = self._extract_analyst_estimates(tk)
            historical_multiples = self._compute_historical_multiples(db, sym, annual_records)

            payload = {
                "ticker": sym,
                "available": len(annual_records) > 0 or len(quarterly_records) > 0,
                "reason": None if (annual_records or quarterly_records) else "NO_DATA",
                "currency": quote.get("currency"),
                "annual": annual_records,
                "quarterly": quarterly_records,
                "ttm": ttm_record,
                "dividends_annual": dividends_annual,
                "estimates": estimates,
                "historical_multiples": historical_multiples,
                "historical_years_count": len(historical_multiples),
            }
            updated_at = cache_service.set(db, cache_key, "fundamentals", payload)
            return sanitize_for_json(
                {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
            )
        except Exception as exc:
            logger.warning("Failed fetching fundamentals for %s: %s", sym, exc)
            stale = cache_service.get(db, cache_key, allow_stale=True)
            if stale is not None:
                payload = dict(stale.payload)
                payload["updated_at"] = stale.updated_at.isoformat()
                payload["is_stale"] = True
                return payload
            return sanitize_for_json(
                {
                    "ticker": sym,
                    "available": False,
                    "reason": "UNAVAILABLE",
                    "currency": quote.get("currency"),
                    "annual": [],
                    "quarterly": [],
                    "ttm": None,
                    "dividends_annual": [],
                    "estimates": {},
                    "historical_multiples": [],
                    "historical_years_count": 0,
                    "updated_at": utc_now().isoformat(),
                    "is_stale": True,
                }
            )

    def _fetch_fmp_statements(self, ticker: str, period: str) -> list[dict[str, Any]]:
        """Fetch up to 5 statements from FMP free-tier /stable endpoints (limit=5 strict)."""
        inc = self._fmp_get("/stable/income-statement", {"symbol": ticker, "period": period, "limit": 5})
        if not isinstance(inc, list) or not inc:
            return []
        bs = self._fmp_get("/stable/balance-sheet-statement", {"symbol": ticker, "period": period, "limit": 5})
        cf = self._fmp_get("/stable/cash-flow-statement", {"symbol": ticker, "period": period, "limit": 5})

        bs_by_dt = {str(r.get("date") or "")[:10]: r for r in (bs if isinstance(bs, list) else []) if r.get("date")}
        cf_by_dt = {str(r.get("date") or "")[:10]: r for r in (cf if isinstance(cf, list) else []) if r.get("date")}

        records: list[dict[str, Any]] = []
        for row in inc:
            dt = str(row.get("date") or "")[:10]
            if not dt:
                continue
            b_row = bs_by_dt.get(dt) or {}
            c_row = cf_by_dt.get(dt) or {}

            rev = safe_float(row.get("revenue"))
            gp = safe_float(row.get("grossProfit"))
            op = safe_float(row.get("operatingIncome"))
            ni = safe_float(row.get("netIncome"))
            ebitda = safe_float(row.get("ebitda"))
            eps = safe_float(row.get("epsDiluted")) or safe_float(row.get("eps"))
            shares = safe_float(row.get("weightedAverageShsOutDil")) or safe_float(row.get("weightedAverageShsOut"))
            ocf = safe_float(c_row.get("operatingCashFlow"))
            capex = safe_float(c_row.get("capitalExpenditure"))
            fcf = safe_float(c_row.get("freeCashFlow"))
            if fcf is None and ocf is not None and capex is not None:
                fcf = ocf - abs(capex)

            cash = safe_float(b_row.get("cashAndShortTermInvestments")) or safe_float(b_row.get("cashAndCashEquivalents"))
            debt = safe_float(b_row.get("totalDebt"))
            net_debt = safe_float(b_row.get("netDebt"))
            if net_debt is None and debt is not None and cash is not None:
                net_debt = debt - cash
            equity = safe_float(b_row.get("totalStockholdersEquity"))
            ca = safe_float(b_row.get("totalCurrentAssets"))
            cl = safe_float(b_row.get("totalCurrentLiabilities"))

            records.append(
                {
                    "period_end": dt,
                    "fiscal_year": int(dt[:4]) if dt[:4].isdigit() else None,
                    "revenue": rev,
                    "gross_profit": gp,
                    "operating_income": op,
                    "net_income": ni,
                    "ebitda": ebitda,
                    "operating_cash_flow": ocf,
                    "capex": capex,
                    "free_cash_flow": fcf,
                    "eps": eps,
                    "shares_outstanding": shares,
                    "cash": cash,
                    "total_debt": debt,
                    "net_debt": net_debt,
                    "total_equity": equity,
                    "current_assets": ca,
                    "current_liabilities": cl,
                    "gross_margin": (gp / rev) if (gp is not None and rev and rev > 0) else None,
                    "op_margin": (op / rev) if (op is not None and rev and rev > 0) else None,
                    "net_margin": (ni / rev) if (ni is not None and rev and rev > 0) else None,
                    "roe": (ni / equity) if (ni is not None and equity and equity > 0) else None,
                    "roic": None,
                    "fcf_conversion": (fcf / ni) if (fcf is not None and ni and ni > 0) else None,
                    "net_debt_ebitda": (net_debt / ebitda) if (net_debt is not None and ebitda and ebitda > 0) else None,
                    "debt_to_equity": (debt / equity) if (debt is not None and equity and equity > 0) else None,
                    "current_ratio": (ca / cl) if (ca is not None and cl and cl > 0) else None,
                    "revenue_per_share": (rev / shares) if (rev is not None and shares and shares > 0) else None,
                    "fcf_per_share": (fcf / shares) if (fcf is not None and shares and shares > 0) else None,
                    "net_income_per_share": (ni / shares) if (ni is not None and shares and shares > 0) else None,
                }
            )
        return sorted(records, key=lambda r: r["period_end"])

    @staticmethod
    def _merge_statement_series(
        primary: list[dict[str, Any]],
        sec_list: list[dict[str, Any]],
        fmp_list: list[dict[str, Any]],
        max_items: int,
    ) -> list[dict[str, Any]]:
        """Merge records across yfinance, SEC EDGAR, and FMP, matching dates within +-12 days."""
        merged: list[dict[str, Any]] = [dict(r) for r in primary]

        def _find_match_idx(target_dt_str: str) -> Optional[int]:
            try:
                t_dt = datetime.strptime(target_dt_str[:10], "%Y-%m-%d")
            except Exception:
                return None
            for i, existing in enumerate(merged):
                try:
                    e_dt = datetime.strptime(existing["period_end"][:10], "%Y-%m-%d")
                except Exception:
                    continue
                if abs((e_dt - t_dt).days) <= 12:
                    return i
            return None

        for source_list in (fmp_list, sec_list):
            for src in source_list:
                idx = _find_match_idx(src["period_end"])
                if idx is None:
                    merged.append(dict(src))
                else:
                    target = merged[idx]
                    for k, v in src.items():
                        if target.get(k) is None and v is not None:
                            target[k] = v

        merged.sort(key=lambda r: r["period_end"])
        return merged[-max_items:]

    @staticmethod
    def compute_ttm_record(quarterly_records: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
        """Compute Trailing Twelve Months record from the 4 most recent quarters."""
        if len(quarterly_records) < 4:
            return None
        last4 = quarterly_records[-4:]
        latest = last4[-1]

        def _sum_flow(key: str) -> Optional[float]:
            vals = [safe_float(r.get(key)) for r in last4]
            non_null = [v for v in vals if v is not None]
            if len(non_null) < 4:
                return None
            return sum(non_null)

        revenue = _sum_flow("revenue")
        gross_profit = _sum_flow("gross_profit")
        op_income = _sum_flow("operating_income")
        net_income = _sum_flow("net_income")
        ebitda = _sum_flow("ebitda")
        ocf = _sum_flow("operating_cash_flow")
        capex = _sum_flow("capex")
        fcf = _sum_flow("free_cash_flow")
        if fcf is None and ocf is not None and capex is not None:
            fcf = ocf - abs(capex)

        shares = safe_float(latest.get("shares_outstanding"))
        eps = _sum_flow("eps")
        if eps is None and net_income is not None and shares and shares > 0:
            eps = net_income / shares

        cash = safe_float(latest.get("cash"))
        total_debt = safe_float(latest.get("total_debt"))
        net_debt = safe_float(latest.get("net_debt"))
        total_equity = safe_float(latest.get("total_equity"))
        curr_assets = safe_float(latest.get("current_assets"))
        curr_liab = safe_float(latest.get("current_liabilities"))

        gross_margin = (gross_profit / revenue) if (gross_profit is not None and revenue and revenue > 0) else None
        op_margin = (op_income / revenue) if (op_income is not None and revenue and revenue > 0) else None
        net_margin = (net_income / revenue) if (net_income is not None and revenue and revenue > 0) else None
        roe = (net_income / total_equity) if (net_income is not None and total_equity and total_equity > 0) else None

        roic = None
        if op_income is not None and total_equity is not None and total_debt is not None:
            inv_cap = total_equity + total_debt - (cash or 0.0)
            if inv_cap > 0:
                roic = (op_income * 0.79) / inv_cap

        fcf_conversion = (fcf / net_income) if (fcf is not None and net_income and net_income > 0) else None
        net_debt_ebitda = (net_debt / ebitda) if (net_debt is not None and ebitda and ebitda > 0) else None
        debt_to_equity = (total_debt / total_equity) if (total_debt is not None and total_equity and total_equity > 0) else None
        current_ratio = (curr_assets / curr_liab) if (curr_assets is not None and curr_liab and curr_liab > 0) else None

        return sanitize_for_json(
            {
                "period_end": "TTM",
                "fiscal_year": None,
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
                "revenue_per_share": (revenue / shares) if (revenue is not None and shares and shares > 0) else None,
                "fcf_per_share": (fcf / shares) if (fcf is not None and shares and shares > 0) else None,
                "net_income_per_share": (net_income / shares) if (net_income is not None and shares and shares > 0) else None,
            }
        )

    @staticmethod
    def _extract_dividends_annual(tk: Any) -> list[dict[str, Any]]:
        try:
            divs = tk.dividends
            if divs is None or divs.empty:
                return []
            grouped = divs.groupby(divs.index.year).sum()
            out = [
                {"year": int(yr), "dividend_per_share": round(float(val), 4)}
                for yr, val in grouped.items()
                if safe_float(val) is not None and float(val) > 0
            ]
            return out[-10:]
        except Exception:
            return []

    def _extract_statement_records(
        self,
        fin_df: Optional[pd.DataFrame],
        bs_df: Optional[pd.DataFrame],
        cf_df: Optional[pd.DataFrame],
        fallback_shares: Optional[float] = None,
    ) -> list[dict[str, Any]]:
        rev_s = extract_row_series(fin_df, ["Total Revenue", "Operating Revenue", "Revenue"])
        gp_s = extract_row_series(fin_df, ["Gross Profit"])
        op_s = extract_row_series(
            fin_df, ["Operating Income", "EBIT", "Total Operating Income As Reported"]
        )
        ni_s = extract_row_series(
            fin_df,
            [
                "Net Income",
                "Net Income Common Stockholders",
                "Net Income Continuous Operations",
            ],
        )
        ebitda_s = extract_row_series(fin_df, ["EBITDA", "Normalized EBITDA"])
        eps_s = extract_row_series(fin_df, ["Diluted EPS", "Basic EPS"])
        shares_s = extract_row_series(
            fin_df, ["Diluted Average Shares", "Basic Average Shares"]
        )
        bs_shares_s = extract_row_series(bs_df, ["Ordinary Shares Number", "Share Issued"])
        pretax_s = extract_row_series(fin_df, ["Pretax Income"])
        tax_s = extract_row_series(fin_df, ["Tax Provision"])

        ocf_s = extract_row_series(
            cf_df,
            [
                "Operating Cash Flow",
                "Cash Flow From Continuing Operating Activities",
                "Total Cash From Operating Activities",
            ],
        )
        capex_s = extract_row_series(cf_df, ["Capital Expenditure", "Capital Expenditures"])
        fcf_s = extract_row_series(cf_df, ["Free Cash Flow"])

        cash_s = extract_row_series(
            bs_df,
            [
                "Cash Cash Equivalents And Short Term Investments",
                "Cash And Cash Equivalents",
                "Cash Financial",
            ],
        )
        debt_s = extract_row_series(
            bs_df, ["Total Debt", "Long Term Debt And Capital Lease Obligation"]
        )
        equity_s = extract_row_series(
            bs_df,
            [
                "Stockholders Equity",
                "Total Equity Gross Minority Interest",
                "Common Stock Equity",
            ],
        )
        curr_assets_s = extract_row_series(bs_df, ["Current Assets", "Total Current Assets"])
        curr_liab_s = extract_row_series(
            bs_df, ["Current Liabilities", "Total Current Liabilities"]
        )
        inv_cap_s = extract_row_series(bs_df, ["Invested Capital"])

        all_dates = sorted(
            set(rev_s) | set(ni_s) | set(ocf_s) | set(cash_s) | set(debt_s) | set(equity_s)
        )
        records: list[dict[str, Any]] = []

        for dt in all_dates:
            revenue = rev_s.get(dt)
            gross_profit = gp_s.get(dt)
            op_income = op_s.get(dt)
            net_income = ni_s.get(dt)
            ebitda = ebitda_s.get(dt)
            ocf = ocf_s.get(dt)
            capex = capex_s.get(dt)
            fcf = fcf_s.get(dt)
            if fcf is None and ocf is not None and capex is not None:
                fcf = ocf - abs(capex)

            shares = shares_s.get(dt) or bs_shares_s.get(dt) or fallback_shares
            eps = eps_s.get(dt)
            if eps is None and net_income is not None and shares and shares > 0:
                eps = net_income / shares

            cash = cash_s.get(dt)
            total_debt = debt_s.get(dt)
            net_debt = (
                (total_debt - cash) if (total_debt is not None and cash is not None) else None
            )
            total_equity = equity_s.get(dt)
            curr_assets = curr_assets_s.get(dt)
            curr_liab = curr_liab_s.get(dt)

            gross_margin = (gross_profit / revenue) if (gross_profit is not None and revenue and revenue > 0) else None
            op_margin = (op_income / revenue) if (op_income is not None and revenue and revenue > 0) else None
            net_margin = (net_income / revenue) if (net_income is not None and revenue and revenue > 0) else None

            roe = (net_income / total_equity) if (net_income is not None and total_equity and total_equity > 0) else None

            inv_capital = inv_cap_s.get(dt)
            if inv_capital is None and total_equity is not None and total_debt is not None:
                inv_capital = total_equity + total_debt - (cash or 0.0)

            roic = None
            if op_income is not None and inv_capital and inv_capital > 0:
                tax_rate = 0.21
                pretax = pretax_s.get(dt)
                tax = tax_s.get(dt)
                if pretax and pretax > 0 and tax is not None and tax >= 0:
                    tax_rate = min(0.45, max(0.0, tax / pretax))
                nopat = op_income * (1.0 - tax_rate)
                roic = nopat / inv_capital

            fcf_conversion = (
                (fcf / net_income) if (fcf is not None and net_income and net_income > 0) else None
            )
            net_debt_ebitda = (
                (net_debt / ebitda) if (net_debt is not None and ebitda and ebitda > 0) else None
            )
            debt_to_equity = (
                (total_debt / total_equity)
                if (total_debt is not None and total_equity and total_equity > 0)
                else None
            )
            current_ratio = (
                (curr_assets / curr_liab)
                if (curr_assets is not None and curr_liab and curr_liab > 0)
                else None
            )

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

    @staticmethod
    def _extract_analyst_estimates(tk: Any) -> dict[str, Any]:
        estimates: dict[str, Any] = {}
        try:
            rev_est = tk.revenue_estimate
            if rev_est is not None and not rev_est.empty:
                rev_map = {}
                for period_key in rev_est.index:
                    row = rev_est.loc[period_key]
                    rev_map[str(period_key)] = {
                        "avg": safe_float(row.get("avg")),
                        "low": safe_float(row.get("low")),
                        "high": safe_float(row.get("high")),
                        "growth": safe_float(row.get("growth")),
                    }
                estimates["revenue"] = rev_map
        except Exception:
            pass

        try:
            eps_est = tk.earnings_estimate
            if eps_est is not None and not eps_est.empty:
                eps_map = {}
                for period_key in eps_est.index:
                    row = eps_est.loc[period_key]
                    eps_map[str(period_key)] = {
                        "avg": safe_float(row.get("avg")),
                        "low": safe_float(row.get("low")),
                        "high": safe_float(row.get("high")),
                        "growth": safe_float(row.get("growth")),
                    }
                estimates["eps"] = eps_map
        except Exception:
            pass

        return estimates

    def _compute_historical_multiples(
        self,
        db: Session,
        ticker: str,
        annual_records: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not annual_records:
            return []
        try:
            price_hist = self.get_price_history(db, ticker, period="MAX")
        except Exception:
            return []

        points = price_hist.get("points") or []
        if not points:
            return []

        dates = [pt["date"] for pt in points]
        closes = [pt["close"] for pt in points]

        multiples: list[dict[str, Any]] = []
        # Compute up to 10 annual periods for historical valuation charts (scoring uses [-5:])
        for rec in annual_records[-10:]:
            p_end = rec["period_end"]
            idx = bisect_right(dates, p_end) - 1
            if idx < 0:
                # If fiscal year end predates slightly or exact match missing, check nearest forward within 10 days
                if dates and (
                    datetime.strptime(dates[0], "%Y-%m-%d")
                    - datetime.strptime(p_end, "%Y-%m-%d")
                ).days <= 10:
                    idx = 0
                else:
                    continue

            px = closes[idx]
            if px is None or px <= 0:
                continue

            eps = rec.get("eps")
            fcf_ps = rec.get("fcf_per_share")
            ebitda = rec.get("ebitda")
            shares = rec.get("shares_outstanding")
            net_debt = rec.get("net_debt") or 0.0

            pe = round(px / eps, 2) if (eps is not None and eps > 0) else None
            p_fcf = round(px / fcf_ps, 2) if (fcf_ps is not None and fcf_ps > 0) else None
            ev_ebitda = (
                round((px * shares + net_debt) / ebitda, 2)
                if (ebitda is not None and ebitda > 0 and shares is not None and shares > 0)
                else None
            )

            multiples.append(
                {
                    "period_end": p_end,
                    "fiscal_year": rec.get("fiscal_year"),
                    "price_at_period_end": px,
                    "pe": pe,
                    "p_fcf": p_fcf,
                    "ev_ebitda": ev_ebitda,
                }
            )

        return multiples

    def get_surprises(self, db: Session, ticker: str, refresh: bool = False) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        cache_key = f"surprises:{sym}"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = dict(cached.payload)
                payload["updated_at"] = cached.updated_at.isoformat()
                payload["is_stale"] = cached.is_stale
                return payload

        quote = self.get_quote_and_info(db, sym, refresh=False)
        if quote.get("asset_type") == "ETF":
            payload = {
                "ticker": sym,
                "available": False,
                "revenue_estimates_available": False,
                "eps": [],
                "revenue": [],
            }
            updated_at = cache_service.set(db, cache_key, "surprises", payload)
            return sanitize_for_json(
                {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
            )

        eps_surprises: list[dict[str, Any]] = []
        revenue_surprises: list[dict[str, Any]] = []
        revenue_estimates_available = False

        # 1. Try FMP /stable/earnings (no limit param -> returns full EPS & Revenue surprise history)
        fmp_earnings = self._fmp_get("/stable/earnings", {"symbol": sym})
        if isinstance(fmp_earnings, list) and fmp_earnings:
            for item in fmp_earnings:
                if not isinstance(item, dict):
                    continue
                dt = str(item.get("date") or "")[:10]
                if not dt:
                    continue
                eps_act = safe_float(item.get("epsActual"))
                eps_est = safe_float(item.get("epsEstimated"))
                if eps_act is not None:
                    eps_surp = (
                        round(((eps_act - eps_est) / abs(eps_est)) * 100.0, 2)
                        if eps_est not in (None, 0)
                        else None
                    )
                    eps_surprises.append(
                        {
                            "period": dt[:7],
                            "date": dt,
                            "estimated": eps_est,
                            "actual": eps_act,
                            "surprise_pct": eps_surp,
                        }
                    )

                rev_act = safe_float(item.get("revenueActual"))
                rev_est = safe_float(item.get("revenueEstimated"))
                if rev_act is not None:
                    rev_surp = None
                    if rev_est not in (None, 0):
                        revenue_estimates_available = True
                        rev_surp = round(((rev_act - rev_est) / abs(rev_est)) * 100.0, 2)
                    revenue_surprises.append(
                        {
                            "period": dt[:7],
                            "date": dt,
                            "estimated": rev_est,
                            "actual": rev_act,
                            "surprise_pct": rev_surp,
                        }
                    )

        # 2. Fallback to Finnhub EPS surprises
        if not eps_surprises:
            fh_earnings = self._finnhub_get("/stock/earnings", {"symbol": sym, "limit": 12})
            if isinstance(fh_earnings, list) and fh_earnings:
                for item in fh_earnings:
                    est = safe_float(item.get("estimate"))
                    act = safe_float(item.get("actual"))
                    surp = safe_float(item.get("surprisePercent"))
                    if surp is None and est not in (None, 0) and act is not None:
                        surp = ((act - est) / abs(est)) * 100.0
                    dt = str(item.get("period") or "")[:10]
                    if dt and (act is not None or est is not None):
                        eps_surprises.append(
                            {
                                "period": f"Q{item.get('quarter')} {item.get('year')}"
                                if item.get("quarter") and item.get("year")
                                else dt,
                                "date": dt,
                                "estimated": est,
                                "actual": act,
                                "surprise_pct": round(surp, 2) if surp is not None else None,
                            }
                        )

        # 3. Fallback to yfinance earnings_history / earnings_dates
        if not eps_surprises:
            try:
                tk = yf.Ticker(sym)
                eh = tk.earnings_history
                if eh is not None and isinstance(eh, pd.DataFrame) and not eh.empty:
                    for idx, row in eh.iterrows():
                        dt = _col_to_date_str(idx)
                        est = safe_float(row.get("epsEstimate"))
                        act = safe_float(row.get("epsActual"))
                        surp = safe_float(row.get("surprisePercent"))
                        if surp is not None:
                            surp = surp * 100.0 if abs(surp) <= 2.0 else surp
                        elif est not in (None, 0) and act is not None:
                            surp = ((act - est) / abs(est)) * 100.0
                        if act is not None or est is not None:
                            eps_surprises.append(
                                {
                                    "period": dt,
                                    "date": dt,
                                    "estimated": est,
                                    "actual": act,
                                    "surprise_pct": round(surp, 2) if surp is not None else None,
                                }
                            )
                if not eps_surprises:
                    ed = tk.earnings_dates
                    if ed is not None and isinstance(ed, pd.DataFrame) and not ed.empty:
                        for idx, row in ed.iterrows():
                            act = safe_float(row.get("Reported EPS"))
                            est = safe_float(row.get("EPS Estimate"))
                            if act is None:
                                continue
                            dt = _col_to_date_str(idx)
                            surp = safe_float(row.get("Surprise(%)"))
                            if surp is None and est not in (None, 0):
                                surp = ((act - est) / abs(est)) * 100.0
                            eps_surprises.append(
                                {
                                    "period": dt,
                                    "date": dt,
                                    "estimated": est,
                                    "actual": act,
                                    "surprise_pct": round(surp, 2) if surp is not None else None,
                                }
                            )
            except Exception as exc:
                logger.debug("yfinance surprises fallback failed for %s: %s", sym, exc)

        eps_surprises = sorted(eps_surprises, key=lambda x: x["date"])[-12:]

        # 4. Fallback quarterly revenue actuals when FMP earnings didn't provide revenue surprises
        if not revenue_surprises:
            fundamentals = self.get_fundamentals(db, sym, refresh=False)
            for q_rec in (fundamentals.get("quarterly") or [])[-12:]:
                rev_act = q_rec.get("revenue")
                dt = q_rec.get("period_end")
                if rev_act is None or not dt:
                    continue
                revenue_surprises.append(
                    {
                        "period": dt[:7],
                        "date": dt,
                        "estimated": None,
                        "actual": rev_act,
                        "surprise_pct": None,
                    }
                )
        else:
            revenue_surprises = sorted(revenue_surprises, key=lambda x: x["date"])[-12:]

        payload = {
            "ticker": sym,
            "available": len(eps_surprises) > 0 or len(revenue_surprises) > 0,
            "revenue_estimates_available": revenue_estimates_available,
            "eps": eps_surprises,
            "revenue": revenue_surprises,
        }
        updated_at = cache_service.set(db, cache_key, "surprises", payload)
        return sanitize_for_json(
            {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
        )

    def get_segments(self, db: Session, ticker: str, refresh: bool = False) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        cache_key = f"segments:{sym}"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = dict(cached.payload)
                payload["updated_at"] = cached.updated_at.isoformat()
                payload["is_stale"] = cached.is_stale
                return payload

        fundamentals = self.get_fundamentals(db, sym, refresh=False)
        margins_annual = [
            {
                "period": rec["period_end"],
                "gross_margin": rec.get("gross_margin"),
                "op_margin": rec.get("op_margin"),
                "net_margin": rec.get("net_margin"),
            }
            for rec in (fundamentals.get("annual") or [])
        ]
        margins_quarterly = [
            {
                "period": rec["period_end"],
                "gross_margin": rec.get("gross_margin"),
                "op_margin": rec.get("op_margin"),
                "net_margin": rec.get("net_margin"),
            }
            for rec in (fundamentals.get("quarterly") or [])
        ]

        segments: list[dict[str, Any]] = []
        segment_history: list[dict[str, Any]] = []

        if fundamentals.get("available"):
            fmp_data = self._fmp_get(
                "/stable/revenue-product-segmentation",
                {"symbol": sym},
            )
            if isinstance(fmp_data, list) and fmp_data:
                # Parse FMP flat or nested segmentation objects
                by_year: dict[str, dict[str, float]] = {}
                for row in fmp_data:
                    if not isinstance(row, dict):
                        continue
                    dt = str(row.get("date") or row.get("fiscalYear") or "")[:10]
                    seg_dict = row.get("data") if isinstance(row.get("data"), dict) else row
                    parsed_row: dict[str, float] = {}
                    for k, v in seg_dict.items():
                        if k in {"symbol", "date", "fiscalYear", "period", "reportedCurrency"}:
                            continue
                        val = safe_float(v)
                        if val is not None and val > 0:
                            parsed_row[str(k)] = val
                    if dt and parsed_row:
                        by_year[dt] = parsed_row

                if by_year:
                    sorted_dates = sorted(by_year.keys())[-10:]
                    latest_dt = sorted_dates[-1]
                    latest_total = sum(by_year[latest_dt].values()) or 1.0
                    segments = [
                        {
                            "name": name,
                            "revenue": val,
                            "share_pct": round((val / latest_total) * 100.0, 2),
                        }
                        for name, val in sorted(
                            by_year[latest_dt].items(), key=lambda x: x[1], reverse=True
                        )
                    ]
                    segment_history = [
                        {"period": dt, "segments": by_year[dt]} for dt in sorted_dates
                    ]

        payload = {
            "ticker": sym,
            "segments_available": len(segments) > 0,
            "segments": segments,
            "segment_history": segment_history,
            "margins_available": len(margins_annual) > 0 or len(margins_quarterly) > 0,
            "margins_annual": margins_annual,
            "margins_quarterly": margins_quarterly,
        }
        updated_at = cache_service.set(db, cache_key, "segments", payload)
        return sanitize_for_json(
            {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
        )

    def get_raw_peers(self, db: Session, ticker: str, refresh: bool = False) -> list[str]:
        sym = normalize_ticker(ticker)
        cache_key = f"peers_list:{sym}"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None and isinstance(cached.payload, list):
                return cached.payload

        excluded = _share_class_siblings(sym)
        candidates: list[str] = []

        # 1. Finnhub /stock/peers
        fh_peers = self._finnhub_get("/stock/peers", {"symbol": sym})
        if isinstance(fh_peers, list):
            for p in fh_peers:
                p_norm = normalize_ticker(str(p))
                if p_norm and p_norm not in excluded and p_norm not in candidates:
                    candidates.append(p_norm)

        # 2. Curated seed peers
        seed_item = _seed_by_ticker().get(sym)
        if seed_item:
            for p in seed_item.get("peers") or []:
                p_norm = normalize_ticker(str(p))
                if p_norm and p_norm not in excluded and p_norm not in candidates:
                    candidates.append(p_norm)

        # 3. Same industry / sector in assets table
        if len(candidates) < 6:
            asset = db.get(Asset, sym)
            if asset and asset.industry:
                same_ind = (
                    db.query(Asset.ticker)
                    .filter(Asset.industry == asset.industry, Asset.asset_type == "EQUITY")
                    .order_by(Asset.market_cap.desc().nullslast())
                    .limit(12)
                    .all()
                )
                for (p_t,) in same_ind:
                    if p_t not in excluded and p_t not in candidates:
                        candidates.append(p_t)
            if len(candidates) < 6 and asset and asset.sector:
                same_sec = (
                    db.query(Asset.ticker)
                    .filter(Asset.sector == asset.sector, Asset.asset_type == "EQUITY")
                    .order_by(Asset.market_cap.desc().nullslast())
                    .limit(12)
                    .all()
                )
                for (p_t,) in same_sec:
                    if p_t not in excluded and p_t not in candidates:
                        candidates.append(p_t)

        # Deduplicate share classes among candidates
        final_peers: list[str] = []
        seen_groups: list[set[str]] = []
        for cand in candidates:
            siblings = _share_class_siblings(cand)
            if any(cand in grp for grp in seen_groups):
                continue
            seen_groups.append(siblings)
            final_peers.append(cand)
            if len(final_peers) >= 8:
                break

        cache_service.set(db, cache_key, "peers_list", final_peers)
        return final_peers

    def get_analysts(self, db: Session, ticker: str, refresh: bool = False) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        cache_key = f"analysts:{sym}"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = dict(cached.payload)
                payload["updated_at"] = cached.updated_at.isoformat()
                payload["is_stale"] = cached.is_stale
                return payload

        quote = self.get_quote_and_info(db, sym, refresh=False)
        if quote.get("asset_type") == "ETF":
            payload = {
                "ticker": sym,
                "available": False,
                "reason": "ETF",
                "currency": quote.get("currency"),
                "price_targets": None,
                "revenue_forecasts": [],
                "revenue_cagr": None,
                "eps_forecasts": [],
                "eps_cagr": None,
                "consensus": None,
            }
            updated_at = cache_service.set(db, cache_key, "fundamentals", payload)
            return sanitize_for_json(
                {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
            )

        tk = yf.Ticker(sym)
        current_price = safe_float(quote.get("price"))

        # 1. Price Targets (12M)
        price_targets: Optional[dict[str, Any]] = None
        try:
            pts = tk.analyst_price_targets or {}
            pt_cur = safe_float(pts.get("current")) or current_price
            pt_high = safe_float(pts.get("high"))
            pt_mean = safe_float(pts.get("mean")) or safe_float(quote.get("analyst_target_price"))
            pt_median = safe_float(pts.get("median"))
            pt_low = safe_float(pts.get("low"))
            if any(v is not None for v in (pt_high, pt_mean, pt_low)):
                price_targets = {
                    "current": pt_cur,
                    "high": pt_high,
                    "mean": pt_mean,
                    "median": pt_median,
                    "low": pt_low,
                    "upside_high_pct": round(((pt_high - pt_cur) / pt_cur) * 100.0, 1)
                    if (pt_high is not None and pt_cur and pt_cur > 0)
                    else None,
                    "upside_mean_pct": round(((pt_mean - pt_cur) / pt_cur) * 100.0, 1)
                    if (pt_mean is not None and pt_cur and pt_cur > 0)
                    else None,
                    "upside_low_pct": round(((pt_low - pt_cur) / pt_cur) * 100.0, 1)
                    if (pt_low is not None and pt_cur and pt_cur > 0)
                    else None,
                }
        except Exception:
            pass

        # 2. Forward Revenue & EPS Forecasts (recent actuals + future estimates)
        fundamentals = self.get_fundamentals(db, sym, refresh=False)
        annual = fundamentals.get("annual") or []
        recent_actuals = annual[-4:]
        latest_year = recent_actuals[-1].get("fiscal_year") if recent_actuals else None

        rev_forecasts: list[dict[str, Any]] = []
        eps_forecasts: list[dict[str, Any]] = []

        for rec in recent_actuals:
            yr = rec.get("fiscal_year")
            lbl = str(yr) if yr else rec["period_end"][:4]
            if rec.get("revenue") is not None:
                rev_forecasts.append(
                    {
                        "period": lbl,
                        "year": yr,
                        "is_actual": True,
                        "high": rec["revenue"],
                        "avg": rec["revenue"],
                        "low": rec["revenue"],
                        "num_analysts": None,
                    }
                )
            if rec.get("eps") is not None:
                eps_forecasts.append(
                    {
                        "period": lbl,
                        "year": yr,
                        "is_actual": True,
                        "high": rec["eps"],
                        "avg": rec["eps"],
                        "low": rec["eps"],
                        "num_analysts": None,
                    }
                )

        fmp_est = self._fmp_get(
            "/stable/analyst-estimates",
            {"symbol": sym, "period": "annual", "limit": 6},
        )
        added_fmp = False
        if isinstance(fmp_est, list) and fmp_est:
            future_rows = []
            for row in fmp_est:
                if not isinstance(row, dict):
                    continue
                dt = str(row.get("date") or "")[:10]
                yr = int(dt[:4]) if dt[:4].isdigit() else None
                if yr is None:
                    continue
                if latest_year and yr <= latest_year:
                    continue
                future_rows.append((yr, row))
            future_rows.sort(key=lambda x: x[0])
            for yr, row in future_rows[:4]:
                r_avg = safe_float(row.get("revenueAvg"))
                if r_avg is not None:
                    added_fmp = True
                    rev_forecasts.append(
                        {
                            "period": f"{yr} (Est.)",
                            "year": yr,
                            "is_actual": False,
                            "high": safe_float(row.get("revenueHigh")) or r_avg,
                            "avg": r_avg,
                            "low": safe_float(row.get("revenueLow")) or r_avg,
                            "num_analysts": safe_int(row.get("numAnalystsRevenue")),
                        }
                    )
                e_avg = safe_float(row.get("epsAvg"))
                if e_avg is not None:
                    added_fmp = True
                    eps_forecasts.append(
                        {
                            "period": f"{yr} (Est.)",
                            "year": yr,
                            "is_actual": False,
                            "high": safe_float(row.get("epsHigh")) or e_avg,
                            "avg": e_avg,
                            "low": safe_float(row.get("epsLow")) or e_avg,
                            "num_analysts": safe_int(row.get("numAnalystsEps")),
                        }
                    )

        if not added_fmp:
            yf_est = fundamentals.get("estimates") or {}
            base_yr = latest_year or utc_now().year - 1
            for offset_key, offset in (("0y", 1), ("+1y", 2)):
                yr = base_yr + offset
                r_obj = (yf_est.get("revenue") or {}).get(offset_key)
                if r_obj and safe_float(r_obj.get("avg")) is not None:
                    r_avg = safe_float(r_obj.get("avg"))
                    rev_forecasts.append(
                        {
                            "period": f"{yr} (Est.)",
                            "year": yr,
                            "is_actual": False,
                            "high": safe_float(r_obj.get("high")) or r_avg,
                            "avg": r_avg,
                            "low": safe_float(r_obj.get("low")) or r_avg,
                            "num_analysts": None,
                        }
                    )
                e_obj = (yf_est.get("eps") or {}).get(offset_key)
                if e_obj and safe_float(e_obj.get("avg")) is not None:
                    e_avg = safe_float(e_obj.get("avg"))
                    eps_forecasts.append(
                        {
                            "period": f"{yr} (Est.)",
                            "year": yr,
                            "is_actual": False,
                            "high": safe_float(e_obj.get("high")) or e_avg,
                            "avg": e_avg,
                            "low": safe_float(e_obj.get("low")) or e_avg,
                            "num_analysts": None,
                        }
                    )

        def _forecast_cagr(series: list[dict[str, Any]]) -> Optional[dict[str, Optional[float]]]:
            actuals = [p for p in series if p["is_actual"] and (p.get("avg") or 0) > 0]
            futures = [p for p in series if not p["is_actual"]]
            if not actuals or not futures:
                return None
            base_pt = actuals[-1]
            end_pt = futures[-1]
            yrs = max(1, (end_pt.get("year") or 0) - (base_pt.get("year") or 0))
            if yrs <= 0 or yrs > 10:
                yrs = len(futures)
            out: dict[str, Optional[float]] = {}
            for key in ("high", "avg", "low"):
                c = compute_cagr(base_pt.get("avg"), end_pt.get(key), yrs)
                out[key] = round(c * 100.0, 1) if c is not None else None
            return out

        revenue_cagr = _forecast_cagr(rev_forecasts)
        eps_cagr = _forecast_cagr(eps_forecasts)

        # 3. Consensus Breakdown
        consensus: Optional[dict[str, Any]] = None
        fh_rec = self._finnhub_get("/stock/recommendation", {"symbol": sym})
        if isinstance(fh_rec, list) and fh_rec:
            latest_rec = sorted(fh_rec, key=lambda r: str(r.get("period") or ""))[-1]
            sb = int(latest_rec.get("strongBuy") or 0)
            b = int(latest_rec.get("buy") or 0)
            h = int(latest_rec.get("hold") or 0)
            s = int(latest_rec.get("sell") or 0)
            ss = int(latest_rec.get("strongSell") or 0)
            tot = sb + b + h + s + ss
            if tot > 0:
                score = round((5 * sb + 4 * b + 3 * h + 2 * s + 1 * ss) / tot, 2)
                consensus = {
                    "strong_buy": sb,
                    "buy": b,
                    "hold": h,
                    "sell": s,
                    "strong_sell": ss,
                    "total": tot,
                    "score_out_of_5": score,
                    "label": self._consensus_label(score),
                    "period": str(latest_rec.get("period") or ""),
                }

        if consensus is None:
            try:
                rec_df = tk.recommendations_summary
                if rec_df is not None and not rec_df.empty:
                    row = rec_df.iloc[0]
                    sb = int(safe_int(row.get("strongBuy")) or 0)
                    b = int(safe_int(row.get("buy")) or 0)
                    h = int(safe_int(row.get("hold")) or 0)
                    s = int(safe_int(row.get("sell")) or 0)
                    ss = int(safe_int(row.get("strongSell")) or 0)
                    tot = sb + b + h + s + ss
                    if tot > 0:
                        score = round((5 * sb + 4 * b + 3 * h + 2 * s + 1 * ss) / tot, 2)
                        consensus = {
                            "strong_buy": sb,
                            "buy": b,
                            "hold": h,
                            "sell": s,
                            "strong_sell": ss,
                            "total": tot,
                            "score_out_of_5": score,
                            "label": self._consensus_label(score),
                            "period": str(row.get("period") or "0m"),
                        }
            except Exception:
                pass

        payload = {
            "ticker": sym,
            "available": bool(price_targets or len(rev_forecasts) > 0 or len(eps_forecasts) > 0 or consensus),
            "reason": None,
            "currency": quote.get("currency"),
            "price_targets": price_targets,
            "revenue_forecasts": rev_forecasts,
            "revenue_cagr": revenue_cagr,
            "eps_forecasts": eps_forecasts,
            "eps_cagr": eps_cagr,
            "consensus": consensus,
        }
        updated_at = cache_service.set(db, cache_key, "fundamentals", payload)
        return sanitize_for_json(
            {**payload, "updated_at": updated_at.isoformat(), "is_stale": False}
        )

    @staticmethod
    def _consensus_label(score: float) -> str:
        if score >= 4.3:
            return "Achat fort"
        if score >= 3.6:
            return "Achat"
        if score >= 2.6:
            return "Conserver"
        if score >= 1.8:
            return "Alléger"
        return "Vendre"

    def get_stock_news(
        self,
        db: Session,
        ticker: str,
        limit: int = 5,
        refresh: bool = False,
    ) -> dict[str, Any]:
        sym = normalize_ticker(ticker)
        safe_limit = max(1, min(15, int(limit or 5)))
        cache_key = f"news:{sym}"
        if not refresh:
            cached = cache_service.get(db, cache_key)
            if cached is not None:
                payload = dict(cached.payload)
                items = list(payload.get("items") or [])[:safe_limit]
                return sanitize_for_json(
                    {
                        "ticker": sym,
                        "items": items,
                        "updated_at": cached.updated_at.isoformat(),
                        "is_stale": cached.is_stale,
                    }
                )

        raw_items: list[dict[str, Any]] = []
        seen_titles: set[str] = set()

        def _push_item(
            title: Any,
            publisher: Any,
            url: Any,
            pub_ts_or_str: Any,
            summary: Any,
        ) -> None:
            t_clean = str(title or "").strip()
            if not t_clean:
                return
            key = t_clean.lower()
            if key in seen_titles:
                return
            seen_titles.add(key)

            pub_iso: Optional[str] = None
            if isinstance(pub_ts_or_str, (int, float)) and pub_ts_or_str > 0:
                try:
                    pub_iso = (
                        datetime(1970, 1, 1) + timedelta(seconds=int(pub_ts_or_str))
                    ).strftime("%Y-%m-%dT%H:%M:%SZ")
                except Exception:
                    pub_iso = None
            elif isinstance(pub_ts_or_str, str) and pub_ts_or_str.strip():
                pub_iso = pub_ts_or_str.strip()[:25]

            sum_clean = str(summary or "").strip()
            if len(sum_clean) > 220:
                sum_clean = sum_clean[:217].rstrip() + "..."

            raw_items.append(
                {
                    "title": t_clean,
                    "publisher": str(publisher).strip() if publisher else None,
                    "url": str(url).strip() if url else None,
                    "published_at": pub_iso,
                    "summary": sum_clean or None,
                }
            )

        # 1. Try Finnhub company-news (last 30 days)
        now_dt = utc_now()
        from_str = (now_dt - timedelta(days=30)).strftime("%Y-%m-%d")
        to_str = now_dt.strftime("%Y-%m-%d")
        fh_news = self._finnhub_get(
            "/company-news",
            {"symbol": sym, "from": from_str, "to": to_str},
        )
        if isinstance(fh_news, list):
            sorted_fh = sorted(
                [n for n in fh_news if isinstance(n, dict)],
                key=lambda n: int(n.get("datetime") or 0),
                reverse=True,
            )
            for item in sorted_fh[:12]:
                _push_item(
                    item.get("headline"),
                    item.get("source"),
                    item.get("url"),
                    item.get("datetime"),
                    item.get("summary"),
                )

        # 2. Complement / Fallback via Yahoo Finance (supports both legacy & content schemas)
        if len(raw_items) < safe_limit:
            try:
                tk = yf.Ticker(sym)
                yf_news = getattr(tk, "news", None) or []
                if isinstance(yf_news, list):
                    for entry in yf_news:
                        if not isinstance(entry, dict):
                            continue
                        content = entry.get("content") if isinstance(entry.get("content"), dict) else None
                        if content is not None:
                            provider = content.get("provider") if isinstance(content.get("provider"), dict) else {}
                            canon = (
                                content.get("canonicalUrl")
                                if isinstance(content.get("canonicalUrl"), dict)
                                else (
                                    content.get("clickThroughUrl")
                                    if isinstance(content.get("clickThroughUrl"), dict)
                                    else {}
                                )
                            )
                            _push_item(
                                content.get("title"),
                                provider.get("displayName"),
                                canon.get("url"),
                                content.get("pubDate") or content.get("displayTime"),
                                content.get("summary") or content.get("description"),
                            )
                        else:
                            _push_item(
                                entry.get("title"),
                                entry.get("publisher"),
                                entry.get("link"),
                                entry.get("providerPublishTime"),
                                entry.get("summary"),
                            )
            except Exception as exc:
                logger.warning("Failed fetching yfinance news for %s: %s", sym, exc)

        stored_payload = {"ticker": sym, "items": raw_items[:15]}
        updated_at = cache_service.set(
            db, cache_key, "news", stored_payload, ttl_seconds=1800
        )
        return sanitize_for_json(
            {
                "ticker": sym,
                "items": raw_items[:safe_limit],
                "updated_at": updated_at.isoformat(),
                "is_stale": False,
            }
        )


market_data_service = MarketDataService()
