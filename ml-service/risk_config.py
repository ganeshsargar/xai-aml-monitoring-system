"""
FundTraceAI AML Risk Configuration Loader (Python).
Single source of truth loaded dynamically from config/risk_config.json.

Regulatory & Compliance Notice:
# verify against current rules (e.g. RBI Master Directions / FIU-IND Guidelines / PMLA 2002 / FATF Recommendations)
"""

import os
import json
from typing import Dict, List, Set, Tuple, Optional, Any

# Resolve path to config/risk_config.json at project root
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RISK_CONFIG_PATH = os.path.join(ROOT_DIR, 'config', 'risk_config.json')

_CACHED_CONFIG: Optional[Dict[str, Any]] = None
_LAST_MTIME: float = 0.0


def load_risk_config(force_reload: bool = False) -> Dict[str, Any]:
    """
    Loads risk configuration from config/risk_config.json.
    Automatically reloads if the file has been modified on disk.
    """
    global _CACHED_CONFIG, _LAST_MTIME

    if not os.path.exists(RISK_CONFIG_PATH):
        raise FileNotFoundError(f"Risk configuration file not found at: {RISK_CONFIG_PATH}")

    mtime = os.path.getmtime(RISK_CONFIG_PATH)
    if force_reload or _CACHED_CONFIG is None or mtime > _LAST_MTIME:
        with open(RISK_CONFIG_PATH, 'r', encoding='utf-8') as f:
            _CACHED_CONFIG = json.load(f)
        _LAST_MTIME = mtime

    return _CACHED_CONFIG


def get_high_risk_countries() -> List[str]:
    """Returns list of high-risk jurisdiction ISO codes from config."""
    config = load_risk_config()
    return list(config.get('high_risk_jurisdictions', {}).keys())


def get_high_risk_jurisdictions() -> Dict[str, Dict[str, str]]:
    """Returns the full dictionary of high-risk jurisdictions with metadata."""
    config = load_risk_config()
    return config.get('high_risk_jurisdictions', {})


def get_ctr_threshold() -> float:
    """Returns the Cash Transaction Report (CTR) threshold from config."""
    config = load_risk_config()
    return float(config.get('ctr_threshold', 1000000.0))


def get_structuring_bounds() -> Tuple[float, float]:
    """
    Computes structuring lower and upper bounds dynamically from the CTR threshold
    and structuring band percentages defined in config.
    """
    config = load_risk_config()
    ctr = get_ctr_threshold()
    band = config.get('structuring_band', {'min_percent': 82.0, 'max_percent': 99.9})
    lower = (ctr * float(band.get('min_percent', 82.0))) / 100.0
    upper = (ctr * float(band.get('max_percent', 99.9))) / 100.0
    return (lower, upper)


def get_large_amount_threshold() -> float:
    """Returns large amount transfer threshold from config."""
    config = load_risk_config()
    return float(config.get('large_amount_threshold', 500000.0))


def get_night_hours() -> Set[int]:
    """Returns the set of off-hours hour integers from config."""
    config = load_risk_config()
    return set(config.get('night_hours', [22, 23, 0, 1, 2, 3, 4, 5]))


def get_high_risk_payment_methods() -> List[str]:
    """Returns the list of high-risk payment methods from config."""
    config = load_risk_config()
    return list(config.get('high_risk_payment_methods', ['Crypto Transfer', 'Cash Deposit', 'RTGS']))


def get_alert_level_cutoffs() -> Dict[str, float]:
    """Returns alert level cutoffs dictionary {critical, high, medium, low}."""
    config = load_risk_config()
    return config.get('alert_level_cutoffs', {'critical': 80, 'high': 60, 'medium': 35, 'low': 20})


def get_alert_level(risk_score: float) -> Optional[str]:
    """Calculates alert severity level based on configured cutoffs."""
    cutoffs = get_alert_level_cutoffs()
    if risk_score >= cutoffs.get('critical', 80):
        return 'Critical'
    if risk_score >= cutoffs.get('high', 60):
        return 'High'
    if risk_score >= cutoffs.get('medium', 35):
        return 'Medium'
    if risk_score >= cutoffs.get('low', 20):
        return 'Low'
    return None


def get_jurisdiction_description(country_code: str) -> Optional[str]:
    """Returns formatted reason string for a jurisdiction using its config label and source."""
    jurisdictions = get_high_risk_jurisdictions()
    meta = jurisdictions.get(country_code)
    if not meta:
        return None
    name = meta.get('name', country_code)
    label = meta.get('label', 'High-Risk Jurisdiction')
    source = meta.get('source', 'AML Regulatory Watchlist')
    return f"{name} ({label}) — flagged under {source}"

