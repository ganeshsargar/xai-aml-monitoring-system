"""
FundTraceAI Unified Dataset Loader.
Supports loading and canonical translation for:
  - "synthetic" (default FundTraceAI realistic generator)
  - "ibm_aml"   (IBM AMLworld / HI-Small / LI-Small benchmark)
  - "saml_d"    (SAML-D synthetic AML benchmark)

Chosen via the DATASET_NAME environment variable or direct parameter.
"""

import os
import sys
from typing import Optional
import pandas as pd

# Add repo root to sys.path so dataset package can be imported
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from dataset.adapters.ibm_aml_adapter import load_ibm_aml
from dataset.adapters.saml_d_adapter import load_saml_d
from dataset.fx_config import normalize_amount_to_inr_batch


SUPPORTED_DATASETS = ['synthetic', 'ibm_aml', 'saml_d']

# Standard file placement search paths for benchmark datasets
IBM_CANDIDATE_PATHS = [
    os.path.join(repo_root, 'dataset', 'raw', 'ibm_aml', 'HI-Small_Trans.csv'),
    os.path.join(repo_root, 'dataset', 'raw', 'ibm_aml', 'LI-Small_Trans.csv'),
    os.path.join(repo_root, 'dataset', 'raw', 'ibm_aml', 'transactions.csv'),
    os.path.join(repo_root, 'dataset', 'ibm_aml.csv'),
    os.path.join(repo_root, 'dataset', 'HI-Small_Trans.csv'),
    os.path.join(repo_root, 'dataset', 'LI-Small_Trans.csv'),
]

SAMLD_CANDIDATE_PATHS = [
    os.path.join(repo_root, 'dataset', 'raw', 'saml_d', 'SAML-D.csv'),
    os.path.join(repo_root, 'dataset', 'raw', 'saml_d', 'saml_d.csv'),
    os.path.join(repo_root, 'dataset', 'raw', 'saml_d', 'transactions.csv'),
    os.path.join(repo_root, 'dataset', 'saml_d.csv'),
    os.path.join(repo_root, 'dataset', 'SAML-D.csv'),
]


def resolve_ibm_aml_path(custom_path: Optional[str] = None) -> str:
    if custom_path and os.path.exists(custom_path):
        return custom_path
    for p in IBM_CANDIDATE_PATHS:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(
        "IBM AML benchmark file not found.\n"
        "To evaluate against IBM AML:\n"
        "  1. Download HI-Small_Trans.csv or LI-Small_Trans.csv from:\n"
        "     https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml\n"
        "     or https://github.com/IBM/AMLWorld\n"
        f"  2. Place it at: {os.path.join(repo_root, 'dataset', 'raw', 'ibm_aml', 'HI-Small_Trans.csv')}\n"
        f"     or: {os.path.join(repo_root, 'dataset', 'ibm_aml.csv')}"
    )


def resolve_saml_d_path(custom_path: Optional[str] = None) -> str:
    if custom_path and os.path.exists(custom_path):
        return custom_path
    for p in SAMLD_CANDIDATE_PATHS:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(
        "SAML-D benchmark file not found.\n"
        "To evaluate against SAML-D:\n"
        "  1. Download SAML-D.csv from Kaggle:\n"
        "     https://www.kaggle.com/datasets/berkayalan/synthetic-anti-money-laundering-dataset-samld\n"
        f"  2. Place it at: {os.path.join(repo_root, 'dataset', 'raw', 'saml_d', 'SAML-D.csv')}\n"
        f"     or: {os.path.join(repo_root, 'dataset', 'saml_d.csv')}"
    )


def load_dataset(
    name: Optional[str] = None,
    dataset_path: Optional[str] = None,
    max_rows: Optional[int] = None,
    **kwargs
) -> pd.DataFrame:
    """
    Unified dataset loading function for FundTraceAI.

    Parameters:
    -----------
    name : str, optional
        Dataset identifier: 'synthetic', 'ibm_aml', or 'saml_d'.
        If None, resolved from environment variable DATASET_NAME (default: 'synthetic').
    dataset_path : str, optional
        Custom file path to dataset. If None, resolved from standard paths.
    max_rows : int, optional
        Maximum number of rows to load (useful for quick evaluation on large benchmarks).

    Returns:
    --------
    pd.DataFrame
        Canonical DataFrame with standardized schema, datetime timestamps,
        amount_inr, and is_laundering label.
    """
    if not name:
        name = os.environ.get('DATASET_NAME', 'synthetic')

    norm_name = str(name).strip().lower()

    if norm_name in ['synthetic', 'synth', 'fundtrace']:
        target_path = dataset_path or os.path.join(repo_root, 'dataset', 'dataset.csv')
        if not os.path.exists(target_path):
            print(f"[DataLoader] Synthetic dataset not found at {target_path}. Generating it...")
            from dataset.generate_dataset import generate_aml_data
            generate_aml_data(num_records=15000, laundering_rate=0.01)

        print(f"[DataLoader] Loading synthetic dataset from: {target_path}")
        df = pd.read_csv(target_path, nrows=max_rows)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        if 'amount_inr' not in df.columns:
            df['amount_inr'] = df['amount']

    elif norm_name in ['ibm_aml', 'ibm', 'amlworld']:
        target_file = resolve_ibm_aml_path(dataset_path)
        print(f"[DataLoader] Ingesting IBM AML benchmark from: {target_file}")
        df = load_ibm_aml(target_file, max_rows=max_rows)

    elif norm_name in ['saml_d', 'samld', 'saml']:
        target_file = resolve_saml_d_path(dataset_path)
        print(f"[DataLoader] Ingesting SAML-D benchmark from: {target_file}")
        df = load_saml_d(target_file, max_rows=max_rows)

    else:
        raise ValueError(
            f"Unsupported dataset name '{name}'. "
            f"Supported options: {SUPPORTED_DATASETS}"
        )

    # Post-load sanity validations
    if 'timestamp' in df.columns and not pd.api.types.is_datetime64_any_dtype(df['timestamp']):
        df['timestamp'] = pd.to_datetime(df['timestamp'])

    if 'amount_inr' not in df.columns and 'amount' in df.columns:
        curr = df.get('currency', 'INR')
        df['amount_inr'] = normalize_amount_to_inr_batch(df['amount'], curr)

    if 'is_laundering' in df.columns:
        df['is_laundering'] = pd.to_numeric(df['is_laundering'], errors='coerce').fillna(0).astype(int)

    print(f"[DataLoader] Successfully loaded '{norm_name}' ({len(df):,} transactions, {df['is_laundering'].mean():.2%} laundering rate).")
    return df
