"""
Tests for Customer & Account Layer Behavioral Feature Engineering.
Validates:
1. 7 customer features: amount_zscore_vs_own_history, volume_vs_declared_income,
   new_counterparty_flag, new_country_flag, account_age_days, dormant_reactivation, peer_percentile.
2. Baselines (rolling median, std, monthly volume, counterparties, usual countries/hours).
3. Profile deviation: laundering accounts exhibit severe deviation vs declared profiles.
"""

import os
import unittest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from features import (
    FEATURE_COLS,
    BASE_FEATURE_COLS,
    GRAPH_FEATURE_COLS,
    CUSTOMER_FEATURE_COLS,
    compute_customer_features,
    compute_customer_baseline,
    compute_features_batch,
    compute_features_single
)


class TestCustomerFeatures(unittest.TestCase):

    def test_feature_list_structure(self):
        """Test that CUSTOMER_FEATURE_COLS contains all required 7 features and total is 28."""
        expected_customer_features = [
            'amount_zscore_vs_own_history',
            'volume_vs_declared_income',
            'new_counterparty_flag',
            'new_country_flag',
            'account_age_days',
            'dormant_reactivation',
            'peer_percentile'
        ]
        self.assertEqual(len(CUSTOMER_FEATURE_COLS), 7)
        for feat in expected_customer_features:
            self.assertIn(feat, CUSTOMER_FEATURE_COLS)

        self.assertEqual(len(FEATURE_COLS), 28)
        self.assertEqual(len(BASE_FEATURE_COLS), 12)
        self.assertEqual(len(GRAPH_FEATURE_COLS), 9)

    def test_customer_features_calculation(self):
        """Test computation of customer features on a controlled transaction sequence."""
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        # Create a series of transactions for sender ACC_TEST_1
        txs = [
            {
                'transaction_id': 'TX1',
                'sender_account': 'ACC_TEST_1',
                'receiver_account': 'ACC_A',
                'amount': 1000.0,
                'timestamp': t0,
                'country': 'IN',
                'sender_declared_income': 50000.0,
                'sender_customer_type': 'individual',
                'sender_account_open_date': '2025-01-01',
                'is_laundering': 0
            },
            {
                'transaction_id': 'TX2',
                'sender_account': 'ACC_TEST_1',
                'receiver_account': 'ACC_A', # repeat counterparty
                'amount': 1000.0,
                'timestamp': t0 + timedelta(days=5),
                'country': 'IN', # repeat country
                'sender_declared_income': 50000.0,
                'sender_customer_type': 'individual',
                'sender_account_open_date': '2025-01-01',
                'is_laundering': 0
            },
            {
                'transaction_id': 'TX3',
                'sender_account': 'ACC_TEST_1',
                'receiver_account': 'ACC_B', # new counterparty
                'amount': 250000.0, # massive spike
                'timestamp': t0 + timedelta(days=120), # >90 days dormancy
                'country': 'PA', # new country (Panama)
                'sender_declared_income': 50000.0,
                'sender_customer_type': 'individual',
                'sender_account_open_date': '2025-01-01',
                'is_laundering': 1
            }
        ]

        df = pd.DataFrame(txs)
        feat_df = compute_customer_features(df)

        # Check TX1 (first transaction)
        self.assertEqual(feat_df.loc[0, 'new_counterparty_flag'], 1.0)
        self.assertEqual(feat_df.loc[0, 'new_country_flag'], 0.0) # IN is domestic
        self.assertEqual(feat_df.loc[0, 'dormant_reactivation'], 0.0)
        self.assertAlmostEqual(feat_df.loc[0, 'account_age_days'], 365.0, delta=2.0)

        # Check TX2 (repeat counterparty and country)
        self.assertEqual(feat_df.loc[1, 'new_counterparty_flag'], 0.0)
        self.assertEqual(feat_df.loc[1, 'new_country_flag'], 0.0)
        self.assertEqual(feat_df.loc[1, 'dormant_reactivation'], 0.0)

        # Check TX3 (new counterparty ACC_B, new country PA, dormant > 90d, high z-score, high volume/income)
        self.assertEqual(feat_df.loc[2, 'new_counterparty_flag'], 1.0)
        self.assertEqual(feat_df.loc[2, 'new_country_flag'], 1.0) # PA is high risk / new
        self.assertEqual(feat_df.loc[2, 'dormant_reactivation'], 1.0) # 115 days since TX2
        self.assertGreater(feat_df.loc[2, 'amount_zscore_vs_own_history'], 1.0)
        self.assertGreater(feat_df.loc[2, 'volume_vs_declared_income'], 2.0) # 250k on 50k declared
        self.assertGreater(feat_df.loc[2, 'peer_percentile'], 0.8) # extreme for individual tier 1

    def test_compute_customer_baseline(self):
        """Test calculation of customer baseline metrics."""
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        txs = [
            {'sender_account': 'ACC_X', 'receiver_account': 'ACC_Y', 'amount': 1000.0, 'timestamp': t0, 'country': 'IN'},
            {'sender_account': 'ACC_X', 'receiver_account': 'ACC_Z', 'amount': 2000.0, 'timestamp': t0 + timedelta(hours=2), 'country': 'AE'},
            {'sender_account': 'ACC_X', 'receiver_account': 'ACC_Y', 'amount': 3000.0, 'timestamp': t0 + timedelta(days=2), 'country': 'IN'},
        ]
        df = pd.DataFrame(txs)
        baseline = compute_customer_baseline('ACC_X', df)

        self.assertEqual(baseline['rolling_median_amount'], 2000.0)
        self.assertEqual(baseline['counterparties_count'], 2)
        self.assertIn('IN', baseline['usual_countries'])
        self.assertIn('AE', baseline['usual_countries'])
        self.assertGreater(baseline['typical_monthly_volume'], 0)

    def test_laundering_deviation_in_generated_dataset(self):
        """Test that laundering accounts in the real dataset exhibit substantial deviation from declared profile."""
        dataset_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            'dataset',
            'dataset.csv'
        )
        if not os.path.exists(dataset_path):
            self.skipTest("dataset.csv not found")

        df = pd.read_csv(dataset_path)
        feat_df = compute_features_batch(df)

        normal_tx = feat_df[feat_df['is_laundering'] == 0]
        laundering_tx = feat_df[feat_df['is_laundering'] == 1]

        # Laundering transactions should have higher volume-to-income and peer percentile on average
        mean_normal_vol_ratio = normal_tx['volume_vs_declared_income'].mean()
        mean_laundering_vol_ratio = laundering_tx['volume_vs_declared_income'].mean()
        self.assertGreater(mean_laundering_vol_ratio, mean_normal_vol_ratio)

        mean_normal_peer = normal_tx['peer_percentile'].mean()
        mean_laundering_peer = laundering_tx['peer_percentile'].mean()
        self.assertGreater(mean_laundering_peer, mean_normal_peer)


if __name__ == '__main__':
    unittest.main()
