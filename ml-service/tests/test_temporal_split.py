"""
Tests for Temporal Chronological Splitting and AML Evaluation Constraints.
Ensures zero temporal data leakage (test rows strictly follow train rows) and
validates account-disjoint separation.
"""

import os
import sys
import unittest
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from train import temporal_split, account_disjoint_split, select_optimal_threshold


class TestSplitsAndEvaluation(unittest.TestCase):

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

    def test_no_row_in_test_earlier_than_max_train_timestamp(self):
        """
        Requirement 8: No row in the test set has a timestamp earlier
        than the max train timestamp.
        """
        train_df, val_df, test_df = temporal_split(self.df, train_ratio=0.70, val_ratio=0.15)

        max_train_ts = train_df['timestamp'].max()
        min_test_ts = test_df['timestamp'].min()

        self.assertGreaterEqual(
            min_test_ts,
            max_train_ts,
            f"Temporal leakage detected: min test timestamp ({min_test_ts}) "
            f"is earlier than max train timestamp ({max_train_ts})"
        )
        print(f"\n[OK] Temporal split verified: max train timestamp = {max_train_ts}, min test timestamp = {min_test_ts}")

    def test_temporal_val_strictly_between_train_and_test(self):
        """Validation split must strictly follow train and strictly precede test."""
        train_df, val_df, test_df = temporal_split(self.df, train_ratio=0.70, val_ratio=0.15)

        max_train_ts = train_df['timestamp'].max()
        min_val_ts = val_df['timestamp'].min()
        max_val_ts = val_df['timestamp'].max()
        min_test_ts = test_df['timestamp'].min()

        self.assertGreaterEqual(min_val_ts, max_train_ts)
        self.assertGreaterEqual(min_test_ts, max_val_ts)
        self.assertEqual(len(train_df) + len(val_df) + len(test_df), len(self.df))

    def test_account_disjoint_split_mutually_exclusive(self):
        """Account-disjoint split must partition sender accounts mutually exclusively."""
        train_df, val_df, test_df = account_disjoint_split(self.df, train_ratio=0.70, val_ratio=0.15)

        train_senders = set(train_df['sender_account'])
        val_senders = set(val_df['sender_account'])
        test_senders = set(test_df['sender_account'])

        self.assertTrue(train_senders.isdisjoint(test_senders), "Train and test senders must be disjoint")
        self.assertTrue(train_senders.isdisjoint(val_senders), "Train and val senders must be disjoint")
        self.assertTrue(val_senders.isdisjoint(test_senders), "Val and test senders must be disjoint")
        print(f"\n[OK] Account-disjoint split verified: {len(train_senders)} train, {len(val_senders)} val, {len(test_senders)} test senders.")

    def test_threshold_selection_capacity_constraint(self):
        """Threshold tuning must honor the analyst capacity constraint (alerts/day)."""
        y_val = [0] * 900 + [1] * 100
        # Probabilities: 100 positives with high prob, 900 negatives with low prob
        y_val_prob = [0.1] * 800 + [0.4] * 100 + [0.85] * 80 + [0.95] * 20
        # Simulated 30-day period
        dates = pd.date_range('2026-01-01', periods=1000, freq='45min')

        max_capacity = 5.0 # Max 5 alerts/day over ~31.25 days = ~156 alerts
        thresh, daily = select_optimal_threshold(y_val, y_val_prob, dates, max_capacity)

        self.assertLessEqual(daily, max_capacity + 0.1)
        self.assertGreater(thresh, 0.0)


if __name__ == '__main__':
    unittest.main()
