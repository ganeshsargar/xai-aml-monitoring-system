"""
SAML-D Dataset Adapter for FundTraceAI.
Loads and converts Synthetic Anti-Money Laundering Dataset (SAML-D)
into canonical schema, inspecting actual CSV headers and packing unmapped columns into 'extra'.
"""

import os
from typing import Optional, Union, List
import pandas as pd
import numpy as np

try:
    from dataset.adapters.base_adapter import BaseBenchmarkAdapter
    from dataset.fx_config import normalize_currency_iso, normalize_amount_to_inr_batch
except ImportError:
    try:
        from .base_adapter import BaseBenchmarkAdapter
        from ..fx_config import normalize_currency_iso, normalize_amount_to_inr_batch
    except ImportError:
        from base_adapter import BaseBenchmarkAdapter
        from fx_config import normalize_currency_iso, normalize_amount_to_inr_batch


class SamlDAdapter(BaseBenchmarkAdapter):
    """
    Adapter for SAML-D (Synthetic Anti-Money Laundering Dataset).
    Typical raw columns:
      - Time / Date (or Timestamp)
      - Sender_Account
      - Receiver_Account
      - Amount
      - Payment_currency
      - Received_currency
      - Sender_bank_location
      - Receiver_bank_location
      - Payment_type / Payment_format
      - Is_laundering
      - Laundering_type
    """

    def __init__(self):
        super().__init__(name="SAML-D-Adapter")

    def convert(self, source: Union[str, pd.DataFrame], max_rows: Optional[int] = None) -> pd.DataFrame:
        """
        Loads SAML-D transactions, inspects actual headers, maps to canonical schema,
        packs unmapped columns into 'extra', and calculates amount_inr.
        """
        # 1. Inspect real headers
        real_headers = self.inspect_headers(source)
        print(f"[{self.name}] Inspecting real headers ({len(real_headers)} columns): {real_headers}")

        header_lower_map = {str(h).strip().lower(): h for h in real_headers}
        mapped_raw_cols: List[str] = []

        # Timestamp / Date & Time handling
        date_col = header_lower_map.get('date')
        time_col = header_lower_map.get('time')
        timestamp_col = header_lower_map.get('timestamp') or header_lower_map.get('datetime')

        if date_col and time_col:
            mapped_raw_cols.extend([date_col, time_col])
        elif timestamp_col:
            mapped_raw_cols.append(timestamp_col)
        elif date_col:
            mapped_raw_cols.append(date_col)
        elif time_col:
            mapped_raw_cols.append(time_col)
        else:
            raise ValueError(f"[{self.name}] Could not find Date, Time, or Timestamp in headers: {real_headers}")

        # Sender account
        sender_col = None
        for candidate in ['sender_account', 'sender account', 'sender', 'from_account', 'from account']:
            if candidate in header_lower_map:
                sender_col = header_lower_map[candidate]
                break
        if not sender_col:
            raise ValueError(f"[{self.name}] Could not find sender account in headers: {real_headers}")
        mapped_raw_cols.append(sender_col)

        # Receiver account
        receiver_col = None
        for candidate in ['receiver_account', 'receiver account', 'receiver', 'to_account', 'to account']:
            if candidate in header_lower_map:
                receiver_col = header_lower_map[candidate]
                break
        if not receiver_col:
            raise ValueError(f"[{self.name}] Could not find receiver account in headers: {real_headers}")
        mapped_raw_cols.append(receiver_col)

        # Amount
        amount_col = None
        for candidate in ['amount', 'txn_amount', 'value', 'amount paid']:
            if candidate in header_lower_map:
                amount_col = header_lower_map[candidate]
                break
        if not amount_col:
            raise ValueError(f"[{self.name}] Could not find amount column in headers: {real_headers}")
        mapped_raw_cols.append(amount_col)

        # Currency (Prefer Payment_currency)
        curr_col = None
        for candidate in ['payment_currency', 'payment currency', 'currency', 'payment_curr']:
            if candidate in header_lower_map:
                curr_col = header_lower_map[candidate]
                mapped_raw_cols.append(curr_col)
                break

        # Payment Method / Type
        pay_type_col = None
        for candidate in ['payment_type', 'payment type', 'payment_format', 'payment format', 'payment_method']:
            if candidate in header_lower_map:
                pay_type_col = header_lower_map[candidate]
                mapped_raw_cols.append(pay_type_col)
                break

        # Country / Location
        country_col = None
        for candidate in ['sender_bank_location', 'sender bank location', 'sender_country', 'country']:
            if candidate in header_lower_map:
                country_col = header_lower_map[candidate]
                mapped_raw_cols.append(country_col)
                break

        # Label (is_laundering)
        label_col = None
        for candidate in ['is_laundering', 'is laundering', 'islaundering', 'is_fraud']:
            if candidate in header_lower_map:
                label_col = header_lower_map[candidate]
                mapped_raw_cols.append(label_col)
                break

        # Transaction ID if existing
        tx_id_col = None
        for candidate in ['transaction_id', 'transaction id', 'tx_id', 'id']:
            if candidate in header_lower_map:
                tx_id_col = header_lower_map[candidate]
                mapped_raw_cols.append(tx_id_col)
                break

        # 2. Read data
        if isinstance(source, pd.DataFrame):
            raw_df = source.copy()
            if max_rows:
                raw_df = raw_df.head(max_rows)
        else:
            print(f"[{self.name}] Reading CSV: {source} (max_rows={max_rows})...")
            raw_df = pd.read_csv(source, nrows=max_rows)

        print(f"[{self.name}] Loaded {len(raw_df):,} raw rows. Translating to canonical schema...")

        # 3. Pack unmapped columns into 'extra' JSON column
        # Note: 'Laundering_type', 'Received_currency', 'Receiver_bank_location' etc. are preserved here!
        extra_series = self.pack_unmapped_columns(raw_df, mapped_raw_cols)

        # 4. Parse timestamps cleanly
        if date_col and time_col:
            dt_series = pd.to_datetime(
                raw_df[date_col].astype(str) + ' ' + raw_df[time_col].astype(str),
                errors='coerce'
            )
        elif timestamp_col:
            dt_series = pd.to_datetime(raw_df[timestamp_col], errors='coerce')
        elif date_col:
            dt_series = pd.to_datetime(raw_df[date_col], errors='coerce')
        else:
            dt_series = pd.to_datetime(raw_df[time_col], errors='coerce')

        if dt_series.isna().all():
            # Fallback if unparseable
            dt_series = pd.date_range(start='2025-01-01', periods=len(raw_df), freq='5min')

        # 5. Build canonical DataFrame
        if tx_id_col:
            tx_ids = raw_df[tx_id_col].astype(str)
        else:
            tx_ids = pd.Series([f"TX_SAMLD_{i:07d}" for i in range(len(raw_df))], index=raw_df.index)

        amounts = pd.to_numeric(raw_df[amount_col], errors='coerce').fillna(0.0)

        if curr_col:
            raw_currencies = raw_df[curr_col].astype(str)
            iso_currencies = raw_currencies.apply(normalize_currency_iso)
        else:
            raw_currencies = pd.Series(['USD'] * len(raw_df), index=raw_df.index)
            iso_currencies = raw_currencies

        payment_methods = (
            raw_df[pay_type_col].astype(str)
            if pay_type_col else pd.Series(['Electronic Transfer'] * len(raw_df), index=raw_df.index)
        )

        countries = (
            raw_df[country_col].astype(str)
            if country_col else pd.Series(['US'] * len(raw_df), index=raw_df.index)
        )

        labels = (
            pd.to_numeric(raw_df[label_col], errors='coerce').fillna(0).astype(int)
            if label_col else pd.Series([0] * len(raw_df), index=raw_df.index)
        )

        canonical_df = pd.DataFrame({
            'transaction_id': tx_ids,
            'timestamp': dt_series,
            'sender_account': raw_df[sender_col].astype(str),
            'receiver_account': raw_df[receiver_col].astype(str),
            'amount': amounts,
            'currency': iso_currencies,
            'country': countries,
            'city': 'Metropolis',
            'payment_method': payment_methods,
            'category': 'Transfer',
            'merchant': 'Interbank Transaction',
            'status': 'Approved',
            'is_laundering': labels,
            'extra': extra_series
        })

        # 6. Apply multi-currency FX normalization to amount_inr
        canonical_df['amount_inr'] = normalize_amount_to_inr_batch(amounts, raw_currencies)

        print(f"[{self.name}] Canonical conversion completed: {len(canonical_df):,} records.")
        print(f"[{self.name}] Laundering rate: {canonical_df['is_laundering'].mean():.2%}")
        return canonical_df


def load_saml_d(source: Union[str, pd.DataFrame], max_rows: Optional[int] = None) -> pd.DataFrame:
    """
    Public loader helper function to convert SAML-D transactions to canonical schema.
    """
    adapter = SamlDAdapter()
    return adapter.convert(source, max_rows=max_rows)
