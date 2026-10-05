"""
FundTraceAI AML Graph Analytics & Network Detection Module
Provides:
1. Anti-Money Laundering Detectors:
   - Smurfing (fan-in >= N senders within window, followed by outflow >= 80% within X hours)
   - Fan-out (dispersion to >= M receivers within window)
   - Pass-through accounts (rapid transit where in ≈ out within hours)
   - Temporal cycles (chronological wash trading loops within time window)
   - Shared device / IP infrastructure linking accounts
2. Per-account graph features extractor for ML model
3. Cytoscape.js network visualizer analytics with zero label leakage
"""

import math
from datetime import datetime, timedelta
from typing import Dict, List, Set, Tuple, Optional, Any
import networkx as nx
import pandas as pd
import numpy as np


# ── Configuration Defaults ───────────────────────────────────────────────────
DEFAULT_SMURFING_MIN_SENDERS = 3
DEFAULT_SMURFING_WINDOW_HOURS = 48.0
DEFAULT_SMURFING_OUTFLOW_DELAY_HOURS = 24.0
DEFAULT_SMURFING_OUTFLOW_RATIO = 0.80

DEFAULT_FAN_OUT_MIN_RECEIVERS = 3
DEFAULT_FAN_OUT_WINDOW_HOURS = 48.0
DEFAULT_FAN_OUT_OUTFLOW_RATIO = 0.80

DEFAULT_PASS_THROUGH_WINDOW_HOURS = 24.0
DEFAULT_PASS_THROUGH_MIN_RATIO = 0.80
DEFAULT_PASS_THROUGH_MAX_RATIO = 1.25

DEFAULT_CYCLE_WINDOW_HOURS = 72.0
DEFAULT_MAX_CYCLE_LENGTH = 6


def _parse_timestamp(val) -> Optional[datetime]:
    """Helper to safely parse diverse timestamp formats into datetime object."""
    if val is None or pd.isna(val):
        return None
    if isinstance(val, (datetime, pd.Timestamp)):
        return val.to_pydatetime() if hasattr(val, 'to_pydatetime') else val
    try:
        return pd.to_datetime(val).to_pydatetime()
    except Exception:
        return None


# ── 1. Temporal Cycle Detector ────────────────────────────────────────────────

def detect_temporal_cycles(
    G: nx.DiGraph,
    transactions: List[Dict[str, Any]],
    cycle_window_hours: float = DEFAULT_CYCLE_WINDOW_HOURS,
    max_cycle_length: int = DEFAULT_MAX_CYCLE_LENGTH
) -> Tuple[List[Dict[str, Any]], Set[str], Set[str], Dict[str, int]]:
    """
    Detects circular money flows (wash trading / round-tripping) where capital flows
    in chronological sequence along the cycle within a bounded time window.
    
    Returns:
    --------
    (detected_cycles, cycle_nodes, cycle_edge_keys, cycle_counts_per_node)
    """
    detected_cycles = []
    cycle_nodes: Set[str] = set()
    cycle_edge_keys: Set[str] = set()
    cycle_counts: Dict[str, int] = {node: 0 for node in G.nodes()}

    if len(G) < 2 or G.number_of_edges() < 2:
        return detected_cycles, cycle_nodes, cycle_edge_keys, cycle_counts

    # Index transactions by directed edge (sender -> receiver) with parsed timestamps
    edge_txs: Dict[Tuple[str, str], List[datetime]] = {}
    for tx in transactions:
        u = str(tx.get('sender_account', ''))
        v = str(tx.get('receiver_account', ''))
        t = _parse_timestamp(tx.get('timestamp'))
        if u and v and t:
            key = (u, v)
            if key not in edge_txs:
                edge_txs[key] = []
            edge_txs[key].append(t)

    for k in edge_txs:
        edge_txs[k].sort()

    try:
        raw_cycles = list(nx.simple_cycles(G, length_bound=max_cycle_length))
    except Exception:
        return detected_cycles, cycle_nodes, cycle_edge_keys, cycle_counts

    max_seconds = cycle_window_hours * 3600.0

    for cycle in raw_cycles:
        k = len(cycle)
        if k < 2 or k > max_cycle_length:
            continue

        edges = [(str(cycle[i]), str(cycle[(i + 1) % k])) for i in range(k)]
        
        # Verify if all edges have transactions
        if not all(e in edge_txs and len(edge_txs[e]) > 0 for e in edges):
            continue

        # Check all k cyclic rotations of edges to see if any rotation flows chronologically
        is_temporally_valid = False
        valid_cycle_edges = edges

        for rot in range(k):
            rotated_edges = edges[rot:] + edges[:rot]
            first_edge = rotated_edges[0]

            for t0 in edge_txs[first_edge]:
                curr_t = t0
                step_valid = True
                for step_idx in range(1, k):
                    next_edge = rotated_edges[step_idx]
                    candidates = [
                        t for t in edge_txs[next_edge] 
                        if t >= curr_t and (t - t0).total_seconds() <= max_seconds
                    ]
                    if not candidates:
                        step_valid = False
                        break
                    curr_t = candidates[0]

                if step_valid and (curr_t - t0).total_seconds() <= max_seconds:
                    is_temporally_valid = True
                    valid_cycle_edges = rotated_edges
                    break

            if is_temporally_valid:
                break

        if is_temporally_valid:
            cycle_edge_strs = [f"{u}->{v}" for u, v in valid_cycle_edges]
            for u, v in valid_cycle_edges:
                cycle_nodes.add(u)
                cycle_nodes.add(v)
                cycle_edge_keys.add(f"{u}->{v}")
                cycle_counts[u] = cycle_counts.get(u, 0) + 1

            detected_cycles.append({
                'nodes': cycle,
                'edges': cycle_edge_strs,
                'length': k
            })

    return detected_cycles, cycle_nodes, cycle_edge_keys, cycle_counts


# ── 2. Smurfing Detector ──────────────────────────────────────────────────────

def detect_smurfing(
    transactions: List[Dict[str, Any]],
    min_senders: int = DEFAULT_SMURFING_MIN_SENDERS,
    window_hours: float = DEFAULT_SMURFING_WINDOW_HOURS,
    outflow_delay_hours: float = DEFAULT_SMURFING_OUTFLOW_DELAY_HOURS,
    outflow_ratio: float = DEFAULT_SMURFING_OUTFLOW_RATIO
) -> Set[str]:
    """
    Detects smurfing aggregation:
    Fan-in >= min_senders distinct senders into account within window_hours,
    followed by an outflow within outflow_delay_hours of >= outflow_ratio of total inflow.
    """
    smurfing_nodes: Set[str] = set()

    # Organize transactions per account
    in_per_acc: Dict[str, List[Dict[str, Any]]] = {}
    out_per_acc: Dict[str, List[Dict[str, Any]]] = {}

    for tx in transactions:
        s = str(tx.get('sender_account', ''))
        r = str(tx.get('receiver_account', ''))
        amt = float(tx.get('amount', 0.0) or 0.0)
        t = _parse_timestamp(tx.get('timestamp'))
        if not t or amt <= 0:
            continue

        item = {'amount': amt, 'timestamp': t, 'counterparty': s}
        if r:
            in_per_acc.setdefault(r, []).append(item)
        if s:
            out_per_acc.setdefault(s, []).append({'amount': amt, 'timestamp': t, 'counterparty': r})

    window_delta = timedelta(hours=window_hours)
    delay_delta = timedelta(hours=outflow_delay_hours)

    for acc, in_list in in_per_acc.items():
        if len(in_list) < min_senders:
            continue
        out_list = out_per_acc.get(acc, [])
        if not out_list:
            continue

        in_sorted = sorted(in_list, key=lambda x: x['timestamp'])
        out_sorted = sorted(out_list, key=lambda x: x['timestamp'])

        for i, first_in in enumerate(in_sorted):
            t_start = first_in['timestamp']
            t_end = t_start + window_delta

            window_ins = [x for x in in_sorted[i:] if x['timestamp'] <= t_end]
            senders = {x['counterparty'] for x in window_ins}

            if len(senders) >= min_senders:
                total_inflow = sum(x['amount'] for x in window_ins)
                last_in_time = max(x['timestamp'] for x in window_ins)

                # Check outbound transactions occurring up to outflow_delay_hours after the inflow period
                t_out_max = last_in_time + delay_delta
                matching_outs = [
                    x for x in out_sorted 
                    if t_start <= x['timestamp'] <= t_out_max
                ]
                total_outflow = sum(x['amount'] for x in matching_outs)

                if total_inflow > 0 and total_outflow >= outflow_ratio * total_inflow:
                    smurfing_nodes.add(acc)
                    break

    return smurfing_nodes


# ── 3. Fan-Out Detector ───────────────────────────────────────────────────────

def detect_fan_out(
    transactions: List[Dict[str, Any]],
    min_receivers: int = DEFAULT_FAN_OUT_MIN_RECEIVERS,
    window_hours: float = DEFAULT_FAN_OUT_WINDOW_HOURS,
    outflow_ratio: float = DEFAULT_FAN_OUT_OUTFLOW_RATIO
) -> Set[str]:
    """
    Detects fan-out dispersion:
    An account receives funds, and then within window_hours disperses funds to
    >= min_receivers distinct recipient accounts totaling >= outflow_ratio of inflow.
    """
    fan_out_nodes: Set[str] = set()

    in_per_acc: Dict[str, List[Dict[str, Any]]] = {}
    out_per_acc: Dict[str, List[Dict[str, Any]]] = {}

    for tx in transactions:
        s = str(tx.get('sender_account', ''))
        r = str(tx.get('receiver_account', ''))
        amt = float(tx.get('amount', 0.0) or 0.0)
        t = _parse_timestamp(tx.get('timestamp'))
        if not t or amt <= 0:
            continue

        if r:
            in_per_acc.setdefault(r, []).append({'amount': amt, 'timestamp': t, 'counterparty': s})
        if s:
            out_per_acc.setdefault(s, []).append({'amount': amt, 'timestamp': t, 'counterparty': r})

    window_delta = timedelta(hours=window_hours)

    for acc, out_list in out_per_acc.items():
        if len(out_list) < min_receivers:
            continue
        in_list = in_per_acc.get(acc, [])

        out_sorted = sorted(out_list, key=lambda x: x['timestamp'])

        for i, first_out in enumerate(out_sorted):
            t_start = first_out['timestamp']
            t_end = t_start + window_delta

            window_outs = [x for x in out_sorted[i:] if x['timestamp'] <= t_end]
            receivers = {x['counterparty'] for x in window_outs}

            if len(receivers) >= min_receivers:
                total_out = sum(x['amount'] for x in window_outs)
                
                # Check preceding or overlapping inflows
                prior_inflows = [
                    x for x in in_list 
                    if x['timestamp'] <= t_end and (t_start - x['timestamp']).total_seconds() <= window_hours * 3600 * 2
                ]
                total_in = sum(x['amount'] for x in prior_inflows)

                if total_in > 0 and total_out >= outflow_ratio * total_in:
                    fan_out_nodes.add(acc)
                    break
                elif total_in == 0 and len(receivers) >= min_receivers and total_out >= 500000:
                    # High-value root dispersion
                    fan_out_nodes.add(acc)
                    break

    return fan_out_nodes


# ── 4. Pass-Through Accounts Detector ─────────────────────────────────────────

def detect_pass_through(
    transactions: List[Dict[str, Any]],
    window_hours: float = DEFAULT_PASS_THROUGH_WINDOW_HOURS,
    min_ratio: float = DEFAULT_PASS_THROUGH_MIN_RATIO,
    max_ratio: float = DEFAULT_PASS_THROUGH_MAX_RATIO
) -> Tuple[Set[str], Dict[str, float]]:
    """
    Detects pass-through / transit accounts where incoming funds are almost immediately
    forwarded outbound with near-zero balance retention (in ≈ out within hours).
    
    Returns:
    --------
    (pass_through_nodes, account_pass_through_ratios)
    """
    pass_through_nodes: Set[str] = set()
    ratios: Dict[str, float] = {}

    in_per_acc: Dict[str, List[Dict[str, Any]]] = {}
    out_per_acc: Dict[str, List[Dict[str, Any]]] = {}
    total_in_per_acc: Dict[str, float] = {}
    total_out_per_acc: Dict[str, float] = {}

    for tx in transactions:
        s = str(tx.get('sender_account', ''))
        r = str(tx.get('receiver_account', ''))
        amt = float(tx.get('amount', 0.0) or 0.0)
        t = _parse_timestamp(tx.get('timestamp'))
        if not t or amt <= 0:
            continue

        if r:
            in_per_acc.setdefault(r, []).append({'amount': amt, 'timestamp': t})
            total_in_per_acc[r] = total_in_per_acc.get(r, 0.0) + amt
        if s:
            out_per_acc.setdefault(s, []).append({'amount': amt, 'timestamp': t})
            total_out_per_acc[s] = total_out_per_acc.get(s, 0.0) + amt

    all_accounts = set(in_per_acc.keys()) | set(out_per_acc.keys())
    for acc in all_accounts:
        in_amt = total_in_per_acc.get(acc, 0.0)
        out_amt = total_out_per_acc.get(acc, 0.0)
        max_amt = max(in_amt, out_amt)
        min_amt = min(in_amt, out_amt)
        ratios[acc] = float(min_amt / max_amt) if max_amt > 0 else 0.0

    window_delta = timedelta(hours=window_hours)

    for acc in all_accounts:
        in_list = in_per_acc.get(acc, [])
        out_list = out_per_acc.get(acc, [])
        if not in_list or not out_list:
            continue

        in_sorted = sorted(in_list, key=lambda x: x['timestamp'])
        out_sorted = sorted(out_list, key=lambda x: x['timestamp'])

        for in_tx in in_sorted:
            t_in = in_tx['timestamp']
            t_max = t_in + window_delta
            in_val = in_tx['amount']

            matching_outs = [
                out_tx for out_tx in out_sorted 
                if t_in <= out_tx['timestamp'] <= t_max
            ]
            if not matching_outs:
                continue

            for out_tx in matching_outs:
                out_val = out_tx['amount']
                ratio = out_val / in_val if in_val > 0 else 0.0
                if min_ratio <= ratio <= max_ratio:
                    pass_through_nodes.add(acc)
                    break
            if acc in pass_through_nodes:
                break

    return pass_through_nodes, ratios


# ── 5. Shared Device / IP Detector ───────────────────────────────────────────

def detect_shared_devices(
    transactions: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """
    Detects distinct accounts sharing device_id or ip_address infrastructure.
    Returns:
    --------
    (shared_edges, shared_device_degrees)
    """
    device_to_accounts: Dict[str, Set[str]] = {}
    ip_to_accounts: Dict[str, Set[str]] = {}
    all_accounts: Set[str] = set()

    for tx in transactions:
        s = str(tx.get('sender_account', ''))
        r = str(tx.get('receiver_account', ''))
        dev = tx.get('device_id') or tx.get('device')
        ip = tx.get('ip_address') or tx.get('ip')

        if s:
            all_accounts.add(s)
        if r:
            all_accounts.add(r)

        if dev and str(dev).strip() and str(dev) not in ('None', 'nan', '0', ''):
            dev_str = str(dev).strip()
            if s:
                device_to_accounts.setdefault(dev_str, set()).add(s)

        if ip and str(ip).strip() and str(ip) not in ('None', 'nan', '0', ''):
            ip_str = str(ip).strip()
            if s:
                ip_to_accounts.setdefault(ip_str, set()).add(s)

    shared_pairs: Dict[Tuple[str, str], Dict[str, str]] = {}
    shared_neighbors: Dict[str, Set[str]] = {acc: set() for acc in all_accounts}

    # Cluster by device
    for dev, accs in device_to_accounts.items():
        if len(accs) >= 2:
            acc_list = sorted(list(accs))
            for i in range(len(acc_list)):
                for j in range(i + 1, len(acc_list)):
                    u, v = acc_list[i], acc_list[j]
                    shared_neighbors[u].add(v)
                    shared_neighbors[v].add(u)
                    shared_pairs[(u, v)] = {'device_id': dev}

    # Cluster by IP address
    for ip, accs in ip_to_accounts.items():
        if len(accs) >= 2:
            acc_list = sorted(list(accs))
            for i in range(len(acc_list)):
                for j in range(i + 1, len(acc_list)):
                    u, v = acc_list[i], acc_list[j]
                    shared_neighbors[u].add(v)
                    shared_neighbors[v].add(u)
                    existing = shared_pairs.get((u, v), {})
                    existing['ip_address'] = ip
                    shared_pairs[(u, v)] = existing

    shared_edges = []
    for (u, v), meta in shared_pairs.items():
        shared_edges.append({
            'source': u,
            'target': v,
            'edge_type': 'shared_device',
            'device_id': meta.get('device_id', ''),
            'ip_address': meta.get('ip_address', '')
        })

    shared_device_degrees = {
        acc: len(neighbors) for acc, neighbors in shared_neighbors.items()
    }

    return shared_edges, shared_device_degrees


# ── 6. Per-Account Graph Features Extractor ───────────────────────────────────

def compute_account_graph_features(
    transactions: List[Dict[str, Any]],
    cycle_window_hours: float = DEFAULT_CYCLE_WINDOW_HOURS
) -> Dict[str, Dict[str, float]]:
    """
    Computes per-account topological & temporal graph features:
    - in_degree: number of inbound transaction edges
    - out_degree: number of outbound transaction edges
    - distinct_counterparties: count of unique counterparties
    - pass_through_ratio: min(in_vol, out_vol) / max(in_vol, out_vol)
    - in_cycle: binary (1 if part of temporal cycle, else 0)
    - cycle_count: number of temporal cycles involving account
    - pagerank: PageRank centrality in transaction graph
    - shared_device_degree: count of other accounts sharing device/IP
    - neighbor_max_risk: max risk score among 1-hop counterparties (derived without label leakage)

    Returns:
    --------
    Dict[str, Dict[str, float]]
    """
    G = nx.DiGraph()
    all_accounts: Set[str] = set()
    node_max_risk: Dict[str, float] = {}
    counterparties: Dict[str, Set[str]] = {}

    for tx in transactions:
        s = str(tx.get('sender_account', ''))
        r = str(tx.get('receiver_account', ''))
        amt = float(tx.get('amount', 0.0) or 0.0)
        risk = float(tx.get('risk_score', 0.0) or 0.0)

        if s:
            all_accounts.add(s)
            node_max_risk[s] = max(node_max_risk.get(s, 0.0), risk)
        if r:
            all_accounts.add(r)
            node_max_risk[r] = max(node_max_risk.get(r, 0.0), risk)

        if s and r:
            counterparties.setdefault(s, set()).add(r)
            counterparties.setdefault(r, set()).add(s)
            G.add_edge(s, r, weight=amt)

    # 1. PageRank
    if len(G) > 0:
        try:
            pagerank = nx.pagerank(G, weight='weight', max_iter=200)
        except Exception:
            try:
                pagerank = nx.pagerank(G, max_iter=200)
            except Exception:
                pagerank = {n: 0.0 for n in all_accounts}
    else:
        pagerank = {n: 0.0 for n in all_accounts}

    # 2. Temporal cycles
    _, cycle_nodes, _, cycle_counts = detect_temporal_cycles(
        G, transactions, cycle_window_hours=cycle_window_hours
    )

    # 3. Pass-through ratio
    _, pt_ratios = detect_pass_through(transactions)

    # 4. Shared device degrees
    _, shared_dev_degrees = detect_shared_devices(transactions)

    # 5. Neighbor Max Risk (derived purely from counterparties' risk_score, no is_laundering)
    neighbor_max_risk: Dict[str, float] = {}
    for acc in all_accounts:
        neighs = counterparties.get(acc, set())
        if neighs:
            neighbor_max_risk[acc] = float(max([node_max_risk.get(n, 0.0) for n in neighs]))
        else:
            neighbor_max_risk[acc] = 0.0

    account_features: Dict[str, Dict[str, float]] = {}
    for acc in all_accounts:
        in_deg = float(G.in_degree(acc)) if G.has_node(acc) else 0.0
        out_deg = float(G.out_degree(acc)) if G.has_node(acc) else 0.0
        c_count = cycle_counts.get(acc, 0)
        is_cyc = 1.0 if acc in cycle_nodes or c_count > 0 else 0.0

        account_features[acc] = {
            'in_degree': in_deg,
            'out_degree': out_deg,
            'distinct_counterparties': float(len(counterparties.get(acc, set()))),
            'pass_through_ratio': float(pt_ratios.get(acc, 0.0)),
            'in_cycle': is_cyc,
            'cycle_count': float(c_count),
            'pagerank': float(pagerank.get(acc, 0.0)),
            'shared_device_degree': float(shared_dev_degrees.get(acc, 0)),
            'neighbor_max_risk': float(neighbor_max_risk.get(acc, 0.0))
        }

    return account_features


# ── 7. Cytoscape Network Visualizer Analysis ──────────────────────────────────

def analyze_transaction_graph(transactions_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Accepts a list of transactions, constructs a NetworkX Directed Graph,
    runs AML graph pattern detectors, and returns elements formatted for Cytoscape.js.
    
    Zero Label Leakage:
    Flags nodes strictly based on model risk scores and network topology, NEVER
    using input ground-truth 'is_laundering'.
    """
    G = nx.DiGraph()
    account_info: Dict[str, Dict[str, Any]] = {}
    incoming_volumes: Dict[str, float] = {}
    outgoing_volumes: Dict[str, float] = {}

    for tx in transactions_list:
        sender = str(tx.get('sender_account', ''))
        receiver = str(tx.get('receiver_account', ''))
        if not sender or not receiver:
            continue

        sender_name = tx.get('sender_name', f"Acc_{sender}")
        receiver_name = tx.get('receiver_name', f"Acc_{receiver}")
        amount = float(tx.get('amount', 0.0) or 0.0)
        tx_id = tx.get('transaction_id', f"TX_{sender}_{receiver}")
        risk_score = float(tx.get('risk_score', 0.0) or 0.0)

        incoming_volumes[receiver] = incoming_volumes.get(receiver, 0.0) + amount
        outgoing_volumes[sender] = outgoing_volumes.get(sender, 0.0) + amount

        for acc, name in [(sender, sender_name), (receiver, receiver_name)]:
            if acc not in account_info:
                account_info[acc] = {
                    'account_number': acc,
                    'holder_name': name,
                    'max_risk_score': risk_score,
                    'transaction_count': 0,
                    'total_volume': 0.0,
                    'is_flagged': 0
                }
            account_info[acc]['transaction_count'] += 1
            account_info[acc]['total_volume'] += amount
            if risk_score > account_info[acc]['max_risk_score']:
                account_info[acc]['max_risk_score'] = risk_score

        G.add_edge(
            sender,
            receiver,
            id=tx_id,
            amount=amount,
            timestamp=tx.get('timestamp'),
            risk_score=risk_score,
            edge_type='transaction'
        )

    if len(G) == 0:
        return {'elements': [], 'summary': {}}

    # Centralities
    try:
        pagerank = nx.pagerank(G, weight='amount', max_iter=200)
    except Exception:
        try:
            pagerank = nx.pagerank(G, max_iter=200)
        except Exception:
            pagerank = {n: 0.0 for n in G.nodes()}

    try:
        betweenness = nx.betweenness_centrality(G, weight='amount')
    except Exception:
        betweenness = {n: 0.0 for n in G.nodes()}

    try:
        closeness = nx.closeness_centrality(G)
    except Exception:
        closeness = {n: 0.0 for n in G.nodes()}

    try:
        degree_cent = nx.degree_centrality(G)
    except Exception:
        degree_cent = {n: 0.0 for n in G.nodes()}

    # Community Detection (Louvain)
    undirected_G = G.to_undirected()
    try:
        communities = nx.community.louvain_communities(undirected_G, weight='amount', seed=42)
        community_map = {}
        for c_idx, comm in enumerate(communities):
            for node in comm:
                community_map[node] = c_idx
    except Exception:
        community_map = {node: 0 for node in G.nodes()}

    # AML Detectors
    detected_cycles, cycle_nodes, cycle_edge_keys, _ = detect_temporal_cycles(G, transactions_list)
    sccs = list(nx.strongly_connected_components(G))
    fraud_rings = [list(scc) for scc in sccs if len(scc) > 1]
    fraud_ring_nodes = {node for ring in fraud_rings for node in ring}

    smurfing_nodes = detect_smurfing(transactions_list)
    fan_out_nodes = detect_fan_out(transactions_list)
    pass_through_nodes, pass_through_ratios = detect_pass_through(transactions_list)
    shared_device_edges, shared_device_degrees = detect_shared_devices(transactions_list)

    # Risk Propagation Calculation
    risk_propagation = {}
    for node in G.nodes():
        neighbors = list(G.predecessors(node)) + list(G.successors(node))
        if neighbors:
            neighbor_risks = [account_info[neigh]['max_risk_score'] for neigh in neighbors if neigh in account_info]
            risk_propagation[node] = float(round(sum(neighbor_risks) / len(neighbor_risks), 2)) if neighbor_risks else 0.0
        else:
            risk_propagation[node] = float(round(account_info[node]['max_risk_score'], 2))

    # Format Cytoscape Elements
    elements = []

    # Add Nodes (Flagged strictly by risk score and topology without label leakage)
    for node in G.nodes():
        info = account_info[node]
        pr = pagerank.get(node, 0.0)
        btn = betweenness.get(node, 0.0)
        cls = closeness.get(node, 0.0)
        deg = degree_cent.get(node, 0.0)
        comm = community_map.get(node, 0)
        pt_ratio = pass_through_ratios.get(node, 0.0)
        sh_dev_deg = shared_device_degrees.get(node, 0)

        is_structural_anomaly = (
            node in cycle_nodes
            or node in fraud_ring_nodes
            or node in smurfing_nodes
            or node in fan_out_nodes
            or node in pass_through_nodes
            or sh_dev_deg >= 2
        )

        # Zero label leakage node classification
        if info['max_risk_score'] >= 80 or (info['max_risk_score'] >= 60 and is_structural_anomaly):
            info['is_flagged'] = 1
            node_risk = 'Critical'
        elif info['max_risk_score'] >= 60 or is_structural_anomaly:
            node_risk = 'High'
        elif info['max_risk_score'] >= 35:
            node_risk = 'Medium'
        else:
            node_risk = 'Low'

        elements.append({
            'data': {
                'id': node,
                'label': f"{info['holder_name']}\n({node})",
                'account_number': node,
                'holder_name': info['holder_name'],
                'risk_level': node_risk,
                'max_risk_score': round(info['max_risk_score'], 2),
                'pagerank': float(round(pr, 4)),
                'betweenness': float(round(btn, 4)),
                'closeness': float(round(cls, 4)),
                'degree_centrality': float(round(deg, 4)),
                'risk_propagation': risk_propagation.get(node, 0.0),
                'community': int(comm),
                'transaction_count': info['transaction_count'],
                'incoming_amount': round(incoming_volumes.get(node, 0.0), 2),
                'outgoing_amount': round(outgoing_volumes.get(node, 0.0), 2),
                'network_score': float(round(pr * 100 + risk_propagation.get(node, 0.0) * 0.5, 2)),
                'total_volume': round(info['total_volume'], 2),
                'is_cycle': 1 if node in cycle_nodes else 0,
                'is_fraud_ring': 1 if node in fraud_ring_nodes else 0,
                'is_smurfing': 1 if node in smurfing_nodes else 0,
                'is_fan_out': 1 if node in fan_out_nodes else 0,
                'is_pass_through': 1 if node in pass_through_nodes else 0,
                'pass_through_ratio': round(pt_ratio, 3),
                'shared_device_degree': sh_dev_deg,
                'type': 'node'
            }
        })

    # Add Transaction Edges
    for u, v, edge_data in G.edges(data=True):
        edge_key = f"{u}->{v}"
        is_in_cycle = 1 if edge_key in cycle_edge_keys else 0
        is_fraud_ring_edge = 1 if (u in fraud_ring_nodes and v in fraud_ring_nodes) else 0

        elements.append({
            'data': {
                'id': edge_data['id'],
                'source': u,
                'target': v,
                'amount': edge_data['amount'],
                'timestamp': edge_data.get('timestamp'),
                'risk_score': round(edge_data['risk_score'], 2),
                'is_laundering': 1 if edge_data['risk_score'] >= 60 else 0,
                'is_cycle': is_in_cycle,
                'is_fraud_ring': is_fraud_ring_edge,
                'edge_type': 'transaction',
                'type': 'edge'
            }
        })

    # Add Extra Shared Device / IP Edges
    for idx, sh_edge in enumerate(shared_device_edges):
        u, v = sh_edge['source'], sh_edge['target']
        if u in G.nodes() and v in G.nodes():
            elements.append({
                'data': {
                    'id': f"shared_{u}_{v}_{idx}",
                    'source': u,
                    'target': v,
                    'amount': 0.0,
                    'label': 'Shared Device/IP',
                    'device_id': sh_edge.get('device_id', ''),
                    'ip_address': sh_edge.get('ip_address', ''),
                    'edge_type': 'shared_device',
                    'type': 'edge'
                }
            })

    sorted_central = sorted(pagerank.items(), key=lambda x: x[1], reverse=True)[:5]
    top_central = []
    for node, score in sorted_central:
        top_central.append({
            'account_number': node,
            'holder_name': account_info[node]['holder_name'],
            'pagerank': float(round(score, 4)),
            'total_volume': round(account_info[node]['total_volume'], 2)
        })

    summary = {
        'total_accounts': len(G.nodes()),
        'total_transfers': len(G.edges()),
        'num_communities': len(set(community_map.values())),
        'cycles_count': len(detected_cycles),
        'detected_cycles': detected_cycles,
        'fraud_rings_count': len(fraud_rings),
        'smurfing_count': len(smurfing_nodes),
        'fan_out_count': len(fan_out_nodes),
        'pass_through_count': len(pass_through_nodes),
        'shared_device_links_count': len(shared_device_edges),
        'top_central_accounts': top_central
    }

    return {
        'elements': elements,
        'summary': summary
    }
