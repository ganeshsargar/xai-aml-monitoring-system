"""
Unit tests for AML Graph Network Detectors & Feature Extraction.
Tests small hand-built graphs for:
1. Smurfing detection (fan-in + subsequent outflow >= 80% within time window)
2. Fan-out detection (inflow + dispersion to >= M receivers)
3. Pass-through accounts (in ≈ out within hours)
4. Temporal cycle detection (chronological sequence vs. non-chronological topology)
5. Shared device / IP infrastructure linking accounts
6. Per-account graph feature extraction
7. Zero label leakage (node flagging depends strictly on risk scores and structure, not is_laundering)
"""

import sys
import os
import networkx as nx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from graph_module import (
    detect_smurfing,
    detect_fan_out,
    detect_pass_through,
    detect_temporal_cycles,
    detect_shared_devices,
    compute_account_graph_features,
    analyze_transaction_graph
)


def test_smurfing_detector_positive_and_negative():
    """
    Smurfing: fan-in >= N distinct senders within window, followed by outflow >= 80% within X hours.
    """
    # Positive Case:
    # 3 distinct senders send to MULE within 12h, MULE forwards 90% out 4h later.
    txs_positive = [
        {'sender_account': 'SMURF_A', 'receiver_account': 'MULE_1', 'amount': 50000, 'timestamp': '2026-05-10T08:00:00Z'},
        {'sender_account': 'SMURF_B', 'receiver_account': 'MULE_1', 'amount': 60000, 'timestamp': '2026-05-10T12:00:00Z'},
        {'sender_account': 'SMURF_C', 'receiver_account': 'MULE_1', 'amount': 70000, 'timestamp': '2026-05-10T16:00:00Z'},
        # Total in = 180,000. Outflow = 162,000 (90%) within 4 hours of last inflow
        {'sender_account': 'MULE_1', 'receiver_account': 'AGGREGATOR', 'amount': 162000, 'timestamp': '2026-05-10T20:00:00Z'},
    ]
    detected = detect_smurfing(
        txs_positive,
        min_senders=3,
        window_hours=48.0,
        outflow_delay_hours=24.0,
        outflow_ratio=0.80
    )
    assert 'MULE_1' in detected, "MULE_1 should be detected as smurfing account"

    # Negative Case 1: Insufficient distinct senders (only 2 distinct senders)
    txs_few_senders = [
        {'sender_account': 'SMURF_A', 'receiver_account': 'MULE_2', 'amount': 90000, 'timestamp': '2026-05-10T08:00:00Z'},
        {'sender_account': 'SMURF_B', 'receiver_account': 'MULE_2', 'amount': 90000, 'timestamp': '2026-05-10T12:00:00Z'},
        {'sender_account': 'MULE_2', 'receiver_account': 'AGGREGATOR', 'amount': 160000, 'timestamp': '2026-05-10T20:00:00Z'},
    ]
    assert 'MULE_2' not in detect_smurfing(txs_few_senders, min_senders=3), "MULE_2 with < 3 senders must not be flagged"

    # Negative Case 2: Insufficient outflow ratio (e.g. only 30% forwarded out)
    txs_low_outflow = [
        {'sender_account': 'SMURF_A', 'receiver_account': 'MULE_3', 'amount': 50000, 'timestamp': '2026-05-10T08:00:00Z'},
        {'sender_account': 'SMURF_B', 'receiver_account': 'MULE_3', 'amount': 60000, 'timestamp': '2026-05-10T12:00:00Z'},
        {'sender_account': 'SMURF_C', 'receiver_account': 'MULE_3', 'amount': 70000, 'timestamp': '2026-05-10T16:00:00Z'},
        {'sender_account': 'MULE_3', 'receiver_account': 'AGGREGATOR', 'amount': 40000, 'timestamp': '2026-05-10T20:00:00Z'},
    ]
    assert 'MULE_3' not in detect_smurfing(txs_low_outflow, outflow_ratio=0.80), "MULE_3 with < 80% outflow must not be flagged"

    # Parameter Configurability Test:
    # If min_senders is raised to 4, MULE_1 should no longer be flagged
    assert 'MULE_1' not in detect_smurfing(txs_positive, min_senders=4)


def test_fan_out_detector_positive_and_negative():
    """
    Fan-out: An account receives funds, and within window disperses >= 80% to >= M receivers.
    """
    # Positive Case:
    # Inflow of 300,000, followed within 24h by dispersion to 3 distinct receivers totaling 270,000 (90%)
    txs_positive = [
        {'sender_account': 'FUNDER', 'receiver_account': 'DISTRIBUTOR', 'amount': 300000, 'timestamp': '2026-05-10T06:00:00Z'},
        {'sender_account': 'DISTRIBUTOR', 'receiver_account': 'REC_A', 'amount': 90000, 'timestamp': '2026-05-10T12:00:00Z'},
        {'sender_account': 'DISTRIBUTOR', 'receiver_account': 'REC_B', 'amount': 90000, 'timestamp': '2026-05-10T14:00:00Z'},
        {'sender_account': 'DISTRIBUTOR', 'receiver_account': 'REC_C', 'amount': 90000, 'timestamp': '2026-05-10T16:00:00Z'},
    ]
    detected = detect_fan_out(txs_positive, min_receivers=3, window_hours=48.0, outflow_ratio=0.80)
    assert 'DISTRIBUTOR' in detected, "DISTRIBUTOR should be detected as fan-out node"

    # Negative Case 1: Insufficient receivers (only 2 receivers)
    txs_few_receivers = [
        {'sender_account': 'FUNDER', 'receiver_account': 'DIST_2', 'amount': 300000, 'timestamp': '2026-05-10T06:00:00Z'},
        {'sender_account': 'DIST_2', 'receiver_account': 'REC_A', 'amount': 135000, 'timestamp': '2026-05-10T12:00:00Z'},
        {'sender_account': 'DIST_2', 'receiver_account': 'REC_B', 'amount': 135000, 'timestamp': '2026-05-10T14:00:00Z'},
    ]
    assert 'DIST_2' not in detect_fan_out(txs_few_receivers, min_receivers=3), "DIST_2 with 2 receivers must not be flagged"

    # Negative Case 2: Insufficient outflow ratio (only 40% dispersed)
    txs_low_out = [
        {'sender_account': 'FUNDER', 'receiver_account': 'DIST_3', 'amount': 300000, 'timestamp': '2026-05-10T06:00:00Z'},
        {'sender_account': 'DIST_3', 'receiver_account': 'REC_A', 'amount': 40000, 'timestamp': '2026-05-10T12:00:00Z'},
        {'sender_account': 'DIST_3', 'receiver_account': 'REC_B', 'amount': 40000, 'timestamp': '2026-05-10T14:00:00Z'},
        {'sender_account': 'DIST_3', 'receiver_account': 'REC_C', 'amount': 40000, 'timestamp': '2026-05-10T16:00:00Z'},
    ]
    assert 'DIST_3' not in detect_fan_out(txs_low_out, outflow_ratio=0.80), "DIST_3 with low outflow must not be flagged"


def test_pass_through_detector_positive_and_negative():
    """
    Pass-through accounts: Transit account where in ≈ out within hours (low balance retention).
    """
    # Positive Case:
    # Inflow of 100,000 at 10:00, outflow of 98,000 at 13:00 (ratio = 0.98, within 3 hours)
    txs_positive = [
        {'sender_account': 'CLIENT_1', 'receiver_account': 'TRANSIT_1', 'amount': 100000, 'timestamp': '2026-05-10T10:00:00Z'},
        {'sender_account': 'TRANSIT_1', 'receiver_account': 'DEST_1', 'amount': 98000, 'timestamp': '2026-05-10T13:00:00Z'},
    ]
    pass_through_nodes, ratios = detect_pass_through(txs_positive, window_hours=24.0, min_ratio=0.80)
    assert 'TRANSIT_1' in pass_through_nodes
    assert ratios['TRANSIT_1'] >= 0.90

    # Negative Case:
    # Holding account receives 100,000, retains it, sends only 10,000
    txs_holding = [
        {'sender_account': 'CLIENT_1', 'receiver_account': 'HOLDING_1', 'amount': 100000, 'timestamp': '2026-05-10T10:00:00Z'},
        {'sender_account': 'HOLDING_1', 'receiver_account': 'DEST_1', 'amount': 10000, 'timestamp': '2026-05-10T13:00:00Z'},
    ]
    pt_nodes, pt_ratios = detect_pass_through(txs_holding, min_ratio=0.80)
    assert 'HOLDING_1' not in pt_nodes
    assert pt_ratios['HOLDING_1'] <= 0.15


def test_temporal_cycle_detector_chronological_vs_nonchronological():
    """
    Temporal cycles: Must be chronologically sequential loops within window,
    not just topological simple cycles.
    """
    G = nx.DiGraph()
    G.add_edge('A', 'B')
    G.add_edge('B', 'C')
    G.add_edge('C', 'A')

    # Positive Case: Chronological flow A -> B -> C -> A within 12 hours
    txs_chronological = [
        {'sender_account': 'A', 'receiver_account': 'B', 'amount': 50000, 'timestamp': '2026-05-10T10:00:00Z'},
        {'sender_account': 'B', 'receiver_account': 'C', 'amount': 48000, 'timestamp': '2026-05-10T14:00:00Z'},
        {'sender_account': 'C', 'receiver_account': 'A', 'amount': 47000, 'timestamp': '2026-05-10T18:00:00Z'},
    ]
    cycles, nodes, edges, counts = detect_temporal_cycles(G, txs_chronological, cycle_window_hours=72.0)
    assert len(cycles) == 1, "Expected 1 temporal cycle detected"
    assert nodes == {'A', 'B', 'C'}
    assert counts['A'] == 1 and counts['B'] == 1 and counts['C'] == 1

    # Negative Case 1: Non-chronological flow (reverse chronological order)
    # A->B occurs after B->C and C->A; no forward flow of money exists!
    txs_non_chronological = [
        {'sender_account': 'A', 'receiver_account': 'B', 'amount': 50000, 'timestamp': '2026-05-10T22:00:00Z'},
        {'sender_account': 'B', 'receiver_account': 'C', 'amount': 48000, 'timestamp': '2026-05-10T14:00:00Z'},
        {'sender_account': 'C', 'receiver_account': 'A', 'amount': 47000, 'timestamp': '2026-05-10T08:00:00Z'},
    ]
    cycles_rev, nodes_rev, _, _ = detect_temporal_cycles(G, txs_non_chronological, cycle_window_hours=72.0)
    assert len(cycles_rev) == 0, "Non-chronological flow must NOT be detected as a temporal money cycle"
    assert len(nodes_rev) == 0

    # Negative Case 2: Exceeds time window (e.g. 15 days apart)
    txs_expired = [
        {'sender_account': 'A', 'receiver_account': 'B', 'amount': 50000, 'timestamp': '2026-05-01T10:00:00Z'},
        {'sender_account': 'B', 'receiver_account': 'C', 'amount': 48000, 'timestamp': '2026-05-15T10:00:00Z'},
        {'sender_account': 'C', 'receiver_account': 'A', 'amount': 47000, 'timestamp': '2026-05-20T10:00:00Z'},
    ]
    cycles_exp, _, _, _ = detect_temporal_cycles(G, txs_expired, cycle_window_hours=72.0)
    assert len(cycles_exp) == 0, "Cycle spanning 19 days must not trigger 72h window"


def test_shared_device_detector():
    """
    Shared devices / IPs: Distinct accounts using the same hardware/IP infrastructure.
    """
    txs = [
        {'sender_account': 'ACC_1', 'receiver_account': 'MERCHANT', 'device_id': 'DEV_IPHONE_01', 'ip_address': '10.0.0.1'},
        {'sender_account': 'ACC_2', 'receiver_account': 'MERCHANT', 'device_id': 'DEV_IPHONE_01', 'ip_address': '10.0.0.2'},
        {'sender_account': 'ACC_3', 'receiver_account': 'MERCHANT', 'device_id': 'DEV_ANDROID_02', 'ip_address': '10.0.0.1'},
        {'sender_account': 'SOLO_ACC', 'receiver_account': 'MERCHANT', 'device_id': 'UNIQUE_DEV_99', 'ip_address': '192.168.1.99'},
    ]
    shared_edges, shared_degrees = detect_shared_devices(txs)

    # ACC_1 and ACC_2 share DEV_IPHONE_01
    # ACC_1 and ACC_3 share 10.0.0.1
    assert any((e['source'] == 'ACC_1' and e['target'] == 'ACC_2') or (e['source'] == 'ACC_2' and e['target'] == 'ACC_1') for e in shared_edges)
    assert any((e['source'] == 'ACC_1' and e['target'] == 'ACC_3') or (e['source'] == 'ACC_3' and e['target'] == 'ACC_1') for e in shared_edges)

    assert shared_degrees['ACC_1'] >= 2, "ACC_1 links to ACC_2 (device) and ACC_3 (IP)"
    assert shared_degrees['SOLO_ACC'] == 0, "SOLO_ACC has unique infrastructure"


def test_per_account_graph_features():
    """
    Per-account graph features:
    in/out degree, distinct counterparties, pass-through ratio, in cycle (0/1), cycle count, PageRank, shared-device degree, neighbour max risk.
    """
    txs = [
        {'sender_account': 'A', 'receiver_account': 'B', 'amount': 100000, 'timestamp': '2026-05-10T10:00:00Z', 'risk_score': 85.0},
        {'sender_account': 'B', 'receiver_account': 'C', 'amount': 95000, 'timestamp': '2026-05-10T12:00:00Z', 'risk_score': 75.0},
        {'sender_account': 'C', 'receiver_account': 'A', 'amount': 90000, 'timestamp': '2026-05-10T14:00:00Z', 'risk_score': 65.0},
        {'sender_account': 'D', 'receiver_account': 'B', 'amount': 50000, 'timestamp': '2026-05-10T11:00:00Z', 'risk_score': 40.0},
    ]
    feats = compute_account_graph_features(txs)

    # Node B has inbound from A and D (in_degree = 2), outbound to C (out_degree = 1)
    assert feats['B']['in_degree'] == 2.0
    assert feats['B']['out_degree'] == 1.0
    assert feats['B']['distinct_counterparties'] == 3.0  # A, D, C
    assert feats['B']['in_cycle'] == 1.0
    assert feats['B']['cycle_count'] >= 1.0
    assert feats['B']['pass_through_ratio'] > 0.0
    assert feats['B']['pagerank'] > 0.0
    # B's counterparties are A (risk 85), D (risk 40), C (risk 65) -> neighbor max risk = 85.0
    assert feats['B']['neighbor_max_risk'] == 85.0


def test_zero_label_leakage():
    """
    Verify that analyze_transaction_graph flags nodes based purely on model risk scores
    and network structure, and NEVER uses ground-truth is_laundering from input.
    """
    tx_unlabelled = [
        {'sender_account': 'A', 'receiver_account': 'B', 'amount': 50000, 'timestamp': '2026-05-10T10:00:00Z', 'risk_score': 45.0, 'is_laundering': 0},
        {'sender_account': 'B', 'receiver_account': 'C', 'amount': 45000, 'timestamp': '2026-05-10T12:00:00Z', 'risk_score': 45.0, 'is_laundering': 0},
    ]
    tx_with_labels = [
        {'sender_account': 'A', 'receiver_account': 'B', 'amount': 50000, 'timestamp': '2026-05-10T10:00:00Z', 'risk_score': 45.0, 'is_laundering': 1},
        {'sender_account': 'B', 'receiver_account': 'C', 'amount': 45000, 'timestamp': '2026-05-10T12:00:00Z', 'risk_score': 45.0, 'is_laundering': 1},
    ]

    res_0 = analyze_transaction_graph(tx_unlabelled)
    res_1 = analyze_transaction_graph(tx_with_labels)

    nodes_0 = {ele['data']['id']: ele['data'] for ele in res_0['elements'] if ele['data']['type'] == 'node'}
    nodes_1 = {ele['data']['id']: ele['data'] for ele in res_1['elements'] if ele['data']['type'] == 'node'}

    for node_id in nodes_0:
        # Both runs MUST yield identical node flags and risk levels regardless of is_laundering input
        assert nodes_0[node_id]['risk_level'] == nodes_1[node_id]['risk_level']
        assert nodes_0[node_id]['max_risk_score'] == nodes_1[node_id]['max_risk_score']
        # Risk score 45 is not critical (>80), so neither should be flagged as Critical
        assert nodes_0[node_id]['risk_level'] != 'Critical'
