"""
Benchmark script to compare the execution time of old O(n^2) feature engineering
vs the new vectorized compute_features_batch() on dataset/dataset.csv.
"""

import os
import time
import pandas as pd
import numpy as np
from features import compute_features_batch
from risk_config import (
    get_high_risk_countries,
    get_high_risk_payment_methods,
    get_structuring_bounds,
    get_night_hours,
    get_large_amount_threshold
)


def old_engineer_features(df):
    """Original O(n^2) feature engineering logic from train.py"""
    df = df.copy()
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)

    df['hour'] = df['timestamp'].dt.hour
    df['day_of_week'] = df['timestamp'].dt.dayofweek

    high_risk_countries = get_high_risk_countries()
    df['is_high_risk_country'] = df['country'].isin(high_risk_countries).astype(int)

    df['is_wire_or_crypto'] = df['payment_method'].isin(
        get_high_risk_payment_methods()
    ).astype(int)

    df['is_night'] = df['hour'].isin(get_night_hours()).astype(int)
    df['is_transfer'] = (df['category'] == 'Transfer').astype(int)

    struct_lower, struct_upper = get_structuring_bounds()
    df['amount_near_threshold'] = (
        (df['amount'] >= struct_lower) & (df['amount'] <= struct_upper)
    ).astype(int)

    df['is_large_amount'] = (df['amount'] >= get_large_amount_threshold()).astype(int)
    df['log_amount'] = np.log1p(df['amount'])

    df['sender_time_diff'] = (
        df.groupby('sender_account')['timestamp']
        .diff()
        .dt.total_seconds() / 60.0
    ).fillna(9999.0)

    df['receiver_time_diff'] = (
        df.groupby('receiver_account')['timestamp']
        .diff()
        .dt.total_seconds() / 60.0
    ).fillna(9999.0)

    sender_counts = []
    receiver_counts = []
    for idx, row in df.iterrows():
        sender = row['sender_account']
        receiver = row['receiver_account']
        t = row['timestamp']
        cutoff = t - pd.Timedelta(hours=2)

        s_count = len(df[
            (df['sender_account'] == sender) &
            (df['timestamp'] < t) &
            (df['timestamp'] >= cutoff)
        ])
        r_count = len(df[
            (df['receiver_account'] == receiver) &
            (df['timestamp'] < t) &
            (df['timestamp'] >= cutoff)
        ])
        sender_counts.append(s_count)
        receiver_counts.append(r_count)

    df['sender_velocity_2h'] = sender_counts
    df['receiver_velocity_2h'] = receiver_counts
    return df


def run_benchmark():
    dataset_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), 'dataset', 'dataset.csv'
    )
    if not os.path.exists(dataset_path):
        print(f"Dataset not found at {dataset_path}")
        return

    print("=" * 60)
    print("FundTraceAI Feature Engineering Benchmark")
    print("=" * 60)
    df = pd.read_csv(dataset_path)
    n_rows = len(df)
    print(f"Total dataset size: {n_rows:,} transactions\n")

    # Benchmark New Vectorized Method on full dataset
    print(f"[1/2] Benchmarking NEW vectorized feature engineering on full dataset ({n_rows:,} rows)...")
    start_new = time.perf_counter()
    new_res = compute_features_batch(df)
    end_new = time.perf_counter()
    new_duration = end_new - start_new
    print(f"      New method elapsed time: {new_duration:.4f} seconds ({n_rows / new_duration:,.0f} rows/sec)\n")

    # Benchmark Old O(n^2) Method
    # On full 14,801 rows, old loop takes ~160 seconds.
    # To benchmark accurately, run on a sample (1,500 rows) and extrapolate, or run on full dataset if desired.
    sample_size = min(1500, n_rows)
    print(f"[2/2] Benchmarking OLD O(n^2) loop on {sample_size:,} rows sample...")
    df_sample = df.iloc[:sample_size].copy()
    start_old = time.perf_counter()
    _ = old_engineer_features(df_sample)
    end_old = time.perf_counter()
    old_sample_duration = end_old - start_old
    
    # Scale factor for O(n^2) loop: (n_rows / sample_size)^2
    scaling_factor = (n_rows / sample_size) ** 2
    estimated_old_full = old_sample_duration * scaling_factor

    print(f"      Old method on {sample_size:,} rows: {old_sample_duration:.2f} seconds")
    print(f"      Estimated old method on full {n_rows:,} rows: {estimated_old_full:.2f} seconds (~{estimated_old_full / 60:.1f} minutes)")

    speedup = estimated_old_full / new_duration
    print("\n" + "=" * 60)
    print("Benchmark Summary Results:")
    print("=" * 60)
    print(f"Dataset:                             {dataset_path}")
    print(f"Number of rows:                      {n_rows:,}")
    print(f"Old O(n^2) method (estimated full):  {estimated_old_full:.2f} s")
    print(f"New vectorized method:               {new_duration:.4f} s")
    print(f"Speedup:                             {speedup:,.1f}x faster")
    print("=" * 60)


if __name__ == '__main__':
    run_benchmark()
