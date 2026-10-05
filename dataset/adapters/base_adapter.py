"""
Base Benchmark Adapter for FundTraceAI.
Provides common header inspection, canonical schema mapping, unmapped column serialization,
and multi-currency FX normalization into canonical INR.
"""

import json
from typing import Dict, List, Optional, Union
import pandas as pd
import numpy as np

import sys
import os

# Ensure fx_config is imported correctly
try:
    from dataset.fx_config import STATIC_FX_TO_INR, normalize_currency_iso, normalize_amount_to_inr_batch
except ImportError:
    try:
        from fx_config import STATIC_FX_TO_INR, normalize_currency_iso, normalize_amount_to_inr_batch
    except ImportError:
        # Fallback if run standalone
        from ..fx_config import STATIC_FX_TO_INR, normalize_currency_iso, normalize_amount_to_inr_batch


class BaseBenchmarkAdapter:
    """
    Base class for benchmark dataset adapters.
    Inspects real CSV headers, resolves canonical schema mappings,
    packs unmapped columns into an 'extra' JSON column, and normalizes amounts to INR.
    """

    def __init__(self, name: str):
        self.name = name

    def inspect_headers(self, source: Union[str, pd.DataFrame]) -> List[str]:
        """
        Inspects real headers present in the CSV file or DataFrame.
        """
        if isinstance(source, pd.DataFrame):
            headers = source.columns.tolist()
        else:
            sample_df = pd.read_csv(source, nrows=5)
            headers = sample_df.columns.tolist()
        return headers

    def pack_unmapped_columns(self, raw_df: pd.DataFrame, mapped_raw_cols: List[str]) -> pd.Series:
        """
        Collects all columns from raw_df that were not mapped to canonical fields
        and serializes them into a JSON string per row in an 'extra' column.
        """
        unmapped_cols = [c for c in raw_df.columns if c not in mapped_raw_cols]
        if not unmapped_cols:
            return pd.Series(["{}"] * len(raw_df), index=raw_df.index)

        print(f"[{self.name}] Packing {len(unmapped_cols)} unmapped columns into 'extra': {unmapped_cols}")
        extra_df = raw_df[unmapped_cols].copy()
        
        # Convert any timestamp or non-serializable objects to strings
        for col in extra_df.columns:
            if pd.api.types.is_datetime64_any_dtype(extra_df[col]):
                extra_df[col] = extra_df[col].astype(str)

        # Vectorized JSON serialization
        records = extra_df.to_dict(orient='records')
        return pd.Series([json.dumps(r, default=str) for r in records], index=raw_df.index)

    def normalize_fx(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Ensures amount_inr is computed and present in canonical DataFrame.
        """
        if 'amount_inr' not in df.columns:
            amounts = df.get('amount', 0.0)
            currencies = df.get('currency', 'INR')
            df['amount_inr'] = normalize_amount_to_inr_batch(amounts, currencies)
        return df

    def convert(self, source: Union[str, pd.DataFrame], max_rows: Optional[int] = None) -> pd.DataFrame:
        """
        Converts the source benchmark dataset to the project's canonical schema.
        Must be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement convert()")
