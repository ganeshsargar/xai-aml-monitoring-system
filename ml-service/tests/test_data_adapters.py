"""
Unit tests for realistic data generation, benchmark adapters (IBM AML & SAML-D),
multi-currency FX normalization, and unified data loader.
"""

import os
import json
import pytest
import pandas as pd
import numpy as np

import sys
repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from dataset.generate_dataset import generate_aml_data
from dataset.fx_config import (
    STATIC_FX_TO_INR,
    get_fx_rate,
    normalize_currency_iso,
    normalize_amount_to_inr_batch
)
from dataset.adapters.ibm_aml_adapter import IbmAmlAdapter, load_ibm_aml
from dataset.adapters.saml_d_adapter import SamlDAdapter, load_saml_d
from data_loader import load_dataset, SUPPORTED_DATASETS


# ── 1. Generator & Laundering Rate Scaling Tests ──────────────────────────────

def test_generate_dataset_laundering_rate_scaling(tmp_path):
    """
    Verifies that --laundering-rate scales typology volumes proportionally
    and produces both dataset.csv and customers.csv.
    """
    out_dir = str(tmp_path)
    df = generate_aml_data(
        num_records=1000,
        laundering_rate=0.02,
        label_noise=False,
        output_dir=out_dir,
        seed=123
    )

    assert len(df) == 1000
    # For rate 0.02 of 1000 txs, target is 20
    actual_laundering = int(df['is_laundering'].sum())
    assert 15 <= actual_laundering <= 25, f"Expected ~20 laundering txs, got {actual_laundering}"

    # Verify files created
    assert os.path.exists(os.path.join(out_dir, 'dataset.csv'))
    assert os.path.exists(os.path.join(out_dir, 'customers.csv'))

    # Verify customer table schema
    cust_df = pd.read_csv(os.path.join(out_dir, 'customers.csv'))
    expected_cust_cols = {
        'account_number', 'customer_name', 'risk_tier', 'occupation',
        'base_city', 'is_previously_flagged', 'is_pep', 'kyc_status', 'account_created_at'
    }
    assert expected_cust_cols.issubset(set(cust_df.columns))
    assert len(cust_df) > 0


def test_generate_dataset_bounds_validation():
    """
    Verifies that laundering rate validation enforces 0.003 to 0.08 bounds.
    """
    with pytest.raises(ValueError):
        generate_aml_data(num_records=500, laundering_rate=0.001)

    with pytest.raises(ValueError):
        generate_aml_data(num_records=500, laundering_rate=0.15)


def test_generate_dataset_label_noise(tmp_path):
    """
    Verifies label noise execution without errors.
    """
    out_dir = str(tmp_path)
    df_clean = generate_aml_data(num_records=1000, laundering_rate=0.04, label_noise=False, output_dir=out_dir, seed=42)
    df_noisy = generate_aml_data(num_records=1000, laundering_rate=0.04, label_noise=True, output_dir=out_dir, seed=42)

    assert len(df_clean) == 1000
    assert len(df_noisy) == 1000
    # Both must have is_laundering in [0, 1]
    assert set(df_noisy['is_laundering'].unique()).issubset({0, 1})


# ── 2. Multi-Currency FX Normalization Tests ─────────────────────────────────

def test_fx_conversion_rates():
    """
    Verifies that static FX rates convert foreign currencies accurately to INR.
    """
    assert get_fx_rate('INR') == 1.0
    assert get_fx_rate('USD') == 83.50
    assert get_fx_rate('EUR') == 90.75
    assert get_fx_rate('GBP') == 105.60
    assert get_fx_rate('UNKNOWN_CURR') == 1.0

    assert normalize_currency_iso('US Dollar') == 'USD'
    assert normalize_currency_iso('Euro') == 'EUR'
    assert normalize_currency_iso('UK Pound') == 'GBP'


def test_vectorized_amount_to_inr():
    """
    Verifies batch vectorized conversion of amounts.
    """
    amounts = pd.Series([100.0, 50.0, 1000.0, 10.0])
    currencies = pd.Series(['USD', 'EUR', 'INR', 'GBP'])
    inr_amounts = normalize_amount_to_inr_batch(amounts, currencies)

    assert inr_amounts.iloc[0] == pytest.approx(8350.0)    # 100 * 83.5
    assert inr_amounts.iloc[1] == pytest.approx(4537.5)    # 50 * 90.75
    assert inr_amounts.iloc[2] == pytest.approx(1000.0)    # 1000 * 1.0
    assert inr_amounts.iloc[3] == pytest.approx(1056.0)    # 10 * 105.6


# ── 3. IBM AML Benchmark Adapter Tests ────────────────────────────────────────

def test_ibm_aml_adapter_conversion():
    """
    Verifies that IBM AML headers are correctly inspected, translated to canonical schema,
    multi-currency amounts converted to INR, and unmapped columns preserved in 'extra'.
    """
    sample_raw = pd.DataFrame({
        'Timestamp': ['2025/08/01 10:30', '2025/08/01 11:45'],
        'From Bank': [101, 102],
        'Account': ['ACC_IBM_01', 'ACC_IBM_02'],
        'To Bank': [201, 202],
        'Account.1': ['ACC_IBM_99', 'ACC_IBM_88'],
        'Amount Received': [1200.0, 50000.0],
        'Receiving Currency': ['US Dollar', 'Euro'],
        'Amount Paid': [1200.0, 50000.0],
        'Payment Currency': ['US Dollar', 'Euro'],
        'Payment Format': ['Wire', 'ACH'],
        'Is Laundering': [0, 1]
    })

    adapter = IbmAmlAdapter()
    canonical_df = adapter.convert(sample_raw)

    # Check canonical required columns
    required_cols = [
        'transaction_id', 'timestamp', 'sender_account', 'receiver_account',
        'amount', 'currency', 'is_laundering', 'amount_inr', 'extra'
    ]
    for col in required_cols:
        assert col in canonical_df.columns, f"Missing canonical col: {col}"

    assert canonical_df['sender_account'].iloc[0] == 'ACC_IBM_01'
    assert canonical_df['receiver_account'].iloc[0] == 'ACC_IBM_99'
    assert canonical_df['currency'].iloc[0] == 'USD'
    assert canonical_df['currency'].iloc[1] == 'EUR'
    assert canonical_df['amount_inr'].iloc[0] == pytest.approx(1200.0 * 83.50)
    assert canonical_df['is_laundering'].tolist() == [0, 1]

    # Verify unmapped columns are packed in 'extra'
    extra_row_0 = json.loads(canonical_df['extra'].iloc[0])
    assert 'From Bank' in extra_row_0 and extra_row_0['From Bank'] == 101
    assert 'To Bank' in extra_row_0 and extra_row_0['To Bank'] == 201
    assert 'Amount Received' in extra_row_0


# ── 4. SAML-D Benchmark Adapter Tests ─────────────────────────────────────────

def test_saml_d_adapter_conversion():
    """
    Verifies that SAML-D headers are correctly inspected, translated to canonical schema,
    amounts converted to INR, and unmapped columns (e.g. Laundering_type) packed into 'extra'.
    """
    sample_raw = pd.DataFrame({
        'Date': ['2025-09-01', '2025-09-02'],
        'Time': ['14:20:00', '18:30:15'],
        'Sender_Account': ['SAML_ACC_100', 'SAML_ACC_200'],
        'Receiver_Account': ['SAML_ACC_800', 'SAML_ACC_900'],
        'Amount': [5000.0, 150000.0],
        'Payment_currency': ['USD', 'GBP'],
        'Received_currency': ['USD', 'GBP'],
        'Sender_bank_location': ['US', 'GB'],
        'Receiver_bank_location': ['CA', 'KY'],
        'Payment_type': ['Wire Transfer', 'Cash Deposit'],
        'Is_laundering': [0, 1],
        'Laundering_type': ['Normal', 'Smurfing / Structuring']
    })

    adapter = SamlDAdapter()
    canonical_df = adapter.convert(sample_raw)

    assert len(canonical_df) == 2
    assert canonical_df['sender_account'].iloc[1] == 'SAML_ACC_200'
    assert canonical_df['receiver_account'].iloc[1] == 'SAML_ACC_900'
    assert canonical_df['country'].iloc[1] == 'GB'
    assert canonical_df['payment_method'].iloc[1] == 'Cash Deposit'
    assert canonical_df['amount_inr'].iloc[0] == pytest.approx(5000.0 * 83.50)
    assert canonical_df['amount_inr'].iloc[1] == pytest.approx(150000.0 * 105.60)
    assert canonical_df['is_laundering'].tolist() == [0, 1]

    # Verify unmapped columns are packed in 'extra'
    extra_row_1 = json.loads(canonical_df['extra'].iloc[1])
    assert 'Laundering_type' in extra_row_1
    assert extra_row_1['Laundering_type'] == 'Smurfing / Structuring'
    assert 'Receiver_bank_location' in extra_row_1


# ── 5. Unified Data Loader Tests ─────────────────────────────────────────────

def test_load_dataset_synthetic():
    """
    Verifies that load_dataset('synthetic') works out-of-the-box and ensures
    amount_inr, timestamp datetime, and is_laundering columns are present.
    """
    df = load_dataset('synthetic', max_rows=100)
    assert len(df) <= 100
    assert 'amount_inr' in df.columns
    assert 'is_laundering' in df.columns
    assert pd.api.types.is_datetime64_any_dtype(df['timestamp'])


def test_load_dataset_missing_benchmark_error():
    """
    Verifies that requesting ibm_aml or saml_d when raw files are not placed
    raises an informative FileNotFoundError with download instructions.
    """
    with pytest.raises(FileNotFoundError) as exc_info:
        load_dataset('ibm_aml', dataset_path='non_existent_ibm.csv')
    assert "Download HI-Small_Trans.csv" in str(exc_info.value)

    with pytest.raises(FileNotFoundError) as exc_info:
        load_dataset('saml_d', dataset_path='non_existent_samld.csv')
    assert "Download SAML-D.csv" in str(exc_info.value)


def test_load_dataset_unsupported_name():
    """
    Verifies that unsupported dataset names raise ValueError.
    """
    with pytest.raises(ValueError):
        load_dataset('unknown_dataset_xyz')
