"""
Tests for Feature Parity between Batch Feature Engineering and Single Transaction Scoring.
Ensures that compute_features_batch() and compute_features_single() produce identical results.
"""

import os
import random
import unittest
import pandas as pd
import numpy as np

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from features import (
    FEATURE_COLS,
    BASE_FEATURE_COLS,
    GRAPH_FEATURE_COLS,
    compute_features_batch,
    compute_features_single,
)


class TestFeatureParity(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        dataset_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            'dataset',
            'dataset.csv'
        )
        if not os.path.exists(dataset_path):
            raise FileNotFoundError(f"Dataset not found at {dataset_path}")

        cls.df = pd.read_csv(dataset_path)
        cls.df['timestamp'] = pd.to_datetime(cls.df['timestamp'])
        cls.df = cls.df.sort_values('timestamp').reset_index(drop=True)
        cls.batch_features = compute_features_batch(cls.df)

    def test_feature_parity_500_random_rows(self):
        """
        For 500 random rows in dataset.csv, batch features must equal
        single-transaction features computed with the same history (tolerance 1e-6).
        """
        total_rows = len(self.df)
        self.assertGreaterEqual(total_rows, 500, "Dataset must have at least 500 rows")

        random.seed(42)
        sample_indices = sorted(random.sample(range(total_rows), 500))

        max_discrepancy = 0.0
        tolerance = 1e-6

        for idx in sample_indices:
            row = self.df.iloc[idx]
            prior_df = self.df.iloc[:idx]

            sender_history = prior_df[
                prior_df['sender_account'] == row['sender_account']
            ].to_dict('records')

            receiver_history = prior_df[
                prior_df['receiver_account'] == row['receiver_account']
            ].to_dict('records')

            single_features = compute_features_single(
                row.to_dict(),
                sender_history=sender_history,
                receiver_history=receiver_history
            )

            for col in BASE_FEATURE_COLS:
                batch_val = float(self.batch_features.iloc[idx][col])
                single_val = float(single_features[col])
                diff = abs(batch_val - single_val)
                if diff > max_discrepancy:
                    max_discrepancy = diff

                self.assertLessEqual(
                    diff,
                    tolerance,
                    f"Discrepancy at row {idx}, feature '{col}': batch={batch_val}, single={single_val}, diff={diff}"
                )

        print(f"\n[OK] Tested 500 random rows. Max absolute discrepancy across all 12 base features: {max_discrepancy:.8f}")

    def test_empty_batch(self):
        """Empty DataFrame should return empty DataFrame with feature columns intact."""
        empty_df = pd.DataFrame(columns=['timestamp', 'amount', 'country', 'payment_method', 'category'])
        result = compute_features_batch(empty_df)
        self.assertTrue(result.empty)
        for col in FEATURE_COLS:
            self.assertIn(col, result.columns)

    def test_single_tx_without_history(self):
        """Single transaction without history defaults time_diff to 9999.0 and velocity to 0."""
        tx = {
            'transaction_id': 'TX_TEST_001',
            'sender_account': 'ACC_TEST_S',
            'receiver_account': 'ACC_TEST_R',
            'amount': 100000.0,
            'country': 'IN',
            'payment_method': 'UPI',
            'category': 'Transfer',
            'timestamp': '2026-05-01 10:00:00'
        }
        res = compute_features_single(tx, [], [])
        self.assertEqual(res['sender_time_diff'], 9999.0)
        self.assertEqual(res['receiver_time_diff'], 9999.0)
        self.assertEqual(res['sender_velocity_2h'], 0)
        self.assertEqual(res['receiver_velocity_2h'], 0)
        self.assertEqual(res['amount'], 100000.0)

    def test_batch_internal_velocity_and_time_diff(self):
        """Batch should compute velocity and time-diff from transactions within the batch itself."""
        txs = pd.DataFrame([
            {
                'transaction_id': 'TX_B1',
                'sender_account': 'ACC_VEL_1',
                'receiver_account': 'ACC_RECV_1',
                'amount': 50000.0,
                'country': 'IN',
                'payment_method': 'UPI',
                'category': 'Transfer',
                'timestamp': '2026-06-01 10:00:00'
            },
            {
                'transaction_id': 'TX_B2',
                'sender_account': 'ACC_VEL_1',
                'receiver_account': 'ACC_RECV_2',
                'amount': 60000.0,
                'country': 'IN',
                'payment_method': 'UPI',
                'category': 'Transfer',
                'timestamp': '2026-06-01 10:30:00'
            },
            {
                'transaction_id': 'TX_B3',
                'sender_account': 'ACC_VEL_1',
                'receiver_account': 'ACC_RECV_3',
                'amount': 70000.0,
                'country': 'IN',
                'payment_method': 'UPI',
                'category': 'Transfer',
                'timestamp': '2026-06-01 11:15:00'
            }
        ])

        res = compute_features_batch(txs)
        # TX_B1 is the first tx: no history
        self.assertEqual(res.loc[0, 'sender_time_diff'], 9999.0)
        self.assertEqual(res.loc[0, 'sender_velocity_2h'], 0)

        # TX_B2 is 30 mins after TX_B1
        self.assertEqual(res.loc[1, 'sender_time_diff'], 30.0)
        self.assertEqual(res.loc[1, 'sender_velocity_2h'], 1)

        # TX_B3 is 45 mins after TX_B2 and 75 mins after TX_B1
        self.assertEqual(res.loc[2, 'sender_time_diff'], 45.0)
        self.assertEqual(res.loc[2, 'sender_velocity_2h'], 2)

    def test_batch_with_prior_history(self):
        """Batch should incorporate prior history per account when provided."""
        batch_txs = pd.DataFrame([
            {
                'transaction_id': 'TX_CURR',
                'sender_account': 'ACC_HIST_TEST',
                'receiver_account': 'ACC_RECV_TEST',
                'amount': 150000.0,
                'country': 'IN',
                'payment_method': 'UPI',
                'category': 'Transfer',
                'timestamp': '2026-06-01 12:00:00'
            }
        ])

        prior_history = [
            {
                'sender_account': 'ACC_HIST_TEST',
                'receiver_account': 'ACC_OTHER',
                'timestamp': '2026-06-01 10:30:00',
                'amount': 50000.0
            },
            {
                'sender_account': 'ACC_HIST_TEST',
                'receiver_account': 'ACC_OTHER',
                'timestamp': '2026-06-01 11:45:00',
                'amount': 25000.0
            }
        ]

        res = compute_features_batch(batch_txs, history=prior_history)
        # 15 mins since 11:45
        self.assertEqual(res.loc[0, 'sender_time_diff'], 15.0)
        # 2 transactions in the 2-hour window (10:30 and 11:45 are both in [10:00, 12:00))
        self.assertEqual(res.loc[0, 'sender_velocity_2h'], 2)

    def test_graph_feature_parity_with_prior_graph(self):
        """Graph features must match between batch and single when local graph history is provided."""
        tx = {
            'transaction_id': 'TX_G_001',
            'sender_account': 'ACC_G_S',
            'receiver_account': 'ACC_G_R',
            'amount': 200000.0,
            'country': 'IN',
            'payment_method': 'UPI',
            'category': 'Transfer',
            'timestamp': '2026-06-01 12:00:00'
        }
        graph_hist = [
            {'sender_account': 'FEEDER_1', 'receiver_account': 'ACC_G_S', 'amount': 100000.0, 'timestamp': '2026-06-01 10:00:00'},
            {'sender_account': 'FEEDER_2', 'receiver_account': 'ACC_G_S', 'amount': 100000.0, 'timestamp': '2026-06-01 11:00:00'},
            {'sender_account': 'ACC_G_R', 'receiver_account': 'OUT_1', 'amount': 50000.0, 'timestamp': '2026-06-01 11:30:00'}
        ]
        batch_res = compute_features_batch(pd.DataFrame([tx]), history=graph_hist)
        single_res = compute_features_single(tx, graph_history=graph_hist)

        for col in GRAPH_FEATURE_COLS:
            batch_v = float(batch_res.loc[0, col])
            single_v = float(single_res[col])
            self.assertAlmostEqual(batch_v, single_v, places=5, msg=f"Parity mismatch for graph feature '{col}'")


if __name__ == '__main__':
    unittest.main()
