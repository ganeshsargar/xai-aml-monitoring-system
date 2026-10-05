"""
FundTraceAI AML Feature Engineering Module
Single source of truth for feature computation in both batch and single/live transaction modes.
Computes 12 base behavioral/transactional features + 9 rolling network graph features.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd

from risk_config import (
    get_high_risk_countries,
    get_high_risk_payment_methods,
    get_ctr_threshold,
    get_structuring_bounds,
    get_large_amount_threshold,
    get_night_hours,
)
from graph_module import compute_account_graph_features


# ── Feature Schema & Column Definitions ───────────────────────────────────────
BASE_FEATURE_COLS = [
    'log_amount',               # log-scaled amount (handles heavy right-tail without outlier sensitivity)
    'amount',                   # raw amount for threshold-detection context
    'is_high_risk_country',     # binary indicator: high-risk / offshore jurisdiction
    'is_wire_or_crypto',        # binary indicator: anonymous or high-velocity rails
    'is_night',                 # binary indicator: off-hours execution window
    'is_transfer',              # binary indicator: direct unclassified capital transfer
    'amount_near_threshold',    # binary indicator: amount structured just below CTR threshold
    'is_large_amount',          # binary indicator: abnormally high-value single transaction
    'sender_time_diff',         # minutes since sender's immediately preceding transaction
    'receiver_time_diff',       # minutes since receiver's immediately preceding transaction
    'sender_velocity_2h',       # count of sender transactions in preceding 2-hour window
    'receiver_velocity_2h',     # count of receiver transactions in preceding 2-hour window
]

GRAPH_FEATURE_COLS = [
    'in_degree',                # inbound degree of sender / funnel aggregation
    'out_degree',               # outbound degree of sender / fan-out dispersion
    'distinct_counterparties',  # unique counterparties connected to transacting accounts
    'pass_through_ratio',       # ratio of rapid transit flow through account (in ≈ out within hours)
    'in_cycle',                 # binary indicator: transacting account is part of temporal round-trip loop
    'cycle_count',              # count of temporal cycles involving the accounts
    'pagerank',                 # structural network centrality score in interaction graph
    'shared_device_degree',     # count of other accounts sharing device_id or ip_address
    'neighbor_max_risk',        # maximum risk score among 1-hop counterparties
]

CUSTOMER_FEATURE_COLS = [
    'amount_zscore_vs_own_history', # z-score vs sender's historical amounts
    'volume_vs_declared_income',    # rolling 30d transacted volume / declared monthly income or turnover
    'new_counterparty_flag',        # binary indicator: receiver is novel counterparty for sender
    'new_country_flag',             # binary indicator: transaction country is novel for sender
    'account_age_days',             # account age in days from onboarding/creation to transaction
    'dormant_reactivation',         # binary indicator: inactive >90d followed by large transaction
    'peer_percentile',              # percentile of amount within customer type & income peer group
]

FEATURE_COLS = BASE_FEATURE_COLS + GRAPH_FEATURE_COLS + CUSTOMER_FEATURE_COLS

# Rolling behavioral window parameters
VELOCITY_WINDOW   = '2h'
DEFAULT_TIME_DIFF = 9999.0
DEFAULT_ROLLING_GRAPH_DAYS = 14

DEFAULT_GRAPH_FEAT_DICT = {
    'in_degree': 0.0,
    'out_degree': 0.0,
    'distinct_counterparties': 0.0,
    'pass_through_ratio': 0.0,
    'in_cycle': 0.0,
    'cycle_count': 0.0,
    'pagerank': 0.0,
    'shared_device_degree': 0.0,
    'neighbor_max_risk': 0.0
}

DEFAULT_CUSTOMER_FEAT_DICT = {
    'amount_zscore_vs_own_history': 0.0,
    'volume_vs_declared_income': 0.2,
    'new_counterparty_flag': 0.0,
    'new_country_flag': 0.0,
    'account_age_days': 365.0,
    'dormant_reactivation': 0.0,
    'peer_percentile': 0.5
}

_CUSTOMER_LOOKUP = None

def _load_customer_lookup() -> dict:
    global _CUSTOMER_LOOKUP
    if _CUSTOMER_LOOKUP is not None:
        return _CUSTOMER_LOOKUP

    import os
    base_dirs = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dataset'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dataset'),
        os.path.abspath('dataset'),
        os.path.abspath('../dataset')
    ]

    cust_file = None
    acc_file = None
    for d in base_dirs:
        cf = os.path.join(d, 'customers.csv')
        af = os.path.join(d, 'accounts.csv')
        if os.path.exists(cf) and os.path.exists(af):
            cust_file = cf
            acc_file = af
            break

    lookup = {}
    if cust_file and acc_file:
        try:
            c_df = pd.read_csv(cust_file)
            a_df = pd.read_csv(acc_file)
            merged = pd.merge(a_df, c_df, on='customer_id', how='left')
            for _, r in merged.iterrows():
                acc_id = str(r['account_id'])
                decl_inc = float(r.get('declared_monthly_income_or_turnover', 75000.0) or 75000.0)
                ctype = str(r.get('type', 'individual'))
                open_d = str(r.get('open_date', '2024-01-01'))
                onboard_d = str(r.get('onboarding_date', open_d))
                ctry = str(r.get('country_of_residence', 'IN'))
                lookup[acc_id] = {
                    'customer_id': str(r.get('customer_id', f"CUST_{acc_id}")),
                    'declared_income': decl_inc,
                    'customer_type': ctype,
                    'open_date': open_d,
                    'onboarding_date': onboard_d,
                    'country': ctry
                }
        except Exception:
            pass

    _CUSTOMER_LOOKUP = lookup
    return _CUSTOMER_LOOKUP


def compute_rolling_graph_features(
    combined_df: pd.DataFrame,
    rolling_days: int = DEFAULT_ROLLING_GRAPH_DAYS
) -> pd.DataFrame:
    """
    Computes per-account graph features on a rolling graph built from the last N days of history.
    Maps sender & receiver graph attributes to each transaction row.
    """
    n_rows = len(combined_df)
    if n_rows == 0:
        return pd.DataFrame(columns=GRAPH_FEATURE_COLS)

    graph_res = {col: np.zeros(n_rows, dtype=float) for col in GRAPH_FEATURE_COLS}

    # Ensure required columns exist
    if 'sender_account' not in combined_df.columns or 'receiver_account' not in combined_df.columns:
        return pd.DataFrame(graph_res, index=combined_df.index)

    times = combined_df['timestamp']
    t_min = times.min()
    t_max = times.max()
    rolling_delta = timedelta(days=rolling_days)

    if pd.isna(t_min) or pd.isna(t_max) or (t_max - t_min) <= rolling_delta or n_rows <= 1000:
        # Single rolling graph covers the whole batch or time span
        records = combined_df.to_dict('records')
        acc_feats = compute_account_graph_features(records)

        senders = combined_df['sender_account'].astype(str).values
        receivers = combined_df['receiver_account'].astype(str).values

        for i in range(n_rows):
            s_f = acc_feats.get(senders[i], DEFAULT_GRAPH_FEAT_DICT)
            r_f = acc_feats.get(receivers[i], DEFAULT_GRAPH_FEAT_DICT)

            graph_res['in_degree'][i] = s_f['in_degree']
            graph_res['out_degree'][i] = s_f['out_degree']
            graph_res['distinct_counterparties'][i] = max(s_f['distinct_counterparties'], r_f['distinct_counterparties'])
            graph_res['pass_through_ratio'][i] = max(s_f['pass_through_ratio'], r_f['pass_through_ratio'])
            graph_res['in_cycle'][i] = max(s_f['in_cycle'], r_f['in_cycle'])
            graph_res['cycle_count'][i] = max(s_f['cycle_count'], r_f['cycle_count'])
            graph_res['pagerank'][i] = max(s_f['pagerank'], r_f['pagerank'])
            graph_res['shared_device_degree'][i] = max(s_f['shared_device_degree'], r_f['shared_device_degree'])
            graph_res['neighbor_max_risk'][i] = max(s_f['neighbor_max_risk'], r_f['neighbor_max_risk'])

    else:
        # Sliding temporal windows (step of 3 days across timeline)
        step_delta = timedelta(days=3)
        curr = t_min + step_delta
        prev_bound = t_min - timedelta(seconds=1)

        senders = combined_df['sender_account'].astype(str).values
        receivers = combined_df['receiver_account'].astype(str).values

        while curr <= t_max + step_delta:
            # Active graph formed by transactions in [curr - rolling_delta, curr]
            graph_mask = (times >= curr - rolling_delta) & (times <= curr)
            assign_mask = (times > prev_bound) & (times <= curr)

            if assign_mask.any():
                sub_records = combined_df.loc[graph_mask].to_dict('records')
                acc_feats = compute_account_graph_features(sub_records)

                target_indices = np.where(assign_mask.values)[0]
                for idx in target_indices:
                    s_f = acc_feats.get(senders[idx], DEFAULT_GRAPH_FEAT_DICT)
                    r_f = acc_feats.get(receivers[idx], DEFAULT_GRAPH_FEAT_DICT)

                    graph_res['in_degree'][idx] = s_f['in_degree']
                    graph_res['out_degree'][idx] = s_f['out_degree']
                    graph_res['distinct_counterparties'][idx] = max(s_f['distinct_counterparties'], r_f['distinct_counterparties'])
                    graph_res['pass_through_ratio'][idx] = max(s_f['pass_through_ratio'], r_f['pass_through_ratio'])
                    graph_res['in_cycle'][idx] = max(s_f['in_cycle'], r_f['in_cycle'])
                    graph_res['cycle_count'][idx] = max(s_f['cycle_count'], r_f['cycle_count'])
                    graph_res['pagerank'][idx] = max(s_f['pagerank'], r_f['pagerank'])
                    graph_res['shared_device_degree'][idx] = max(s_f['shared_device_degree'], r_f['shared_device_degree'])
                    graph_res['neighbor_max_risk'][idx] = max(s_f['neighbor_max_risk'], r_f['neighbor_max_risk'])

            prev_bound = curr
            curr += step_delta

    return pd.DataFrame(graph_res, index=combined_df.index)


def compute_peer_key(cust_type: str, declared_inc: float) -> str:
    ctype = str(cust_type or '').lower()
    if 'biz' in ctype or 'business' in ctype:
        if declared_inc < 1000000.0:
            return 'business_micro'
        elif declared_inc < 10000000.0:
            return 'business_sme'
        else:
            return 'business_corporate'
    else:
        if declared_inc < 50000.0:
            return 'individual_low'
        elif declared_inc < 150000.0:
            return 'individual_mid'
        elif declared_inc < 500000.0:
            return 'individual_high'
        else:
            return 'individual_affluent'


PEER_DISTRIBUTIONS = {
    'individual_low': [500, 1200, 2500, 5000, 10000, 25000],
    'individual_mid': [1000, 3500, 8000, 15000, 35000, 80000],
    'individual_high': [2500, 10000, 25000, 60000, 150000, 350000],
    'individual_affluent': [5000, 25000, 75000, 200000, 500000, 1200000],
    'business_micro': [2000, 10000, 30000, 80000, 200000, 500000],
    'business_sme': [10000, 50000, 150000, 500000, 1500000, 4000000],
    'business_corporate': [50000, 250000, 800000, 2500000, 8000000, 25000000],
}


def estimate_peer_percentile(amount: float, peer_key: str) -> float:
    benchmarks = PEER_DISTRIBUTIONS.get(peer_key, PEER_DISTRIBUTIONS['individual_mid'])
    probs = [0.10, 0.25, 0.50, 0.75, 0.90, 0.98]
    if amount <= benchmarks[0]:
        return max(0.01, (amount / benchmarks[0]) * 0.10)
    for k in range(len(benchmarks) - 1):
        if benchmarks[k] <= amount <= benchmarks[k + 1]:
            frac = (amount - benchmarks[k]) / (benchmarks[k + 1] - benchmarks[k] + 1e-5)
            return round(probs[k] + frac * (probs[k + 1] - probs[k]), 4)
    return 0.99


def compute_customer_features(combined_df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes per-customer behavioral and peer-group AML features:
    1. amount_zscore_vs_own_history: Z-score of amount vs sender's historical amounts
    2. volume_vs_declared_income: Rolling 30d transacted volume / declared monthly income or turnover
    3. new_counterparty_flag: 1 if receiver account has never been transacted with by sender
    4. new_country_flag: 1 if transaction country is novel for sender
    5. account_age_days: Account age in days from onboarding/creation to transaction timestamp
    6. dormant_reactivation: 1 if dormant >90 days and now active with large transaction
    7. peer_percentile: Empirical percentile of transaction amount relative to peer group
    """
    n_rows = len(combined_df)
    if n_rows == 0:
        return pd.DataFrame(columns=CUSTOMER_FEATURE_COLS)

    lookup = _load_customer_lookup()
    times = pd.to_datetime(combined_df['timestamp'], utc=True)
    min_t = times.min() if not times.empty else pd.to_datetime('2025-01-01', utc=True)

    if 'sender_account' not in combined_df.columns or not combined_df['sender_account'].notna().any():
        defaults = {col: np.full(n_rows, DEFAULT_CUSTOMER_FEAT_DICT[col], dtype=float) for col in CUSTOMER_FEATURE_COLS}
        return pd.DataFrame(defaults, index=combined_df.index)

    s_valid = combined_df[combined_df['sender_account'].notna()].copy()
    s_valid['timestamp'] = pd.to_datetime(s_valid['timestamp'], utc=True)
    sort_cols = ['sender_account', 'timestamp', '_is_history'] if '_is_history' in s_valid.columns else ['sender_account', 'timestamp']
    asc = [True, True, False] if '_is_history' in s_valid.columns else [True, True]
    s_sorted = s_valid.sort_values(sort_cols, ascending=asc)

    s_accs = s_sorted['sender_account'].astype(str).values
    r_accs = s_sorted['receiver_account'].astype(str).values if 'receiver_account' in s_sorted.columns else np.full(len(s_sorted), 'None')
    c_vals = s_sorted['country'].astype(str).values if 'country' in s_sorted.columns else np.full(len(s_sorted), 'IN')
    s_amt = s_sorted['amount'].astype(float).values

    # Extract customer profile attributes
    decl_incomes = np.zeros(len(s_sorted), dtype=float)
    cust_types = []
    open_dates = []
    home_countries = []
    peer_keys = []

    has_direct_income = 'sender_declared_income' in s_sorted.columns and s_sorted['sender_declared_income'].notna().any()
    has_direct_type = 'sender_customer_type' in s_sorted.columns and s_sorted['sender_customer_type'].notna().any()
    has_direct_open = 'sender_account_open_date' in s_sorted.columns and s_sorted['sender_account_open_date'].notna().any()

    direct_incomes = s_sorted['sender_declared_income'].values if has_direct_income else None
    direct_types = s_sorted['sender_customer_type'].values if has_direct_type else None
    direct_opens = s_sorted['sender_account_open_date'].values if has_direct_open else None

    for i, acc in enumerate(s_accs):
        meta = lookup.get(acc, {})
        d_inc = float(direct_incomes[i]) if has_direct_income and pd.notna(direct_incomes[i]) else float(meta.get('declared_income', 75000.0) or 75000.0)
        c_type = str(direct_types[i]) if has_direct_type and pd.notna(direct_types[i]) else str(meta.get('customer_type', 'individual'))
        o_date = str(direct_opens[i]) if has_direct_open and pd.notna(direct_opens[i]) else str(meta.get('open_date', '2024-01-01'))
        h_ctry = str(meta.get('country', 'IN'))

        decl_incomes[i] = d_inc
        cust_types.append(c_type)
        open_dates.append(o_date)
        home_countries.append(h_ctry)
        peer_keys.append(compute_peer_key(c_type, d_inc))

    # 1. amount_zscore_vs_own_history (Expanding mean and std per sender)
    s_sorted['_amt_val'] = s_amt
    s_sorted['_amt_sq'] = s_amt ** 2

    cum_count = s_sorted.groupby('sender_account').cumcount()
    cum_sum = s_sorted.groupby('sender_account')['_amt_val'].cumsum().values - s_amt
    cum_sq = s_sorted.groupby('sender_account')['_amt_sq'].cumsum().values - (s_amt ** 2)

    z_scores = np.zeros(len(s_sorted), dtype=float)
    valid_mask = (cum_count.values >= 2)
    if valid_mask.any():
        cnts = cum_count.values[valid_mask]
        means = cum_sum[valid_mask] / cnts
        variances = np.maximum(0.0, (cum_sq[valid_mask] / cnts) - (means ** 2))
        stds = np.sqrt(variances)
        z_scores[valid_mask] = (s_amt[valid_mask] - means) / (stds + 1e-4)
        z_scores[valid_mask] = np.clip(z_scores[valid_mask], -5.0, 10.0)

    # 2. volume_vs_declared_income (Rolling 30D sum of sender transacted amount)
    vol_30d = (
        s_sorted.groupby('sender_account')
        .rolling('30D', on='timestamp', closed='both')['_amt_val']
        .sum()
        .fillna(0.0)
        .values
    )
    vol_ratios = np.clip(vol_30d / (decl_incomes + 1.0), 0.0, 100.0)

    # 3. new_counterparty_flag
    seen_cp = {}
    new_cp_arr = np.zeros(len(s_sorted), dtype=float)
    for i in range(len(s_sorted)):
        s = s_accs[i]
        r = r_accs[i]
        if s not in seen_cp:
            seen_cp[s] = set()
        if r in ('None', '', 'nan') or r in seen_cp[s]:
            new_cp_arr[i] = 0.0
        else:
            new_cp_arr[i] = 1.0
            seen_cp[s].add(r)

    # 4. new_country_flag
    seen_ctry = {}
    new_ctry_arr = np.zeros(len(s_sorted), dtype=float)
    for i in range(len(s_sorted)):
        s = s_accs[i]
        c = c_vals[i]
        home_c = home_countries[i]
        if s not in seen_ctry:
            seen_ctry[s] = {home_c}
        if c in ('None', '', 'nan') or c in seen_ctry[s]:
            new_ctry_arr[i] = 0.0
        else:
            new_ctry_arr[i] = 1.0
            seen_ctry[s].add(c)

    # 5. account_age_days
    open_dts = pd.to_datetime(open_dates, errors='coerce', utc=True).fillna(min_t - timedelta(days=365))
    age_days = np.maximum(0.0, (s_sorted['timestamp'] - open_dts).dt.total_seconds() / 86400.0).values

    # 6. dormant_reactivation
    if 'sender_time_diff' in s_sorted.columns:
        s_diff_mins = s_sorted['sender_time_diff'].values
    else:
        s_diff = s_sorted.groupby('sender_account')['timestamp'].diff().dt.total_seconds() / 60.0
        s_diff_mins = s_diff.fillna(DEFAULT_TIME_DIFF).values

    dormant_flags = ((s_diff_mins > 90.0 * 24.0 * 60.0) & (s_amt >= 50000.0)).astype(float)

    # 7. peer_percentile
    peer_pct_arr = np.zeros(len(s_sorted), dtype=float)
    for i in range(len(s_sorted)):
        peer_pct_arr[i] = estimate_peer_percentile(s_amt[i], peer_keys[i])

    res = {
        'amount_zscore_vs_own_history': pd.Series(z_scores, index=s_sorted.index).reindex(combined_df.index).fillna(0.0),
        'volume_vs_declared_income': pd.Series(vol_ratios, index=s_sorted.index).reindex(combined_df.index).fillna(0.2),
        'new_counterparty_flag': pd.Series(new_cp_arr, index=s_sorted.index).reindex(combined_df.index).fillna(0.0),
        'new_country_flag': pd.Series(new_ctry_arr, index=s_sorted.index).reindex(combined_df.index).fillna(0.0),
        'account_age_days': pd.Series(age_days, index=s_sorted.index).reindex(combined_df.index).fillna(365.0),
        'dormant_reactivation': pd.Series(dormant_flags, index=s_sorted.index).reindex(combined_df.index).fillna(0.0),
        'peer_percentile': pd.Series(peer_pct_arr, index=s_sorted.index).reindex(combined_df.index).fillna(0.5),
    }

    return pd.DataFrame(res, index=combined_df.index)


def compute_customer_baseline(customer_id: str, transactions_df: pd.DataFrame) -> dict:
    """
    Computes per-customer behavioral and peer-group AML baselines.
    """
    if transactions_df is None or len(transactions_df) == 0:
        return {
            'customer_id': customer_id,
            'median_amount': 0.0,
            'std_amount': 0.0,
            'typical_monthly_volume': 0.0,
            'declared_income': 75000.0,
            'volume_vs_declared_ratio': 0.0,
            'usual_countries': ['IN'],
            'usual_hours': [10, 11, 14, 15],
            'counterparties_count': 0,
            'peer_group': {'peer_key': 'individual_mid', 'peer_median': 8000.0}
        }

    lookup = _load_customer_lookup()
    cust_accounts = [acc for acc, cdata in lookup.items() if cdata['customer_id'] == customer_id]
    if not cust_accounts:
        cust_accounts = [customer_id]

    mask = (
        transactions_df['sender_account'].isin(cust_accounts) |
        transactions_df['receiver_account'].isin(cust_accounts)
    )
    if 'sender_customer_id' in transactions_df.columns:
        mask = mask | (transactions_df['sender_customer_id'] == customer_id)

    cust_txs = transactions_df[mask]
    if len(cust_txs) == 0:
        return {
            'customer_id': customer_id,
            'median_amount': 0.0,
            'std_amount': 0.0,
            'typical_monthly_volume': 0.0,
            'declared_income': 75000.0,
            'volume_vs_declared_ratio': 0.0,
            'usual_countries': ['IN'],
            'usual_hours': [10, 11, 14, 15],
            'counterparties_count': 0,
            'peer_group': {'peer_key': 'individual_mid', 'peer_median': 8000.0}
        }

    amounts = cust_txs['amount'].values
    median_amt = float(np.median(amounts))
    std_amt = float(np.std(amounts)) if len(amounts) > 1 else 0.0

    times = pd.to_datetime(cust_txs['timestamp'])
    max_t = times.max()
    t_30d_ago = max_t - timedelta(days=30)
    recent_txs = cust_txs[times >= t_30d_ago]
    monthly_vol = float(recent_txs['amount'].sum())

    decl_inc = 75000.0
    cust_type = 'individual'
    for acc in cust_accounts:
        if acc in lookup:
            decl_inc = lookup[acc]['declared_income']
            cust_type = lookup[acc]['customer_type']
            break

    vol_ratio = round(monthly_vol / (decl_inc + 1.0), 3)
    countries = list(cust_txs['country'].dropna().unique())
    hours = sorted([int(h) for h in times.dt.hour.unique()])

    s_cps = set(cust_txs.loc[cust_txs['sender_account'].isin(cust_accounts), 'receiver_account'].dropna())
    r_cps = set(cust_txs.loc[cust_txs['receiver_account'].isin(cust_accounts), 'sender_account'].dropna())
    cps = len(s_cps.union(r_cps) - set(cust_accounts))

    peer_key = compute_peer_key(cust_type, decl_inc)

    return {
        'customer_id': customer_id,
        'median_amount': round(median_amt, 2),
        'rolling_median_amount': round(median_amt, 2),
        'std_amount': round(std_amt, 2),
        'rolling_std_amount': round(std_amt, 2),
        'typical_monthly_volume': round(monthly_vol, 2),
        'declared_income': round(decl_inc, 2),
        'volume_vs_declared_ratio': vol_ratio,
        'usual_countries': countries,
        'usual_hours': hours,
        'counterparties_count': cps,
        'peer_group': {
            'peer_key': peer_key,
            'peer_median': PEER_DISTRIBUTIONS.get(peer_key, [0, 0, 8000])[2]
        }
    }


def compute_peer_baselines(transactions_df: pd.DataFrame) -> dict:
    """
    Computes summary baselines across peer groups.
    """
    return {
        pkey: {
            'peer_key': pkey,
            'median_amount': PEER_DISTRIBUTIONS[pkey][2],
            'p90_amount': PEER_DISTRIBUTIONS[pkey][4],
            'benchmark_threshold': PEER_DISTRIBUTIONS[pkey][5]
        }
        for pkey in PEER_DISTRIBUTIONS
    }


def compute_features_batch(
    df: pd.DataFrame,
    history=None,
    rolling_days: int = DEFAULT_ROLLING_GRAPH_DAYS,
    include_graph: bool = True,
    include_customer: bool = True
) -> pd.DataFrame:
    """
    Vectorized feature computation for AML detection across a batch of transactions.
    Computes base features, rolling network graph features, and customer layer features.
    
    Parameters:
    -----------
    df : pd.DataFrame
        DataFrame of transactions.
    history : pd.DataFrame, list of dicts, or dict of (account -> list of txs), optional
        Optional prior historical transactions per account.
    rolling_days : int
        Lookback window in days for rolling graph construction.
    include_graph : bool
        Whether to compute the 9 graph features (default True).
        
    Returns:
    --------
    pd.DataFrame
        Input DataFrame with computed feature columns.
        Input row order and index are strictly preserved.
    """
    cols_to_ensure = FEATURE_COLS if include_graph else BASE_FEATURE_COLS

    if df.empty:
        empty_res = df.copy()
        for col in cols_to_ensure:
            if col not in empty_res.columns:
                empty_res[col] = pd.Series(dtype=float)
        return empty_res

    df_work = df.copy()
    orig_index = df_work.index
    df_work['_is_history'] = False

    # Process optional prior history
    if history is not None and len(history) > 0:
        if isinstance(history, pd.DataFrame):
            hist_df = history.copy()
        elif isinstance(history, list):
            hist_df = pd.DataFrame(history)
        elif isinstance(history, dict):
            flat = []
            for acc, records in history.items():
                for r in records:
                    item = dict(r)
                    if 'sender_account' not in item and 'receiver_account' not in item:
                        item['sender_account'] = acc
                        item['receiver_account'] = acc
                    flat.append(item)
            hist_df = pd.DataFrame(flat)
        else:
            hist_df = pd.DataFrame(history)

        hist_df['_is_history'] = True
        combined = pd.concat([hist_df, df_work], ignore_index=True)
    else:
        combined = df_work.reset_index(drop=True)

    combined['timestamp'] = pd.to_datetime(combined['timestamp'], utc=True)
    combined['_orig_pos'] = np.arange(len(combined))

    # ── Static / Row-level features ───────────────────────────────────────────
    if 'amount_inr' in combined.columns:
        amount = pd.to_numeric(combined['amount_inr'], errors='coerce').fillna(0.0).clip(lower=0.0)
    else:
        amount = pd.to_numeric(combined.get('amount', 0), errors='coerce').fillna(0.0).clip(lower=0.0)
    combined['amount'] = amount
    combined['log_amount'] = np.log1p(amount)

    high_risk_countries = get_high_risk_countries()
    high_risk_methods = get_high_risk_payment_methods()
    struct_lower, struct_upper = get_structuring_bounds()
    large_amount_thresh = get_large_amount_threshold()
    night_hours = get_night_hours()

    country_col = combined.get('country', pd.Series('IN', index=combined.index)).fillna('IN')
    combined['is_high_risk_country'] = country_col.isin(high_risk_countries).astype(int)

    payment_method_col = combined.get('payment_method', pd.Series('UPI', index=combined.index)).fillna('UPI')
    combined['is_wire_or_crypto'] = payment_method_col.isin(high_risk_methods).astype(int)

    hours = combined['timestamp'].dt.hour
    combined['is_night'] = hours.isin(night_hours).astype(int)

    category_col = combined.get('category', pd.Series('Transfer', index=combined.index)).fillna('Transfer')
    combined['is_transfer'] = (category_col == 'Transfer').astype(int)

    combined['amount_near_threshold'] = (
        (amount >= struct_lower) & (amount <= struct_upper)
    ).astype(int)
    combined['is_large_amount'] = (amount >= large_amount_thresh).astype(int)

    # ── Behavioral Velocity & Time Diffs (Groupby + Rolling Time Windows) ─────
    if 'sender_account' in combined.columns and combined['sender_account'].notna().any():
        s_valid = combined[combined['sender_account'].notna()]
        s_sorted = s_valid.sort_values(
            ['sender_account', 'timestamp', '_is_history'],
            ascending=[True, True, False]
        )
        s_diff = (
            s_sorted.groupby('sender_account')['timestamp']
            .diff()
            .dt.total_seconds() / 60.0
        )
        s_vel = (
            s_sorted.groupby('sender_account')
            .rolling(VELOCITY_WINDOW, on='timestamp', closed='left')['timestamp']
            .count()
        )
        combined['sender_time_diff'] = (
            pd.Series(s_diff.values, index=s_sorted.index)
            .reindex(combined.index)
            .fillna(DEFAULT_TIME_DIFF)
        )
        combined['sender_velocity_2h'] = (
            pd.Series(s_vel.values, index=s_sorted.index)
            .reindex(combined.index)
            .fillna(0)
            .astype(int)
        )
    else:
        combined['sender_time_diff'] = DEFAULT_TIME_DIFF
        combined['sender_velocity_2h'] = 0

    if 'receiver_account' in combined.columns and combined['receiver_account'].notna().any():
        r_valid = combined[combined['receiver_account'].notna()]
        r_sorted = r_valid.sort_values(
            ['receiver_account', 'timestamp', '_is_history'],
            ascending=[True, True, False]
        )
        r_diff = (
            r_sorted.groupby('receiver_account')['timestamp']
            .diff()
            .dt.total_seconds() / 60.0
        )
        r_vel = (
            r_sorted.groupby('receiver_account')
            .rolling(VELOCITY_WINDOW, on='timestamp', closed='left')['timestamp']
            .count()
        )
        combined['receiver_time_diff'] = (
            pd.Series(r_diff.values, index=r_sorted.index)
            .reindex(combined.index)
            .fillna(DEFAULT_TIME_DIFF)
        )
        combined['receiver_velocity_2h'] = (
            pd.Series(r_vel.values, index=r_sorted.index)
            .reindex(combined.index)
            .fillna(0)
            .astype(int)
        )
    else:
        combined['receiver_time_diff'] = DEFAULT_TIME_DIFF
        combined['receiver_velocity_2h'] = 0

    # ── Rolling Graph Features ────────────────────────────────────────────────
    if include_graph:
        graph_feats_df = compute_rolling_graph_features(combined, rolling_days=rolling_days)
        for g_col in GRAPH_FEATURE_COLS:
            combined[g_col] = graph_feats_df[g_col].values

    # ── Customer Behavioral & Baseline Features ───────────────────────────────
    if include_customer:
        cust_feats_df = compute_customer_features(combined)
        for c_col in CUSTOMER_FEATURE_COLS:
            combined[c_col] = cust_feats_df[c_col].values

    # Strip out history rows, preserve original batch rows and order
    result = (
        combined[~combined['_is_history']]
        .sort_values('_orig_pos')
        .drop(columns=['_orig_pos', '_is_history'], errors='ignore')
    )
    result.index = orig_index
    return result


def compute_features_single(
    tx: dict,
    sender_history=None,
    receiver_history=None,
    graph_history=None,
    include_graph: bool = True,
    include_customer: bool = True
) -> dict:
    """
    Computes features for a single live transaction using sender and receiver history.
    Calls the exact same underlying vectorized logic as compute_features_batch.
    
    Parameters:
    -----------
    tx : dict
        Single transaction record.
    sender_history : list of dicts, optional
        Prior transactions involving the sender.
    receiver_history : list of dicts, optional
        Prior transactions involving the receiver.
    graph_history : list of dicts, optional
        Prior multi-hop transactions for local graph construction.
    include_graph : bool
        Whether to compute graph features (default True).
    include_customer : bool
        Whether to compute customer features (default True).
        
    Returns:
    --------
    dict
        Dictionary with keys for all requested FEATURE_COLS.
    """
    tx_dict = dict(tx)
    if 'timestamp' not in tx_dict or not tx_dict['timestamp']:
        tx_dict['timestamp'] = datetime.now().isoformat()
    if 'amount' not in tx_dict:
        tx_dict['amount'] = 0.0
    if 'country' not in tx_dict:
        tx_dict['country'] = 'IN'
    if 'payment_method' not in tx_dict:
        tx_dict['payment_method'] = 'Other'

    tx_time = pd.to_datetime(tx_dict['timestamp'], utc=True)
    sender_acc = tx_dict.get('sender_account', 'SENDER')
    receiver_acc = tx_dict.get('receiver_account', 'RECEIVER')

    hist_rows = []
    if graph_history:
        for g in graph_history:
            g_dict = dict(g)
            g_time = pd.to_datetime(g_dict.get('timestamp', tx_time), utc=True)
            if g_time <= tx_time:
                hist_rows.append(g_dict)
    else:
        if sender_history:
            for h in sender_history:
                h_dict = dict(h) if isinstance(h, dict) else {'timestamp': h}
                htime = pd.to_datetime(h_dict.get('timestamp', tx_time), utc=True)
                if htime <= tx_time:
                    hist_rows.append({
                        'sender_account': sender_acc,
                        'receiver_account': None,
                        'timestamp': htime,
                        'amount': float(h_dict.get('amount', 0.0) or 0.0),
                        'country': 'IN',
                        'payment_method': 'Other',
                        'category': 'Other',
                        'device_id': h_dict.get('device_id'),
                        'ip_address': h_dict.get('ip_address'),
                        'risk_score': float(h_dict.get('risk_score', 0.0) or 0.0)
                    })

        if receiver_history:
            for h in receiver_history:
                h_dict = dict(h) if isinstance(h, dict) else {'timestamp': h}
                htime = pd.to_datetime(h_dict.get('timestamp', tx_time), utc=True)
                if htime <= tx_time:
                    hist_rows.append({
                        'sender_account': None,
                        'receiver_account': receiver_acc,
                        'timestamp': htime,
                        'amount': float(h_dict.get('amount', 0.0) or 0.0),
                        'country': 'IN',
                        'payment_method': 'Other',
                        'category': 'Other',
                        'device_id': h_dict.get('device_id'),
                        'ip_address': h_dict.get('ip_address'),
                        'risk_score': float(h_dict.get('risk_score', 0.0) or 0.0)
                    })

    tx_df = pd.DataFrame([tx_dict])
    out_df = compute_features_batch(tx_df, history=hist_rows, include_graph=include_graph, include_customer=include_customer)
    row = out_df.iloc[0]

    res = {
        'log_amount':            float(row['log_amount']),
        'amount':                float(row['amount']),
        'is_high_risk_country':  int(row['is_high_risk_country']),
        'is_wire_or_crypto':     int(row['is_wire_or_crypto']),
        'is_night':              int(row['is_night']),
        'is_transfer':           int(row['is_transfer']),
        'amount_near_threshold': int(row['amount_near_threshold']),
        'is_large_amount':       int(row['is_large_amount']),
        'sender_time_diff':      float(row['sender_time_diff']),
        'receiver_time_diff':    float(row['receiver_time_diff']),
        'sender_velocity_2h':    int(row['sender_velocity_2h']),
        'receiver_velocity_2h':  int(row['receiver_velocity_2h']),
    }

    if include_graph:
        for g_col in GRAPH_FEATURE_COLS:
            res[g_col] = float(row[g_col])

    if include_customer:
        for c_col in CUSTOMER_FEATURE_COLS:
            res[c_col] = float(row[c_col]) if c_col in row else DEFAULT_CUSTOMER_FEAT_DICT[c_col]

    return res
