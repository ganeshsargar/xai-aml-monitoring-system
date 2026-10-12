"""
FundTraceAI — Real Benchmark Evaluation Runner (IBM AML & SAML-D).
Checks for raw benchmark CSVs in dataset/raw/:
  - dataset/raw/ibm_aml/ (HI-Small_Trans.csv, LI-Small_Trans.csv, transactions.csv)
  - dataset/raw/saml_d/  (SAML-D.csv, saml_d.csv, transactions.csv)

Validates exact column mappings against file headers, trains candidate models across
5 random seeds, evaluates champion model, and writes structured benchmark results to:
  - results/benchmark_ibm_aml.json
  - results/benchmark_saml_d.json

Enforces:
  - Strict header validation against expected adapter schemas
  - Minimum test set positive count >= 30 (fails training if fewer than 30 positives)
  - 5-seed mean and std metrics reporting
"""

import os
import sys
import json
import argparse
from typing import Dict, List, Optional, Tuple
import pandas as pd

# Add repo root and ml-service to path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ML_SERVICE_DIR = os.path.join(REPO_ROOT, 'ml-service')
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

from dataset.adapters.ibm_aml_adapter import IbmAmlAdapter
from dataset.adapters.saml_d_adapter import SamlDAdapter
from data_loader import (
    IBM_CANDIDATE_PATHS,
    SAMLD_CANDIDATE_PATHS,
    resolve_ibm_aml_path,
    resolve_saml_d_path
)
from train import train_and_evaluate, RANDOM_SEEDS

IBM_RAW_DIR = os.path.join(REPO_ROOT, 'dataset', 'raw', 'ibm_aml')
SAMLD_RAW_DIR = os.path.join(REPO_ROOT, 'dataset', 'raw', 'saml_d')
RESULTS_DIR = os.path.join(REPO_ROOT, 'results')


# ── Header Validation Specifications ──────────────────────────────────────────

IBM_REQUIRED_HEADERS = {
    'timestamp': ['timestamp', 'date', 'time', 'datetime'],
    'sender': ['account', 'from account', 'from_account', 'sender_account'],
    'receiver': ['account.1', 'to account', 'to_account', 'receiver_account'],
    'amount': ['amount paid', 'amount', 'amount received', 'value', 'txn_amount'],
    'label': ['is laundering', 'is_laundering', 'islaundering', 'label']
}

SAMLD_REQUIRED_HEADERS = {
    'timestamp': ['time', 'date', 'timestamp', 'datetime'],
    'sender': ['sender_account', 'sender account', 'sender', 'from_account', 'from account'],
    'receiver': ['receiver_account', 'receiver account', 'receiver', 'to_account', 'to account'],
    'amount': ['amount', 'txn_amount', 'value', 'amount paid'],
    'label': ['is_laundering', 'is laundering', 'islaundering', 'label']
}


def inspect_csv_headers(filepath: str) -> List[str]:
    """Inspects raw column headers directly from CSV file."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"CSV file not found: {filepath}")
    df_sample = pd.read_csv(filepath, nrows=0)
    return [str(c).strip() for c in df_sample.columns]


def validate_column_mapping(headers: List[str], schema_specs: Dict[str, List[str]], benchmark_name: str) -> Dict[str, str]:
    """
    Validates exact column mapping against file headers.
    Returns detected mapping dictionary or raises ValueError.
    """
    lower_map = {h.lower(): h for h in headers}
    detected_mapping = {}
    missing_fields = []

    for canonical_field, candidates in schema_specs.items():
        matched = None
        for candidate in candidates:
            if candidate in lower_map:
                matched = lower_map[candidate]
                break
        if matched:
            detected_mapping[canonical_field] = matched
        else:
            missing_fields.append((canonical_field, candidates))

    if missing_fields:
        err_msg = (
            f"[{benchmark_name} Validation Error] Header validation failed for CSV.\n"
            f"Detected headers ({len(headers)}): {headers}\n"
            f"Missing required canonical fields:\n"
        )
        for field, cands in missing_fields:
            err_msg += f"  - '{field}': expected one of {cands}\n"
        raise ValueError(err_msg)

    print(f"[{benchmark_name}] Header validation passed! Detected mappings: {detected_mapping}")
    return detected_mapping


# ── Candidate File Resolvers ──────────────────────────────────────────────────

def find_raw_file(raw_dir: str, candidate_filenames: List[str]) -> Optional[str]:
    """Locates raw benchmark CSV in raw directory."""
    if not os.path.exists(raw_dir):
        return None
    for fname in candidate_filenames:
        target = os.path.join(raw_dir, fname)
        if os.path.exists(target):
            return target
    # Fallback: any .csv in raw_dir
    csvs = [os.path.join(raw_dir, f) for f in os.listdir(raw_dir) if f.endswith('.csv')]
    if csvs:
        return csvs[0]
    return None


def run_benchmark_for_dataset(
    dataset_name: str,
    raw_csv_path: str,
    max_rows: Optional[int] = None,
    output_dir: str = RESULTS_DIR
) -> Dict:
    """
    Validates headers, runs train_and_evaluate, and saves benchmark_<dataset>.json.
    """
    os.makedirs(output_dir, exist_ok=True)
    headers = inspect_csv_headers(raw_csv_path)

    if dataset_name == 'ibm_aml':
        validate_column_mapping(headers, IBM_REQUIRED_HEADERS, "IBM-AML")
    elif dataset_name == 'saml_d':
        validate_column_mapping(headers, SAMLD_REQUIRED_HEADERS, "SAML-D")
    else:
        raise ValueError(f"Unknown benchmark dataset: {dataset_name}")

    print(f"\n[Benchmark Execution] Training and evaluating on '{dataset_name}' from: {raw_csv_path}")
    metrics = train_and_evaluate(
        dataset_name=dataset_name,
        dataset_path=raw_csv_path,
        max_rows=max_rows,
        save_artifacts=False
    )

    out_file = os.path.join(output_dir, f"benchmark_{dataset_name}.json")
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=4)

    print(f"\n[OK] Benchmark results successfully written to: {out_file}")
    return metrics


# ── Mock Sample Generator for CI / Verification ───────────────────────────────

def generate_mock_benchmark_data(raw_dir: str, dataset_name: str, n_rows: int = 4000) -> str:
    """Creates synthetic sample formatted with exact real benchmark headers for test verification."""
    os.makedirs(raw_dir, exist_ok=True)
    rng = pd.date_range('2025-01-01', periods=n_rows, freq='5min')
    
    if dataset_name == 'ibm_aml':
        target_path = os.path.join(raw_dir, 'HI-Small_Trans.csv')
        # Exact IBM AMLworld / HI-Small headers
        # Ensure temporal holdout (15% = 600 rows) has >= 40 positives
        labels = [1 if (i % 12 == 0) else 0 for i in range(n_rows)]
        mock_df = pd.DataFrame({
            'Timestamp': rng.strftime('%Y/%m/%d %H:%M'),
            'From Bank': [100 + (i % 10) for i in range(n_rows)],
            'Account': [f"ACC_{1000 + (i % 250)}" for i in range(n_rows)],
            'To Bank': [200 + (i % 10) for i in range(n_rows)],
            'Account.1': [f"ACC_{2000 + ((i + 1) % 250)}" for i in range(n_rows)],
            'Amount Received': [round(150.0 + (i % 500) * 85.5, 2) for i in range(n_rows)],
            'Receiving Currency': ['US Dollar'] * n_rows,
            'Amount Paid': [round(150.0 + (i % 500) * 85.5, 2) for i in range(n_rows)],
            'Payment Currency': ['US Dollar'] * n_rows,
            'Payment Format': ['Cheque' if i % 2 == 0 else 'Credit Card' for i in range(n_rows)],
            'Is Laundering': labels
        })
        mock_df.to_csv(target_path, index=False)
        return target_path

    elif dataset_name == 'saml_d':
        target_path = os.path.join(raw_dir, 'SAML-D.csv')
        # Exact SAML-D headers
        # Ensure temporal holdout (15% = 600 rows) has >= 40 positives
        labels = [1 if (i % 12 == 0) else 0 for i in range(n_rows)]
        mock_df = pd.DataFrame({
            'Time': rng.strftime('%H:%M:%S'),
            'Date': rng.strftime('%Y-%m-%d'),
            'Sender_Account': [f"S_{1000 + (i % 250)}" for i in range(n_rows)],
            'Receiver_Account': [f"R_{2000 + ((i + 1) % 250)}" for i in range(n_rows)],
            'Amount': [round(200.0 + (i % 400) * 110.0, 2) for i in range(n_rows)],
            'Payment_currency': ['USD'] * n_rows,
            'Received_currency': ['USD'] * n_rows,
            'Sender_bank_location': ['US'] * n_rows,
            'Receiver_bank_location': ['US' if i % 3 != 0 else 'AE' for i in range(n_rows)],
            'Payment_type': ['Cross-border' if i % 3 == 0 else 'Domestic' for i in range(n_rows)],
            'Is_laundering': labels,
            'Laundering_type': ['None' if labels[i] == 0 else 'Structuring' for i in range(n_rows)]
        })
        mock_df.to_csv(target_path, index=False)
        return target_path

    raise ValueError(f"Unknown mock dataset: {dataset_name}")


# ── Main Entry Point ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="FundTraceAI Benchmark Evaluation Runner for IBM AML & SAML-D")
    parser.add_argument(
        '--dataset', choices=['ibm_aml', 'saml_d', 'all'], default='all',
        help="Benchmark dataset to run: 'ibm_aml', 'saml_d', or 'all' (default: 'all')"
    )
    parser.add_argument(
        '--max-rows', type=int, default=None,
        help="Maximum rows to load (useful for rapid evaluation on massive benchmarks)"
    )
    parser.add_argument(
        '--output-dir', type=str, default=RESULTS_DIR,
        help=f"Directory to write benchmark JSON results (default: {RESULTS_DIR})"
    )
    parser.add_argument(
        '--mock-test', action='store_true', default=False,
        help="Generate mock benchmark CSVs with real headers to verify pipeline and header validation end-to-end"
    )
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    datasets_to_check = ['ibm_aml', 'saml_d'] if args.dataset == 'all' else [args.dataset]
    executed = 0

    print("=" * 75)
    print("FundTraceAI Real Benchmark Evaluation Suite (IBM AMLworld & SAML-D)")
    print("=" * 75)

    for ds in datasets_to_check:
        print(f"\nChecking benchmark dataset: '{ds}'...")
        if ds == 'ibm_aml':
            raw_file = find_raw_file(IBM_RAW_DIR, ['HI-Small_Trans.csv', 'LI-Small_Trans.csv', 'transactions.csv'])
            if args.mock_test:
                print(f"[Mock Test] Generating mock IBM AMLworld CSV with authentic headers at {IBM_RAW_DIR}...")
                raw_file = generate_mock_benchmark_data(IBM_RAW_DIR, 'ibm_aml', n_rows=4000)

            if raw_file:
                print(f"  Found raw IBM AML file: {raw_file}")
                run_benchmark_for_dataset('ibm_aml', raw_file, max_rows=args.max_rows, output_dir=args.output_dir)
                executed += 1
            else:
                print(f"  [Not Found] IBM AML benchmark CSV not found in {IBM_RAW_DIR}.")
                print("  To run this benchmark:")
                print("    1. Download HI-Small_Trans.csv or LI-Small_Trans.csv from:")
                print("       https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml")
                print(f"    2. Place it in: {os.path.join(IBM_RAW_DIR, 'HI-Small_Trans.csv')}")

        elif ds == 'saml_d':
            raw_file = find_raw_file(SAMLD_RAW_DIR, ['SAML-D.csv', 'saml_d.csv', 'transactions.csv'])
            if args.mock_test:
                print(f"[Mock Test] Generating mock SAML-D CSV with authentic headers at {SAMLD_RAW_DIR}...")
                raw_file = generate_mock_benchmark_data(SAMLD_RAW_DIR, 'saml_d', n_rows=4000)

            if raw_file:
                print(f"  Found raw SAML-D file: {raw_file}")
                run_benchmark_for_dataset('saml_d', raw_file, max_rows=args.max_rows, output_dir=args.output_dir)
                executed += 1
            else:
                print(f"  [Not Found] SAML-D benchmark CSV not found in {SAMLD_RAW_DIR}.")
                print("  To run this benchmark:")
                print("    1. Download SAML-D.csv from:")
                print("       https://www.kaggle.com/datasets/berkayalan/synthetic-anti-money-laundering-dataset-samld")
                print(f"    2. Place it in: {os.path.join(SAMLD_RAW_DIR, 'SAML-D.csv')}")

    print("\n" + "=" * 75)
    print(f"Benchmark run complete. Successfully executed {executed}/{len(datasets_to_check)} benchmarks.")
    print("=" * 75)


if __name__ == '__main__':
    main()
