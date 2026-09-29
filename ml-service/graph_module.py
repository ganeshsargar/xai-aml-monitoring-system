import networkx as nx

def analyze_transaction_graph(transactions_list):
    """
    Accepts a list of transactions, constructs a NetworkX Directed Graph,
    runs advanced graph centrality & AML pattern algorithms, and returns
    elements formatted for Cytoscape.js and graph metrics.
    """
    # Create directed graph
    G = nx.DiGraph()
    
    # Track details for node popups
    account_info = {}
    incoming_volumes = {}
    outgoing_volumes = {}
    
    # 1. Populate nodes and edges
    for tx in transactions_list:
        sender = tx.get('sender_account')
        receiver = tx.get('receiver_account')
        sender_name = tx.get('sender_name', f"Acc_{sender}")
        receiver_name = tx.get('receiver_name', f"Acc_{receiver}")
        amount = float(tx.get('amount', 0))
        tx_id = tx.get('transaction_id')
        risk_score = float(tx.get('risk_score', 0))
        is_laundering = int(tx.get('is_laundering', 0))
        
        # Track volumes
        incoming_volumes[receiver] = incoming_volumes.get(receiver, 0.0) + amount
        outgoing_volumes[sender] = outgoing_volumes.get(sender, 0.0) + amount
        
        # Add nodes with basic info
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
            if is_laundering == 1 or risk_score > 70:
                account_info[acc]['is_flagged'] = 1
                
        # Add edge
        G.add_edge(
            sender, 
            receiver, 
            id=tx_id, 
            amount=amount, 
            timestamp=tx.get('timestamp'),
            risk_score=risk_score,
            is_laundering=is_laundering
        )
        
    if len(G) == 0:
        return {'elements': [], 'summary': {}}
        
    # 2. Advanced Centrality Calculations
    try:
        pagerank = nx.pagerank(G, weight='amount')
    except Exception:
        pagerank = {node: 0.0 for node in G.nodes()}
        
    try:
        betweenness = nx.betweenness_centrality(G, weight='amount')
    except Exception:
        betweenness = {node: 0.0 for node in G.nodes()}
        
    try:
        closeness = nx.closeness_centrality(G)
    except Exception:
        closeness = {node: 0.0 for node in G.nodes()}
        
    try:
        degree_cent = nx.degree_centrality(G)
    except Exception:
        degree_cent = {node: 0.0 for node in G.nodes()}
        
    # 3. Community Detection (Louvain)
    undirected_G = G.to_undirected()
    try:
        communities = nx.community.louvain_communities(undirected_G, weight='amount', seed=42)
        community_map = {}
        for c_idx, comm in enumerate(communities):
            for node in comm:
                community_map[node] = c_idx
    except Exception:
        community_map = {node: 0 for node in G.nodes()}
        
    # 4. Cycle Detection (Wash Trading / Circular Money Loops)
    detected_cycles = []
    cycle_nodes = set()
    try:
        raw_cycles = list(nx.simple_cycles(G, length_bound=6))
        short_cycles = [c for c in raw_cycles if 2 <= len(c) <= 6]
        for c in short_cycles[:15]:
            cycle_edges = []
            for i in range(len(c)):
                u = c[i]
                v = c[(i + 1) % len(c)]
                cycle_edges.append(f"{u}->{v}")
                cycle_nodes.add(u)
                cycle_nodes.add(v)
            detected_cycles.append({
                'nodes': c,
                'edges': cycle_edges
            })
    except Exception as e:
        print(f"Cycle detection error: {e}")
        
    # 5. Fraud Rings (SCCs of size > 1)
    sccs = list(nx.strongly_connected_components(G))
    fraud_rings = [list(scc) for scc in sccs if len(scc) > 1]
    fraud_ring_nodes = {node for ring in fraud_rings for node in ring}
    
    # 6. Smurfing & Layering Detections
    smurfing_nodes = set()
    layering_nodes = set()
    
    for node in G.nodes():
        in_deg = G.in_degree(node)
        out_deg = G.out_degree(node)
        
        # Smurfing detection: multiple inputs, single large output
        if in_deg >= 3 and out_deg == 1:
            in_edges = G.in_edges(node, data=True)
            out_edges = G.out_edges(node, data=True)
            in_amounts = [data['amount'] for _, _, data in in_edges]
            out_amount = sum(data['amount'] for _, _, data in out_edges)
            avg_in = sum(in_amounts) / len(in_amounts)
            if out_amount >= 2 * sum(in_amounts) or (avg_in < 100000 and out_amount >= 150000):
                smurfing_nodes.add(node)
                
        # Layering detection: transit node in chain of high risk
        if in_deg >= 1 and out_deg >= 1:
            high_risk_in = any(data['risk_score'] >= 50 for _, _, data in G.in_edges(node, data=True))
            high_risk_out = any(data['risk_score'] >= 50 for _, _, data in G.out_edges(node, data=True))
            if high_risk_in and high_risk_out:
                layering_nodes.add(node)
                
    # 7. Risk Propagation Calculation (neighborhood risk)
    risk_propagation = {}
    for node in G.nodes():
        neighbors = list(G.predecessors(node)) + list(G.successors(node))
        if neighbors:
            neighbor_risks = [account_info[neigh]['max_risk_score'] for neigh in neighbors]
            risk_propagation[node] = float(round(sum(neighbor_risks) / len(neighbor_risks), 2))
        else:
            risk_propagation[node] = float(round(account_info[node]['max_risk_score'], 2))

    # 8. Format Cytoscape elements
    elements = []
    
    # Add Nodes
    for node in G.nodes():
        info = account_info[node]
        pr = pagerank.get(node, 0.0)
        btn = betweenness.get(node, 0.0)
        cls = closeness.get(node, 0.0)
        deg = degree_cent.get(node, 0.0)
        comm = community_map.get(node, 0)
        
        # Calculate node risk class
        node_risk = 'Low'
        if info['is_flagged'] == 1:
            node_risk = 'Critical'
        elif info['max_risk_score'] > 50:
            node_risk = 'High'
        elif info['max_risk_score'] > 20:
            node_risk = 'Medium'
            
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
                'risk_propagation': risk_propagation[node],
                'community': int(comm),
                'transaction_count': info['transaction_count'],
                'incoming_amount': round(incoming_volumes.get(node, 0.0), 2),
                'outgoing_amount': round(outgoing_volumes.get(node, 0.0), 2),
                'network_score': float(round(pr * 100 + risk_propagation[node] * 0.5, 2)),
                'total_volume': round(info['total_volume'], 2),
                'is_cycle': 1 if node in cycle_nodes else 0,
                'is_fraud_ring': 1 if node in fraud_ring_nodes else 0,
                'is_smurfing': 1 if node in smurfing_nodes else 0,
                'is_layering': 1 if node in layering_nodes else 0,
                'type': 'node'
            }
        })
        
    # Create a set of all edge strings (u->v) that belong to any detected cycle
    cycle_edge_set = set()
    for cycle in detected_cycles:
        for edge_str in cycle['edges']:
            cycle_edge_set.add(edge_str)

    # Add Edges
    for u, v, edge_data in G.edges(data=True):
        edge_key = f"{u}->{v}"
        is_in_cycle = 1 if edge_key in cycle_edge_set else 0
        is_fraud_ring_edge = 1 if (u in fraud_ring_nodes and v in fraud_ring_nodes) else 0
        
        elements.append({
            'data': {
                'id': edge_data['id'],
                'source': u,
                'target': v,
                'amount': edge_data['amount'],
                'timestamp': edge_data['timestamp'],
                'risk_score': round(edge_data['risk_score'], 2),
                'is_laundering': edge_data['is_laundering'],
                'is_cycle': is_in_cycle,
                'is_fraud_ring': is_fraud_ring_edge,
                'type': 'edge'
            }
        })
        
    # Build Top Central Accounts list
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
        'top_central_accounts': top_central
    }
    
    return {
        'elements': elements,
        'summary': summary
    }
