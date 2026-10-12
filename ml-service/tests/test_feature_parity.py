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

    def test_three_leg_cycle_point_in_time_parity(self):
        """
        Tests point-in-time graph feature parity for a 3-leg cycle A -> B -> C -> A.
        Leg 1: A -> B at 10:00. Graph has only A -> B. in_cycle must be 0 in both batch and single mode.
        Leg 2: B -> C at 11:00. Graph has A -> B and B -> C. in_cycle must be 0 in both batch and single mode.
        Leg 3: C -> A at 12:00. Closes the cycle A -> B -> C -> A. in_cycle must be 1 in both batch and single mode.
        Batch features must equal single features for identical historical context.
        """
        tx1 = {
            'transaction_id': 'TX_CYC_1',
            'sender_account': 'ACC_CYC_A',
            'receiver_account': 'ACC_CYC_B',
            'amount': 50000.0,
            'country': 'IN',
            'payment_method': 'UPI',
            'category': 'Transfer',
            'timestamp': '2026-06-01 10:00:00'
        }
        tx2 = {
            'transaction_id': 'TX_CYC_2',
            'sender_account': 'ACC_CYC_B',
            'receiver_account': 'ACC_CYC_C',
            'amount': 50000.0,
            'country': 'IN',
            'payment_method': 'UPI',
            'category': 'Transfer',
            'timestamp': '2026-06-01 11:00:00'
        }
        tx3 = {
            'transaction_id': 'TX_CYC_3',
            'sender_account': 'ACC_CYC_C',
            'receiver_account': 'ACC_CYC_A',
            'amount': 50000.0,
            'country': 'IN',
            'payment_method': 'UPI',
            'category': 'Transfer',
            'timestamp': '2026-06-01 12:00:00'
        }

        # 1. Batch mode evaluation across the 3 legs
        cycle_df = pd.DataFrame([tx1, tx2, tx3])
        batch_res = compute_features_batch(cycle_df)

        # 2. Single mode evaluation with point-in-time historical context
        # Leg 1 has no prior history
        single_res_1 = compute_features_single(tx1, graph_history=[])
        # Leg 2 has Leg 1 as prior history
        single_res_2 = compute_features_single(tx2, graph_history=[tx1])
        # Leg 3 has Leg 1 and Leg 2 as prior history
        single_res_3 = compute_features_single(tx3, graph_history=[tx1, tx2])

        # Assertions on in_cycle
        # First leg MUST get in_cycle=0 in both batch and single mode
        self.assertEqual(float(batch_res.loc[0, 'in_cycle']), 0.0, "Batch Leg 1 must have in_cycle=0")
        self.assertEqual(float(single_res_1['in_cycle']), 0.0, "Single Leg 1 must have in_cycle=0")

        # Second leg must also have in_cycle=0 in both batch and single mode
        self.assertEqual(float(batch_res.loc[1, 'in_cycle']), 0.0, "Batch Leg 2 must have in_cycle=0")
        self.assertEqual(float(single_res_2['in_cycle']), 0.0, "Single Leg 2 must have in_cycle=0")

        # Third leg closes cycle, must get in_cycle=1 in both batch and single mode
        self.assertEqual(float(batch_res.loc[2, 'in_cycle']), 1.0, "Batch Leg 3 must have in_cycle=1")
        self.assertEqual(float(single_res_3['in_cycle']), 1.0, "Single Leg 3 must have in_cycle=1")

        # Feature parity across all graph features for all 3 legs
        for col in GRAPH_FEATURE_COLS:
            self.assertAlmostEqual(
                float(batch_res.loc[0, col]), float(single_res_1[col]), places=5,
                msg=f"Parity mismatch for Leg 1 feature '{col}'"
            )
            self.assertAlmostEqual(
                float(batch_res.loc[1, col]), float(single_res_2[col]), places=5,
                msg=f"Parity mismatch for Leg 2 feature '{col}'"
            )
            self.assertAlmostEqual(
                float(batch_res.loc[2, col]), float(single_res_3[col]), places=5,
                msg=f"Parity mismatch for Leg 3 feature '{col}'"
            )


if __name__ == '__main__':
    unittest.main()
