import math
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import numpy as np
import pandas as pd


def utc_now() -> datetime:
    """Return current UTC timezone-aware datetime."""
    return datetime.now(timezone.utc)


def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure a datetime object is timezone-aware in UTC (normalizing SQLite naive datetimes)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def safe_float(val: Any, default: Optional[float] = None) -> Optional[float]:
    """Convert value to a finite Python float, returning default for NaN/Inf/NA/invalid."""
    if val is None or isinstance(val, bool):
        return default
    if isinstance(val, (np.bool_,)):
        return default
    try:
        if pd.isna(val):
            return default
    except (TypeError, ValueError):
        pass

    if isinstance(val, (np.floating, np.integer)):
        val = val.item()
    elif isinstance(val, Decimal):
        val = float(val)
    elif isinstance(val, str):
        cleaned = val.strip().replace(",", "")
        if not cleaned or cleaned.lower() in {"nan", "inf", "-inf", "+inf", "infinity", "-infinity", "none", "null", "n/a", "na", "-"}:
            return default
        val = cleaned

    try:
        f = float(val)
    except (TypeError, ValueError, OverflowError):
        return default

    if not math.isfinite(f):
        return default
    return f


def safe_int(val: Any, default: Optional[int] = None) -> Optional[int]:
    """Convert value to Python int safely, returning default when missing or invalid."""
    f = safe_float(val, default=None)
    if f is None:
        return default
    try:
        return int(round(f))
    except (TypeError, ValueError, OverflowError):
        return default


def sanitize_for_json(obj: Any) -> Any:
    """Recursively sanitize nested structures for strict JSON (no NaN/Inf, native Python types)."""
    if obj is None or obj is pd.NaT or obj is pd.NA:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (np.floating, float, Decimal)):
        return safe_float(obj, default=None)
    if isinstance(obj, int):
        return obj
    if isinstance(obj, str):
        return obj
    if isinstance(obj, pd.Timestamp):
        if pd.isna(obj):
            return None
        return obj.isoformat()
    if isinstance(obj, (datetime, date)):
        try:
            if pd.isna(obj):
                return None
        except (TypeError, ValueError):
            pass
        return obj.isoformat()
    if isinstance(obj, np.ndarray):
        return [sanitize_for_json(item) for item in obj.tolist()]
    if isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [sanitize_for_json(item) for item in obj]

    # Catch pandas NA / NaT / other scalar objects
    try:
        if pd.isna(obj):
            return None
    except (TypeError, ValueError):
        pass

    return str(obj)


def compute_cagr(start_val: Any, end_val: Any, years: Any) -> Optional[float]:
    """Compute Compound Annual Growth Rate as a decimal (e.g. 0.15 for 15%)."""
    start = safe_float(start_val)
    end = safe_float(end_val)
    yrs = safe_float(years)
    if start is None or end is None or yrs is None:
        return None
    if start <= 0 or end <= 0 or yrs <= 0:
        return None
    try:
        result = (end / start) ** (1.0 / yrs) - 1.0
    except (ZeroDivisionError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def compute_percent_change(start_val: Any, end_val: Any) -> Optional[float]:
    """Compute safe relative change (end - start) / abs(start) as a decimal."""
    start = safe_float(start_val)
    end = safe_float(end_val)
    if start is None or end is None or start == 0:
        return None
    try:
        result = (end - start) / abs(start)
    except (ZeroDivisionError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None
