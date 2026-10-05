"""
IBM AML Dataset Adapter for FundTraceAI.
Loads and converts IBM Transactions for Anti-Money Laundering (AMLworld / HI-Small / LI-Small)
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


class IbmAmlAdapter(BaseBenchmarkAdapter):
    """
    Adapter for IBM AML synthetic benchmarks (HI-Small, LI-Small, AMLworld).
    Standard raw columns:
      - Timestamp
      - From Bank
      - Account (Sender)
      - To Bank
      - Account.1 (Receiver)
      - Amount Received
      - Receiving Currency
      - Amount Paid
      - Payment Currency
      - Payment Format
      - Is Laundering
    """

    def __init__(self):
        super().__init__(name="IBM-AML-Adapter")

    def convert(self, source: Union[str, pd.DataFrame], max_rows: Optional[int] = None) -> pd.DataFrame:
        """
        Loads IBM AML transactions, inspects actual headers, maps to canonical schema,
        packs unmapped columns into 'extra', and calculates amount_inr.
        """
        # 1. Inspect real headers
        real_headers = self.inspect_headers(source)
        print(f"[{self.name}] Inspecting real headers ({len(real_headers)} columns): {real_headers}")

        header_lower_map = {str(h).strip().lower(): h for h in real_headers}

        # 2. Map canonical fields strictly from detected real headers
        mapped_raw_cols: List[str] = []

        # Timestamp
        ts_col = None
        for candidate in ['timestamp', 'date', 'time', 'datetime']:
            if candidate in header_lower_map:
                ts_col = header_lower_map[candidate]
                break
        if not ts_col:
            raise ValueError(f"[{self.name}] Could not find Timestamp column in headers: {real_headers}")
        mapped_raw_cols.append(ts_col)

        # Sender account
        sender_col = None
        if 'account' in header_lower_map:
            sender_col = header_lower_map['account']
        elif 'from account' in header_lower_map:
            sender_col = header_lower_map['from account']
        elif 'from_account' in header_lower_map:
            sender_col = header_lower_map['from_account']
        elif 'sender_account' in header_lower_map:
            sender_col = header_lower_map['sender_account']
        if not sender_col:
            raise ValueError(f"[{self.name}] Could not find sender account column in headers: {real_headers}")
        mapped_raw_cols.append(sender_col)

        # Receiver account
        receiver_col = None
        if 'account.1' in header_lower_map:
            receiver_col = header_lower_map['account.1']
        elif 'to account' in header_lower_map:
            receiver_col = header_lower_map['to account']
        elif 'to_account' in header_lower_map:
            receiver_col = header_lower_map['to_account']
        elif 'receiver_account' in header_lower_map:
            receiver_col = header_lower_map['receiver_account']
        if not receiver_col:
            raise ValueError(f"[{self.name}] Could not find receiver account column in headers: {real_headers}")
        mapped_raw_cols.append(receiver_col)

        # Amount (Prefer 'Amount Paid', fallback to 'Amount' or 'Amount Received')
        amount_col = None
        for candidate in ['amount paid', 'amount', 'amount received', 'value', 'txn_amount']:
            if candidate in header_lower_map:
                amount_col = header_lower_map[candidate]
                break
        if not amount_col:
            raise ValueError(f"[{self.name}] Could not find amount column in headers: {real_headers}")
        mapped_raw_cols.append(amount_col)

        # Currency (Prefer 'Payment Currency', fallback to 'Receiving Currency' or 'Currency')
        curr_col = None
        for candidate in ['payment currency', 'receiving currency', 'currency', 'payment_currency']:
            if candidate in header_lower_map:
                curr_col = header_lower_map[candidate]
                break
        if not curr_col:
            print(f"[{self.name}] Warning: Currency column not found. Defaulting to 'USD'.")
        else:
            mapped_raw_cols.append(curr_col)

        # Payment Method / Format
        payment_format_col = None
        for candidate in ['payment format', 'payment_format', 'payment type', 'payment_type', 'payment_method']:
            if candidate in header_lower_map:
                payment_format_col = header_lower_map[candidate]
                mapped_raw_cols.append(payment_format_col)
                break

        # Is Laundering label
        label_col = None
        for candidate in ['is laundering', 'is_laundering', 'islaundering', 'is fraud', 'is_fraud']:
            if candidate in header_lower_map:
                label_col = header_lower_map[candidate]
                mapped_raw_cols.append(label_col)
                break

        # Transaction ID if already present
        tx_id_col = None
        for candidate in ['transaction_id', 'transaction id', 'tx_id', 'id']:
            if candidate in header_lower_map:
                tx_id_col = header_lower_map[candidate]
                mapped_raw_cols.append(tx_id_col)
                break

        # 3. Read data
        if isinstance(source, pd.DataFrame):
            raw_df = source.copy()
            if max_rows:
                raw_df = raw_df.head(max_rows)
        else:
            print(f"[{self.name}] Reading CSV: {source} (max_rows={max_rows})...")
            raw_df = pd.read_csv(source, nrows=max_rows)

        print(f"[{self.name}] Loaded {len(raw_df):,} raw rows. Translating to canonical schema...")

        # 4. Pack unmapped columns into 'extra' JSON column
        extra_series = self.pack_unmapped_columns(raw_df, mapped_raw_cols)

        # 5. Build canonical DataFrame
        if tx_id_col:
            transaction_ids = raw_df[tx_id_col].astype(str)
        else:
            transaction_ids = pd.Series([f"TX_IBM_{i:07d}" for i in range(len(raw_df))], index=raw_df.index)

        amounts = pd.to_numeric(raw_df[amount_col], errors='coerce').fillna(0.0)

        if curr_col:
            raw_currencies = raw_df[curr_col].astype(str)
            iso_currencies = raw_currencies.apply(normalize_currency_iso)
        else:
            raw_currencies = pd.Series(['USD'] * len(raw_df), index=raw_df.index)
            iso_currencies = raw_currencies

        payment_methods = (
            raw_df[payment_format_col].astype(str)
            if payment_format_col else pd.Series(['Wire Transfer'] * len(raw_df), index=raw_df.index)
        )

        labels = (
            pd.to_numeric(raw_df[label_col], errors='coerce').fillna(0).astype(int)
            if label_col else pd.Series([0] * len(raw_df), index=raw_df.index)
        )

        canonical_df = pd.DataFrame({
            'transaction_id': transaction_ids,
            'timestamp': pd.to_datetime(raw_df[ts_col]),
            'sender_account': raw_df[sender_col].astype(str),
            'receiver_account': raw_df[receiver_col].astype(str),
            'amount': amounts,
            'currency': iso_currencies,
            'country': 'US',
            'city': 'New York',
            'payment_method': payment_methods,
            'category': 'Transfer',
            'merchant': 'Interbank Clearing',
            'status': 'Approved',
            'is_laundering': labels,
            'extra': extra_series
        })

        # 6. Apply multi-currency FX normalization to amount_inr
        canonical_df['amount_inr'] = normalize_amount_to_inr_batch(amounts, raw_currencies)

        print(f"[{self.name}] Canonical conversion completed: {len(canonical_df):,} records.")
        print(f"[{self.name}] Laundering rate: {canonical_df['is_laundering'].mean():.2%}")
        return canonical_df


def load_ibm_aml(source: Union[str, pd.DataFrame], max_rows: Optional[int] = None) -> pd.DataFrame:
    """
    Public loader helper function to convert IBM AML transactions to canonical schema.
    """
    adapter = IbmAmlAdapter()
    return adapter.convert(source, max_rows=max_rows)
