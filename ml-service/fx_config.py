"""
Foreign Exchange (FX) Conversion Configuration for FundTraceAI.
Maps international and digital currencies to INR for canonical AML normalization.

Regulatory & Compliance Notice:
# verify against current rules (e.g. Reserve Bank of India (RBI) Reference Rates /
# Foreign Exchange Dealers' Association of India (FEDAI) published benchmark fixings)
"""

from typing import Dict, Union
import pandas as pd
import numpy as np


# Static FX Rates against INR (Base Currency: INR = 1.0)
# verify against current rules (RBI reference rates / FEDAI benchmark fixings)
STATIC_FX_TO_INR: Dict[str, float] = {
    'INR': 1.0,
    'RUPEE': 1.0,
    'INDIAN RUPEE': 1.0,
    'USD': 83.50,
    'US DOLLAR': 83.50,
    'EUR': 90.75,
    'EURO': 90.75,
    'GBP': 105.60,
    'UK POUND': 105.60,
    'POUND': 105.60,
    'AED': 22.74,
    'UAE DIRHAM': 22.74,
    'DIRHAM': 22.74,
    'SGD': 62.40,
    'SINGAPORE DOLLAR': 62.40,
    'CAD': 61.20,
    'CANADIAN DOLLAR': 61.20,
    'AUD': 54.80,
    'AUSTRALIAN DOLLAR': 54.80,
    'JPY': 0.55,
    'YEN': 0.55,
    'JAPANESE YEN': 0.55,
    'CHF': 93.10,
    'SWISS FRANC': 93.10,
    'CNY': 11.50,
    'CHINESE YUAN': 11.50,
    'HKD': 10.68,
    'HONG KONG DOLLAR': 10.68,
    'SAR': 22.25,
    'SAUDI RIYAL': 22.25,
    'QAR': 22.90,
    'QATARI RIYAL': 22.90,
    'RUB': 0.90,
    'RUSSIAN RUBLE': 0.90,
    'RUBLE': 0.90,
    'BRL': 15.20,
    'BRAZILIAN REAL': 15.20,
    'ZAR': 4.50,
    'SOUTH AFRICAN RAND': 4.50,
    'BITCOIN': 5500000.0,
    'BTC': 5500000.0,
    'ETH': 250000.0,
    'ETHEREUM': 250000.0,
}

# Mapping common verbose currency names to standard ISO 4217 three-letter codes
CURRENCY_NAME_TO_ISO: Dict[str, str] = {
    'US DOLLAR': 'USD',
    'EURO': 'EUR',
    'UK POUND': 'GBP',
    'POUND': 'GBP',
    'UAE DIRHAM': 'AED',
    'DIRHAM': 'AED',
    'SINGAPORE DOLLAR': 'SGD',
    'CANADIAN DOLLAR': 'CAD',
    'AUSTRALIAN DOLLAR': 'AUD',
    'YEN': 'JPY',
    'JAPANESE YEN': 'JPY',
    'SWISS FRANC': 'CHF',
    'CHINESE YUAN': 'CNY',
    'HONG KONG DOLLAR': 'HKD',
    'SAUDI RIYAL': 'SAR',
    'QATARI RIYAL': 'QAR',
    'RUSSIAN RUBLE': 'RUB',
    'RUBLE': 'RUB',
    'BRAZILIAN REAL': 'BRL',
    'SOUTH AFRICAN RAND': 'ZAR',
    'INDIAN RUPEE': 'INR',
    'RUPEE': 'INR',
    'BITCOIN': 'BTC',
    'ETHEREUM': 'ETH',
}


def get_fx_rate(currency: str) -> float:
    """
    Returns the exchange rate to INR for the specified currency.
    Defaults to 1.0 (assuming INR or 1:1) if unrecognized.
    """
    if not currency or pd.isna(currency):
        return 1.0
    key = str(currency).strip().upper()
    return STATIC_FX_TO_INR.get(key, 1.0)


def normalize_currency_iso(currency: str) -> str:
    """
    Normalizes a currency string to standard ISO 4217 code if known.
    """
    if not currency or pd.isna(currency):
        return 'INR'
    clean = str(currency).strip().upper()
    return CURRENCY_NAME_TO_ISO.get(clean, clean)


def normalize_amount_to_inr_batch(amounts: Union[pd.Series, np.ndarray], currencies: Union[pd.Series, np.ndarray]) -> pd.Series:
    """
    Vectorized conversion of transaction amounts in diverse currencies to canonical INR.
    """
    amt_series = pd.to_numeric(amounts, errors='coerce').fillna(0.0)
    curr_series = pd.Series(currencies).astype(str).str.strip().str.upper()
    fx_rates = curr_series.map(STATIC_FX_TO_INR).fillna(1.0)
    return (amt_series * fx_rates).round(2)
