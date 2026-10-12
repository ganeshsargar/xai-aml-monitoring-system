"""
FundTraceAI AML Feature Engineering Module
Single source of truth for feature computation in both batch and single/live transaction modes.
Computes 12 base behavioral/transactional features + 9 rolling network graph features.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
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
]
# NOTE ON REMOVAL OF 'neighbor_max_risk':
# neighbor_max_risk was removed from model feature columns because the underlying transaction
# logs and training dataset lack point-in-time ground truth risk scores for counterparties.
# Attempting to derive counterparty risk from static labels, uncalibrated post-hoc scores, or
# future transactions introduces severe target leakage and lookahead bias into AML scoring.
# It should only be reintroduced if upstream tables provide calibrated point-in-time risk scores.

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
    'shared_device_degree': 0.0
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


from collections import deque


def compute_point_in_time_velocity_and_diff(
    df: pd.DataFrame,
    acc_col: str,
    window_hours: float = 2.0,
    default_diff: float = DEFAULT_TIME_DIFF
) -> Tuple[pd.Series, pd.Series]:
    """
    Computes strictly point-in-time velocity and time delta for account transactions.
    Uses timestamp and original position as a stable tiebreak:
    - Transactions with timestamp strictly earlier (or equal with tiebreak pos_j < pos_i)
      are included in the preceding window.
    - Future transactions (t_j > t_i or equal with pos_j >= pos_i) are strictly excluded.
    """
    if acc_col not in df.columns or not df[acc_col].notna().any() or df.empty:
        return pd.Series(default_diff, index=df.index), pd.Series(0, index=df.index)

    valid = df[df[acc_col].notna()].copy()
    if '_orig_pos' not in valid.columns:
        valid['_orig_pos'] = np.arange(len(valid))

    valid['timestamp'] = pd.to_datetime(valid['timestamp'], utc=True)
    sorted_df = valid.sort_values([acc_col, 'timestamp', '_orig_pos'], ascending=[True, True, True])

    window_ns = np.int64(window_hours * 3600 * 1e9)
    minute_ns = 60.0 * 1e9

    diff_arr = np.full(len(sorted_df), default_diff, dtype=float)
    vel_arr = np.zeros(len(sorted_df), dtype=int)

    acc_vals = sorted_df[acc_col].astype(str).values
    ts_vals = sorted_df['timestamp'].values.astype('datetime64[ns]').astype('int64')

    change_mask = np.concatenate(([True], acc_vals[1:] != acc_vals[:-1], [True]))
    split_indices = np.where(change_mask)[0]

    for start, end in zip(split_indices[:-1], split_indices[1:]):
        group_ts = ts_vals[start:end]
        n_grp = end - start

        # Strictly prior transactions in preceding window [t - window, t)
        left_idx = np.searchsorted(group_ts, group_ts - window_ns, side='left')
        vel_arr[start:end] = np.arange(n_grp) - left_idx

        # Time diff: elapsed minutes since immediately preceding transaction in account group
        if n_grp > 1:
            diff_arr[start + 1:end] = (group_ts[1:] - group_ts[:-1]) / minute_ns

    diff_s = pd.Series(diff_arr, index=sorted_df.index).reindex(df.index).fillna(default_diff)
    vel_s = pd.Series(vel_arr, index=sorted_df.index).reindex(df.index).fillna(0).astype(int)
    return diff_s, vel_s


def compute_rolling_graph_features(
    combined_df: pd.DataFrame,
    rolling_days: int = DEFAULT_ROLLING_GRAPH_DAYS
) -> pd.DataFrame:
    """
    Computes strictly point-in-time per-account graph features on a rolling graph.
    Maintains incremental/expanding window state over the preceding rolling_days history.
    For each transaction row:
    - Only transactions with timestamp strictly earlier (or equal with stable tiebreak pos_j <= pos_i)
      are visible in the active network graph.
    - Future transactions are never included, eliminating all lookahead bias.
    - Yields exact parity between batch evaluation and single/live transaction scoring for identical history.
    """
    n_rows = len(combined_df)
    if n_rows == 0:
        return pd.DataFrame(columns=GRAPH_FEATURE_COLS)

    graph_res = {col: np.zeros(n_rows, dtype=float) for col in GRAPH_FEATURE_COLS}

    if 'sender_account' not in combined_df.columns or 'receiver_account' not in combined_df.columns:
        return pd.DataFrame(graph_res, index=combined_df.index)

    df_work = combined_df.copy()
    if '_orig_pos' not in df_work.columns:
        df_work['_orig_pos'] = np.arange(n_rows)
    df_work['timestamp'] = pd.to_datetime(df_work['timestamp'], utc=True)

    sorted_df = df_work.sort_values(['timestamp', '_orig_pos'], ascending=[True, True])
    sorted_indices = sorted_df.index.values

    senders = sorted_df['sender_account'].astype(str).values
    receivers = sorted_df['receiver_account'].astype(str).values

    if 'amount_inr' in sorted_df.columns:
        amts = pd.to_numeric(sorted_df['amount_inr'], errors='coerce').fillna(0.0).clip(lower=0.0).values
    else:
        amts = pd.to_numeric(sorted_df.get('amount', 0), errors='coerce').fillna(0.0).clip(lower=0.0).values

    times = sorted_df['timestamp'].values.astype('datetime64[ns]').astype('int64')
    devs = sorted_df.get('device_id', pd.Series(None, index=sorted_df.index)).fillna('').astype(str).values
    ips = sorted_df.get('ip_address', pd.Series(None, index=sorted_df.index)).fillna('').astype(str).values

    rolling_ns = np.int64(rolling_days * 86400 * 1e9)
    cycle_ns = np.int64(72 * 3600 * 1e9)

    out_neighbors = {}
    in_neighbors = {}
    edge_count = {}
    edge_weight = {}
    latest_edge_ts = {}
    out_vol = {}
    in_vol = {}

    active_cycles = deque()  # (expiry_ns, set of nodes)
    node_cycle_count = {}

    dev_accounts = {}
    acc_dev_count = {}
    ip_accounts = {}
    acc_ip_count = {}

    res_dict = {c: np.zeros(n_rows, dtype=float) for c in GRAPH_FEATURE_COLS}

    left = 0
    pr = {}
    d = 0.85

    for k in range(n_rows):
        t_k = times[k]
        s = senders[k]
        r = receivers[k]
        amt = float(amts[k])
        dev = devs[k]
        ip = ips[k]

        t_min_win = t_k - rolling_ns
        t_min_cyc = t_k - cycle_ns

        # 1. Evict transactions older than rolling lookback window
        while left < k and times[left] < t_min_win:
            s_l, r_l, amt_l = senders[left], receivers[left], amts[left]
            dev_l, ip_l = devs[left], ips[left]

            edge_count[(s_l, r_l)] -= 1
            edge_weight[(s_l, r_l)] -= amt_l
            if edge_count[(s_l, r_l)] == 0:
                out_neighbors[s_l].discard(r_l)
                in_neighbors[r_l].discard(s_l)

            out_vol[s_l] = max(0.0, out_vol.get(s_l, 0.0) - amt_l)
            in_vol[r_l] = max(0.0, in_vol.get(r_l, 0.0) - amt_l)

            if dev_l and dev_l not in ('', 'None', 'nan', '0'):
                acc_dev_count[(s_l, dev_l)] -= 1
                if acc_dev_count[(s_l, dev_l)] == 0:
                    dev_accounts[dev_l].discard(s_l)
            if ip_l and ip_l not in ('', 'None', 'nan', '0'):
                acc_ip_count[(s_l, ip_l)] -= 1
                if acc_ip_count[(s_l, ip_l)] == 0:
                    ip_accounts[ip_l].discard(s_l)
            left += 1

        # 2. Evict expired cycles
        while active_cycles and active_cycles[0][0] < t_k:
            exp_ns, cyc_nodes = active_cycles.popleft()
            for node in cyc_nodes:
                node_cycle_count[node] = max(0, node_cycle_count.get(node, 0) - 1)

        # 3. Detect if current transaction closes a temporal cycle
        # Cycle completes ONLY if there was already a directed path from r to s in past 72h
        if s and r and s != r and r in out_neighbors:
            has_cycle = False
            queue = deque([(r, t_min_cyc, 0, [r])])
            visited = {r}
            found_cycle_nodes = set()
            t_first_cycle = t_k

            while queue:
                curr, curr_t, depth, path = queue.popleft()
                if depth >= 5:
                    continue
                for nxt in out_neighbors.get(curr, ()):
                    edge_t = latest_edge_ts.get((curr, nxt), 0)
                    if curr_t <= edge_t <= t_k:
                        if nxt == s:
                            has_cycle = True
                            found_cycle_nodes = set(path + [s])
                            t_first_cycle = curr_t if depth > 0 else edge_t
                            break
                        if nxt not in visited and depth < 4:
                            visited.add(nxt)
                            queue.append((nxt, edge_t, depth + 1, path + [nxt]))
                if has_cycle:
                    break

            if has_cycle and found_cycle_nodes:
                active_cycles.append((t_first_cycle + cycle_ns, found_cycle_nodes))
                for node in found_cycle_nodes:
                    node_cycle_count[node] = node_cycle_count.get(node, 0) + 1

        # 4. Add current transaction to active point-in-time graph
        edge_count[(s, r)] = edge_count.get((s, r), 0) + 1
        edge_weight[(s, r)] = edge_weight.get((s, r), 0.0) + amt
        latest_edge_ts[(s, r)] = t_k
        out_neighbors.setdefault(s, set()).add(r)
        in_neighbors.setdefault(r, set()).add(s)
        out_vol[s] = out_vol.get(s, 0.0) + amt
        in_vol[r] = in_vol.get(r, 0.0) + amt

        if dev and dev not in ('', 'None', 'nan', '0'):
            acc_dev_count[(s, dev)] = acc_dev_count.get((s, dev), 0) + 1
            dev_accounts.setdefault(dev, set()).add(s)
        if ip and ip not in ('', 'None', 'nan', '0'):
            acc_ip_count[(s, ip)] = acc_ip_count.get((s, ip), 0) + 1
            ip_accounts.setdefault(ip, set()).add(s)

        # 5. Incremental PageRank centrality update
        if s not in pr:
            pr[s] = 1.0 / (len(pr) + 1)
        if r not in pr:
            pr[r] = 1.0 / (len(pr) + 1)
        N = max(1, len(pr))
        base = (1.0 - d) / N
        in_flow_s = sum(
            pr.get(u, 1.0 / N) * (edge_weight.get((u, s), 0.0) / max(1.0, out_vol.get(u, 1.0)))
            for u in in_neighbors.get(s, ())
        )
        in_flow_r = sum(
            pr.get(u, 1.0 / N) * (edge_weight.get((u, r), 0.0) / max(1.0, out_vol.get(u, 1.0)))
            for u in in_neighbors.get(r, ())
        )
        pr[s] = base + d * in_flow_s
        pr[r] = base + d * in_flow_r

        # 6. Extract point-in-time graph features for transaction row k
        res_dict['in_degree'][k] = float(len(in_neighbors.get(s, ())))
        res_dict['out_degree'][k] = float(len(out_neighbors.get(s, ())))

        cp_s = len(in_neighbors.get(s, set()) | out_neighbors.get(s, set()))
        cp_r = len(in_neighbors.get(r, set()) | out_neighbors.get(r, set()))
        res_dict['distinct_counterparties'][k] = float(max(cp_s, cp_r))

        s_max = max(in_vol.get(s, 0.0), out_vol.get(s, 0.0))
        s_min = min(in_vol.get(s, 0.0), out_vol.get(s, 0.0))
        pt_s = s_min / s_max if s_max > 0 else 0.0
        r_max = max(in_vol.get(r, 0.0), out_vol.get(r, 0.0))
        r_min = min(in_vol.get(r, 0.0), out_vol.get(r, 0.0))
        pt_r = r_min / r_max if r_max > 0 else 0.0
        res_dict['pass_through_ratio'][k] = float(max(pt_s, pt_r))

        c_s = 1.0 if node_cycle_count.get(s, 0) > 0 else 0.0
        c_r = 1.0 if node_cycle_count.get(r, 0) > 0 else 0.0
        res_dict['in_cycle'][k] = float(max(c_s, c_r))
        res_dict['cycle_count'][k] = float(max(node_cycle_count.get(s, 0), node_cycle_count.get(r, 0)))

        sh_s = set()
        if dev and dev in dev_accounts:
            sh_s |= dev_accounts[dev]
        if ip and ip in ip_accounts:
            sh_s |= ip_accounts[ip]
        sh_s.discard(s)
        res_dict['shared_device_degree'][k] = float(len(sh_s))

        res_dict['pagerank'][k] = float(max(pr.get(s, 0.0), pr.get(r, 0.0)))

    out_df = pd.DataFrame(res_dict, index=sorted_indices)
    return out_df.reindex(combined_df.index)


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

    # ── Behavioral Velocity & Time Diffs (Point-in-Time with Stable Tiebreak) ──
    s_diff, s_vel = compute_point_in_time_velocity_and_diff(
        combined, 'sender_account', window_hours=2.0, default_diff=DEFAULT_TIME_DIFF
    )
    combined['sender_time_diff'] = s_diff
    combined['sender_velocity_2h'] = s_vel

    r_diff, r_vel = compute_point_in_time_velocity_and_diff(
        combined, 'receiver_account', window_hours=2.0, default_diff=DEFAULT_TIME_DIFF
    )
    combined['receiver_time_diff'] = r_diff
    combined['receiver_velocity_2h'] = r_vel

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
