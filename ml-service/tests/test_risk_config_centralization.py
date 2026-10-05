"""
test_risk_config_centralization.py
Verification test asserting that config/risk_config.json is the single source of truth
for high-risk jurisdictions, thresholds, structuring bands, and cutoffs.
"""

import json
import re
from pathlib import Path
import pytest
import risk_config


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = REPO_ROOT / "config" / "risk_config.json"


def test_risk_config_json_schema():
    """Verify that config/risk_config.json contains all required regulatory fields."""
    assert CONFIG_PATH.exists(), f"Configuration file {CONFIG_PATH} does not exist!"

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    # 1. High risk jurisdictions
    assert "high_risk_jurisdictions" in cfg
    jurisdictions = cfg["high_risk_jurisdictions"]
    assert isinstance(jurisdictions, dict)
    assert len(jurisdictions) > 0

    for code, info in jurisdictions.items():
        assert len(code) == 2, f"Country code '{code}' should be ISO-2."
        assert "name" in info, f"Missing 'name' in jurisdiction '{code}'."
        assert "label" in info, f"Missing 'label' in jurisdiction '{code}'."
        assert "source" in info, f"Missing 'source' in jurisdiction '{code}'."
        assert "last_reviewed" in info, f"Missing 'last_reviewed' in jurisdiction '{code}'."
        # Date format YYYY-MM-DD
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", info["last_reviewed"]), (
            f"Invalid last_reviewed date format in {code}: {info['last_reviewed']}"
        )

    # 2. CTR threshold
    assert "ctr_threshold" in cfg
    assert isinstance(cfg["ctr_threshold"], (int, float))
    assert cfg["ctr_threshold"] > 0

    # 3. Structuring band
    assert "structuring_band" in cfg
    band = cfg["structuring_band"]
    assert "min_percent" in band and "max_percent" in band
    assert 0 < band["min_percent"] < band["max_percent"] <= 100

    # 4. Night hours
    assert "night_hours" in cfg
    assert isinstance(cfg["night_hours"], list)
    assert len(cfg["night_hours"]) > 0
    assert all(0 <= h <= 23 for h in cfg["night_hours"])

    # 5. High-risk payment methods
    assert "high_risk_payment_methods" in cfg
    assert isinstance(cfg["high_risk_payment_methods"], list)
    assert len(cfg["high_risk_payment_methods"]) > 0

    # 6. Alert level cutoffs
    assert "alert_level_cutoffs" in cfg
    cutoffs = cfg["alert_level_cutoffs"]
    assert all(k in cutoffs for k in ["critical", "high", "medium", "low"])
    assert cutoffs["critical"] > cutoffs["high"] > cutoffs["medium"] > cutoffs["low"]


def test_python_risk_config_loader():
    """Verify the Python loader correctly derives thresholds and labels."""
    cfg = risk_config.load_risk_config()
    assert cfg is not None

    ctr = risk_config.get_ctr_threshold()
    assert ctr > 0

    lower, upper = risk_config.get_structuring_bounds()
    assert lower < upper
    assert lower == (ctr * cfg["structuring_band"]["min_percent"]) / 100.0
    assert upper == (ctr * cfg["structuring_band"]["max_percent"]) / 100.0

    countries = risk_config.get_high_risk_countries()
    assert isinstance(countries, (list, set))
    assert len(countries) > 0

    jurisdictions = risk_config.get_high_risk_jurisdictions()
    for code in countries:
        desc = risk_config.get_jurisdiction_description(code)
        assert jurisdictions[code]["label"] in desc
        assert jurisdictions[code]["source"] in desc

    cutoffs = risk_config.get_alert_level_cutoffs()
    assert risk_config.get_alert_level(cutoffs["critical"] + 5) == "Critical"
    assert risk_config.get_alert_level(cutoffs["high"] + 5) == "High"
    assert risk_config.get_alert_level(cutoffs["medium"] + 5) == "Medium"
    assert risk_config.get_alert_level(cutoffs["low"] + 5) == "Low"
    assert risk_config.get_alert_level(cutoffs["low"] - 5) is None


def test_no_hardcoded_values_in_source_files():
    """
    Grep-based test scanning all core implementation files to guarantee that
    regulatory country lists, structuring bands, and cutoffs are NOT hardcoded.
    """
    source_files = [
        REPO_ROOT / "ml-service" / "train.py",
        REPO_ROOT / "ml-service" / "app.py",
        REPO_ROOT / "ml-service" / "features.py",
        REPO_ROOT / "ml-service" / "benchmark_features.py",
        REPO_ROOT / "dataset" / "generate_dataset.py",
        REPO_ROOT / "backend" / "src" / "controllers" / "transactionController.js",
        REPO_ROOT / "backend" / "src" / "controllers" / "uploadController.js",
        REPO_ROOT / "backend" / "src" / "controllers" / "caseController.js",
        REPO_ROOT / "backend" / "src" / "config" / "db.js",
    ]

    for file_path in source_files:
        assert file_path.exists(), f"Target source file {file_path} missing!"
        content = file_path.read_text(encoding="utf-8")

        # 1. No hardcoded old structuring literals
        assert "820000" not in content, f"Found hardcoded 820000 in {file_path.name}!"
        assert "999000" not in content, f"Found hardcoded 999000 in {file_path.name}!"
        assert "820_000" not in content, f"Found hardcoded 820_000 in {file_path.name}!"
        assert "999_000" not in content, f"Found hardcoded 999_000 in {file_path.name}!"

        # 2. No claims of 'FATF grey-listed'
        assert "FATF grey-listed" not in content, (
            f"Found unverified claim 'FATF grey-listed' in {file_path.name}!"
        )
        assert "FATF grey list" not in content.lower() or "verify against current rules" in content.lower(), (
            f"Found unverified claim 'FATF grey list' in {file_path.name}!"
        )

        # 3. No hardcoded lists of jurisdiction arrays
        assert "['KY', 'PA', 'AE', 'RU', 'BS', 'LU']" not in content, (
            f"Found hardcoded jurisdiction list in {file_path.name}!"
        )
        assert "['KY', 'PA'" not in content, (
            f"Found hardcoded jurisdiction list in {file_path.name}!"
        )

        # 4. No hardcoded cutoffs ternary chains like '>= 80 ?'
        assert ">= 80 ?" not in content, (
            f"Found hardcoded cutoff '>= 80 ?' in {file_path.name}!"
        )
        assert ">= 60 ?" not in content, (
            f"Found hardcoded cutoff '>= 60 ?' in {file_path.name}!"
        )
