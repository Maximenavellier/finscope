from typing import Optional

_SECTOR_FR_MAP: dict[str, str] = {
    "technology": "Technologie",
    "information technology": "Technologie",
    "technologie": "Technologie",
    "healthcare": "Santé",
    "health care": "Santé",
    "santé": "Santé",
    "financial services": "Finance",
    "financials": "Finance",
    "finance": "Finance",
    "communication services": "Communication",
    "telecommunications": "Communication",
    "communication": "Communication",
    "consumer cyclical": "Consommation cyclique",
    "consumer discretionary": "Consommation cyclique",
    "consommation cyclique": "Consommation cyclique",
    "consumer defensive": "Consommation défensive",
    "consumer staples": "Consommation défensive",
    "consommation défensive": "Consommation défensive",
    "industrials": "Industrie",
    "industrial": "Industrie",
    "industrie": "Industrie",
    "energy": "Énergie",
    "énergie": "Énergie",
    "basic materials": "Matériaux",
    "materials": "Matériaux",
    "matériaux": "Matériaux",
    "utilities": "Services publics",
    "services publics": "Services publics",
    "real estate": "Immobilier",
    "immobilier": "Immobilier",
}


def normalize_sector_fr(raw_sector: Optional[str]) -> str:
    """Normalize Yahoo/GICS/French sector labels to unified French portfolio categories."""
    if not raw_sector:
        return "Autre"
    key = str(raw_sector).strip().lower()
    if not key or key in {"etf", "other", "autre", "unknown", "n/a"}:
        return "Autre"
    if key in _SECTOR_FR_MAP:
        return _SECTOR_FR_MAP[key]
    for src, target in _SECTOR_FR_MAP.items():
        if src in key:
            return target
    return "Autre"


_EU_COUNTRIES_LOW = {
    "france",
    "germany",
    "netherlands",
    "italy",
    "spain",
    "belgium",
    "ireland",
    "luxembourg",
    "finland",
    "austria",
    "portugal",
    "sweden",
    "denmark",
    "norway",
    "switzerland",
    "united kingdom",
    "uk",
    "europe",
    "poland",
    "greece",
}

_ASIA_EM_COUNTRIES_LOW = {
    "china",
    "taiwan",
    "india",
    "south korea",
    "korea",
    "hong kong",
    "singapore",
    "brazil",
    "mexico",
    "indonesia",
    "thailand",
    "malaysia",
    "vietnam",
    "south africa",
    "saudi arabia",
    "turkey",
    "emerging",
}

_EU_TICKER_SUFFIXES = (
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
    ".CO",
    ".OL",
    ".ST",
    ".SW",
    ".L",
)


def normalize_geo_fr(
    country: Optional[str],
    region: Optional[str] = None,
    ticker: Optional[str] = None,
) -> str:
    """Map an equity country/region/ticker suffix to one of the geographic buckets."""
    c_low = str(country or "").strip().lower()
    if c_low in {"united states", "usa", "us", "united states of america"}:
        return "États-Unis"
    if c_low == "japan":
        return "Japon"
    if c_low in _EU_COUNTRIES_LOW:
        return "Europe"
    if c_low in _ASIA_EM_COUNTRIES_LOW:
        return "Asie & Émergents"

    reg = str(region or "").strip().upper()
    if reg == "US":
        return "États-Unis"
    if reg == "EU":
        return "Europe"

    sym = str(ticker or "").strip().upper()
    if sym:
        if sym.endswith(".T"):
            return "Japon"
        if any(sym.endswith(s) for s in (".HK", ".SS", ".SZ", ".TW", ".KS", ".KQ", ".NS", ".BO")):
            return "Asie & Émergents"
        if any(sym.endswith(s) for s in _EU_TICKER_SUFFIXES):
            return "Europe"
        if "." not in sym and reg != "OTHER":
            return "États-Unis"

    return "Autres"


ETF_INDEX_PROFILES: dict[str, dict[str, dict[str, float]]] = {
    "nasdaq100": {
        "sectors": {
            "Technologie": 0.51,
            "Communication": 0.16,
            "Consommation cyclique": 0.13,
            "Santé": 0.06,
            "Consommation défensive": 0.06,
            "Industrie": 0.05,
            "Services publics": 0.01,
            "Finance": 0.01,
            "Énergie": 0.01,
        },
        "geo": {
            "États-Unis": 0.96,
            "Europe": 0.02,
            "Asie & Émergents": 0.02,
        },
    },
    "sp500": {
        "sectors": {
            "Technologie": 0.32,
            "Finance": 0.14,
            "Santé": 0.11,
            "Consommation cyclique": 0.11,
            "Communication": 0.09,
            "Industrie": 0.08,
            "Consommation défensive": 0.06,
            "Énergie": 0.03,
            "Services publics": 0.02,
            "Immobilier": 0.02,
            "Matériaux": 0.02,
        },
        "geo": {
            "États-Unis": 1.00,
        },
    },
    "msci_world": {
        "sectors": {
            "Technologie": 0.25,
            "Finance": 0.16,
            "Industrie": 0.11,
            "Santé": 0.11,
            "Consommation cyclique": 0.10,
            "Communication": 0.08,
            "Consommation défensive": 0.06,
            "Énergie": 0.04,
            "Matériaux": 0.04,
            "Services publics": 0.03,
            "Immobilier": 0.02,
        },
        "geo": {
            "États-Unis": 0.72,
            "Europe": 0.16,
            "Japon": 0.06,
            "Autres": 0.06,
        },
    },
    "all_world": {
        "sectors": {
            "Technologie": 0.25,
            "Finance": 0.17,
            "Industrie": 0.11,
            "Santé": 0.10,
            "Consommation cyclique": 0.10,
            "Communication": 0.08,
            "Consommation défensive": 0.06,
            "Énergie": 0.04,
            "Matériaux": 0.04,
            "Services publics": 0.03,
            "Immobilier": 0.02,
        },
        "geo": {
            "États-Unis": 0.64,
            "Europe": 0.15,
            "Asie & Émergents": 0.11,
            "Japon": 0.06,
            "Autres": 0.04,
        },
    },
    "emerging": {
        "sectors": {
            "Technologie": 0.24,
            "Finance": 0.23,
            "Consommation cyclique": 0.13,
            "Communication": 0.09,
            "Industrie": 0.07,
            "Matériaux": 0.06,
            "Consommation défensive": 0.05,
            "Énergie": 0.05,
            "Santé": 0.04,
            "Services publics": 0.03,
            "Immobilier": 0.01,
        },
        "geo": {
            "Asie & Émergents": 0.96,
            "Europe": 0.04,
        },
    },
    "europe": {
        "sectors": {
            "Finance": 0.20,
            "Industrie": 0.17,
            "Santé": 0.15,
            "Consommation défensive": 0.11,
            "Consommation cyclique": 0.10,
            "Technologie": 0.08,
            "Matériaux": 0.06,
            "Énergie": 0.05,
            "Services publics": 0.04,
            "Communication": 0.03,
            "Immobilier": 0.01,
        },
        "geo": {
            "Europe": 1.00,
        },
    },
    "russell2000": {
        "sectors": {
            "Industrie": 0.18,
            "Finance": 0.18,
            "Santé": 0.16,
            "Technologie": 0.14,
            "Consommation cyclique": 0.10,
            "Énergie": 0.06,
            "Immobilier": 0.06,
            "Matériaux": 0.05,
            "Consommation défensive": 0.03,
            "Services publics": 0.02,
            "Communication": 0.02,
        },
        "geo": {
            "États-Unis": 1.00,
        },
    },
    "japan": {
        "sectors": {
            "Industrie": 0.23,
            "Consommation cyclique": 0.18,
            "Technologie": 0.15,
            "Finance": 0.13,
            "Santé": 0.08,
            "Communication": 0.07,
            "Matériaux": 0.06,
            "Consommation défensive": 0.06,
            "Immobilier": 0.02,
            "Énergie": 0.01,
            "Services publics": 0.01,
        },
        "geo": {
            "Japon": 1.00,
        },
    },
}

_TICKER_TO_PROFILE: dict[str, str] = {
    "PUST.PA": "nasdaq100",
    "QQQ": "nasdaq100",
    "PANX.PA": "nasdaq100",
    "UST.PA": "nasdaq100",
    "ESE.PA": "sp500",
    "SPY": "sp500",
    "PE500.PA": "sp500",
    "CSPX.L": "sp500",
    "VOO": "sp500",
    "IVV": "sp500",
    "CW8.PA": "msci_world",
    "WPEA.PA": "msci_world",
    "EWLD.PA": "msci_world",
    "IWDA.AS": "msci_world",
    "SWDA.L": "msci_world",
    "VWCE.DE": "all_world",
    "VWRL.AS": "all_world",
    "ACWI": "all_world",
    "18MH.DU": "emerging",
    "PAEEM.PA": "emerging",
    "AEEM.PA": "emerging",
    "EEM": "emerging",
    "IEMG": "emerging",
    "PCEU.PA": "europe",
    "MEUD.PA": "europe",
    "EXSA.DE": "europe",
    "MSE.PA": "europe",
    "RS2K.PA": "russell2000",
    "IWM": "russell2000",
    "PTPXH.PA": "japan",
    "EWJ": "japan",
}

_KEYWORD_TO_PROFILE: tuple[tuple[tuple[str, ...], str], ...] = (
    (("nasdaq",), "nasdaq100"),
    (("s&p 500", "sp500", "sp 500"), "sp500"),
    (("all-world", "all world", "acwi"), "all_world"),
    (("msci world",), "msci_world"),
    (("emerging", "em.mkt", "em mkt", "em. market", "émergent"), "emerging"),
    (("stoxx", "europe", "cac 40", "euro stoxx"), "europe"),
    (("russell 2000",), "russell2000"),
    (("japan", "topix", "nikkei", "japon"), "japan"),
)


def get_etf_lookthrough(
    ticker: str,
    name: Optional[str] = None,
) -> tuple[Optional[dict[str, float]], Optional[dict[str, float]]]:
    """Return (sector_weights, geo_weights) for known ETFs or by fund name matching."""
    sym = str(ticker or "").strip().upper()
    profile_key = _TICKER_TO_PROFILE.get(sym)
    if profile_key is None and name:
        low_name = str(name).strip().lower()
        for keywords, key in _KEYWORD_TO_PROFILE:
            if any(kw in low_name for kw in keywords):
                profile_key = key
                break
    if profile_key is None:
        return None, None
    profile = ETF_INDEX_PROFILES[profile_key]
    return profile["sectors"], profile["geo"]
