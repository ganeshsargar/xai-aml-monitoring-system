"""
Foreign Exchange (FX) Conversion Configuration for FundTraceAI Dataset Module.
Re-exports canonical FX configuration.

Regulatory & Compliance Notice:
# verify against current rules (e.g. Reserve Bank of India (RBI) Reference Rates /
# Foreign Exchange Dealers' Association of India (FEDAI) published benchmark fixings)
"""

import sys
import os

# Ensure ml-service is accessible if running from dataset/
ml_service_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ml-service')
if ml_service_dir not in sys.path:
    sys.path.insert(0, ml_service_dir)

try:
    from fx_config import (
        STATIC_FX_TO_INR,
        CURRENCY_NAME_TO_ISO,
        get_fx_rate,
        normalize_currency_iso,
        normalize_amount_to_inr_batch
    )
except ImportError:
    # Standalone fallback if ml-service path cannot be resolved
    STATIC_FX_TO_INR = {
        'INR': 1.0,
        'USD': 83.50,
        'US DOLLAR': 83.50,
        'EUR': 90.75,
        'EURO': 90.75,
        'GBP': 105.60,
        'AED': 22.74,
        'SGD': 62.40,
        'CAD': 61.20,
        'AUD': 54.80,
        'JPY': 0.55,
        'CHF': 93.10,
        'CNY': 11.50,
        'HKD': 10.68,
        'SAR': 22.25,
        'QAR': 22.90,
        'RUB': 0.90,
        'BRL': 15.20,
        'ZAR': 4.50,
        'BITCOIN': 5500000.0,
        'BTC': 5500000.0,
        'ETH': 250000.0,
    }
    CURRENCY_NAME_TO_ISO = {
        'US DOLLAR': 'USD',
        'EURO': 'EUR',
        'UK POUND': 'GBP',
        'BITCOIN': 'BTC',
    }
    def get_fx_rate(currency: str) -> float:
        if not currency: return 1.0
        return STATIC_FX_TO_INR.get(str(currency).strip().upper(), 1.0)

    def normalize_currency_iso(currency: str) -> str:
        if not currency: return 'INR'
        clean = str(currency).strip().upper()
        return CURRENCY_NAME_TO_ISO.get(clean, clean)

    def normalize_amount_to_inr_batch(amounts, currencies):
        import pandas as pd
        amt_series = pd.to_numeric(amounts, errors='coerce').fillna(0.0)
        curr_series = pd.Series(currencies).astype(str).str.strip().str.upper()
        fx_rates = curr_series.map(STATIC_FX_TO_INR).fillna(1.0)
        return (amt_series * fx_rates).round(2)
