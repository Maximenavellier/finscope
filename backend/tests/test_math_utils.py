import json
from datetime import date, datetime, timezone
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from app.utils.math_utils import (
    compute_cagr,
    compute_percent_change,
    safe_float,
    safe_int,
    sanitize_for_json,
)


def test_safe_float_handles_edge_cases():
    assert safe_float(None) is None
    assert safe_float(float("nan")) is None
    assert safe_float(float("inf")) is None
    assert safe_float(float("-inf")) is None
    assert safe_float(np.nan) is None
    assert safe_float(pd.NA) is None
    assert safe_float(True) is None
    assert safe_float(False) is None
    assert safe_float("N/A") is None
    assert safe_float("") is None
    assert safe_float("1,234.56") == pytest.approx(1234.56)
    assert safe_float(np.float64(42.25)) == pytest.approx(42.25)
    assert safe_float(10, default=0.0) == 10.0
    assert safe_float(float("nan"), default=-1.0) == -1.0


def test_safe_int_handles_edge_cases():
    assert safe_int(None) is None
    assert safe_int(float("nan")) is None
    assert safe_int(np.int64(123)) == 123
    assert safe_int("45.6") == 46


def test_sanitize_for_json_strict():
    raw = {
        "nan_val": float("nan"),
        "inf_val": float("inf"),
        "np_int": np.int64(7),
        "np_float": np.float64(3.14),
        "np_bool": np.bool_(True),
        "ts": pd.Timestamp("2025-01-15"),
        "nat": pd.NaT,
        "dt": datetime(2025, 2, 1, 12, 0, tzinfo=timezone.utc),
        "d": date(2025, 2, 2),
        "dec": Decimal("99.95"),
        "arr": np.array([1.0, float("nan"), 3.0]),
        123: "numeric_key",
    }
    cleaned = sanitize_for_json(raw)
    serialized = json.dumps(cleaned, allow_nan=False)
    parsed = json.loads(serialized)

    assert parsed["nan_val"] is None
    assert parsed["inf_val"] is None
    assert parsed["np_int"] == 7
    assert parsed["np_float"] == pytest.approx(3.14)
    assert parsed["np_bool"] is True
    assert parsed["ts"].startswith("2025-01-15")
    assert parsed["nat"] is None
    assert parsed["dec"] == pytest.approx(99.95)
    assert parsed["arr"] == [1.0, None, 3.0]
    assert parsed["123"] == "numeric_key"


def test_compute_cagr_and_percent_change():
    assert compute_cagr(100, 121, 2) == pytest.approx(0.10, rel=1e-4)
    assert compute_cagr(0, 100, 2) is None
    assert compute_cagr(-50, 100, 2) is None
    assert compute_cagr(100, -10, 2) is None
    assert compute_cagr(100, 200, 0) is None

    assert compute_percent_change(100, 125) == pytest.approx(0.25)
    assert compute_percent_change(-100, -50) == pytest.approx(0.5)
    assert compute_percent_change(0, 50) is None
