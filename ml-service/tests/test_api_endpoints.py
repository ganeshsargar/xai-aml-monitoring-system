import pytest
import json
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import app, load_resources

@pytest.fixture(scope="module")
def client():
    app.config['TESTING'] = True
    load_resources()
    with app.test_client() as client:
        yield client

def test_health_endpoint(client):
    res = client.get('/health')
    assert res.status_code == 200
    data = json.loads(res.data)
    assert data.get('status') == 'healthy'
    assert 'champion_loaded' in data
    assert 'shadow_mode_active' in data

def test_predict_single_endpoint(client):
    payload = {
        "transaction": {
            "transaction_id": "TX_TEST_999",
            "sender_account": "ACC_SENDER_01",
            "receiver_account": "ACC_RECV_02",
            "customer_id": "CUST_001",
            "amount": 950000.0,
            "currency": "INR",
            "payment_method": "CRYPTO",
            "country": "KY",
            "timestamp": "2026-10-05T10:00:00Z"
        }
    }
    res = client.post('/predict', data=json.dumps(payload), content_type='application/json')
    assert res.status_code == 200
    data = json.loads(res.data)
    assert 'risk_score' in data
    assert 'reasons' in data
    assert isinstance(data['reasons'], list)
    assert 'features' in data
    assert 'model_version' in data

def test_predict_counterfactual_endpoint(client):
    payload = {
        "transaction": {
            "transaction_id": "TX_TEST_CF",
            "sender_account": "ACC_SENDER_CF",
            "receiver_account": "ACC_RECV_CF",
            "customer_id": "CUST_CF",
            "amount": 1200000.0,
            "currency": "INR",
            "payment_method": "CRYPTO",
            "country": "KY",
            "timestamp": "2026-10-05T10:00:00Z"
        },
        "threshold": 0.50
    }
    res = client.post('/predict/counterfactual', data=json.dumps(payload), content_type='application/json')
    assert res.status_code == 200
    data = json.loads(res.data)
    assert data.get('success') is True
    cf_data = data.get('data', {})
    assert 'original_score' in cf_data
    assert 'target_threshold' in cf_data
    assert 'counterfactuals' in cf_data

def test_graph_endpoint(client):
    payload = {
        "transactions": [
            {
                "sender_account": "ACC_1",
                "receiver_account": "ACC_2",
                "amount": 100000,
                "timestamp": "2026-10-05T08:00:00Z"
            },
            {
                "sender_account": "ACC_2",
                "receiver_account": "ACC_3",
                "amount": 95000,
                "timestamp": "2026-10-05T08:15:00Z"
            },
            {
                "sender_account": "ACC_3",
                "receiver_account": "ACC_1",
                "amount": 90000,
                "timestamp": "2026-10-05T08:30:00Z"
            }
        ]
    }
    res = client.post('/graph', data=json.dumps(payload), content_type='application/json')
    assert res.status_code == 200
    data = json.loads(res.data)
    assert data.get('success') is True
    assert 'data' in data
    assert 'elements' in data['data']

def test_models_registry_endpoint(client):
    res = client.get('/models')
    assert res.status_code == 200
    data = json.loads(res.data)
    assert 'versions' in data
    assert 'champion' in data

def test_metrics_and_ablation_endpoints(client):
    res_metrics = client.get('/metrics')
    assert res_metrics.status_code == 200

    res_ablation = client.get('/ablation')
    assert res_ablation.status_code == 200

    res_fi = client.get('/feature-importance')
    assert res_fi.status_code == 200
