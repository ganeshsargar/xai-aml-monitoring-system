import os
import json
import pickle
import pandas as pd
import numpy as np
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                             f1_score, roc_auc_score, confusion_matrix)
import xgboost as xgb


def engineer_features(df):
    """
    Feature engineering for AML detection.
    Returns the input DataFrame with additional computed feature columns.
    All new columns are numerics suitable for ML model training.
    """
    df = df.copy()
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)

    # ── Time-based features ──────────────────────────────────────────────────
    df['hour'] = df['timestamp'].dt.hour
    df['day_of_week'] = df['timestamp'].dt.dayofweek

    # ── Risk Indicator flags ─────────────────────────────────────────────────
    high_risk_countries = ['KY', 'PA', 'AE', 'RU', 'BS', 'LU']
    df['is_high_risk_country'] = df['country'].isin(high_risk_countries).astype(int)

    # Crypto Transfer and Cash Deposit are the highest-risk anonymous channels
    df['is_wire_or_crypto'] = df['payment_method'].isin(
        ['Crypto Transfer', 'Cash Deposit', 'RTGS']
    ).astype(int)

    df['is_night'] = df['hour'].isin([22, 23, 0, 1, 2, 3, 4, 5]).astype(int)
    df['is_transfer'] = (df['category'] == 'Transfer').astype(int)

    # Indian CTR threshold is ₹10,00,000.  Structuring typically clusters at
    # 82–99% of that limit.  Flag the suspicious band.
    df['amount_near_threshold'] = (
        (df['amount'] >= 820000) & (df['amount'] <= 999000)
    ).astype(int)

    # Large single transfers (> ₹5,00,000) are statistically rare for retail
    df['is_large_amount'] = (df['amount'] >= 500000).astype(int)

    # Log-amount (handles the heavy right-tail without outlier sensitivity)
    df['log_amount'] = np.log1p(df['amount'])

    # ── Sender behavioral velocity ────────────────────────────────────────────
    df['sender_time_diff'] = (
        df.groupby('sender_account')['timestamp']
        .diff()
        .dt.total_seconds() / 60.0
    )
    df['sender_time_diff'] = df['sender_time_diff'].fillna(9999.0)

    df['receiver_time_diff'] = (
        df.groupby('receiver_account')['timestamp']
        .diff()
        .dt.total_seconds() / 60.0
    )
    df['receiver_time_diff'] = df['receiver_time_diff'].fillna(9999.0)

    # Transaction velocity: count of sender/receiver tx in last 2 hours
    sender_counts = []
    receiver_counts = []
    for idx, row in df.iterrows():
        sender = row['sender_account']
        receiver = row['receiver_account']
        time = row['timestamp']
        cutoff = time - pd.Timedelta(hours=2)

        s_count = len(df[
            (df['sender_account'] == sender) &
            (df['timestamp'] < time) &
            (df['timestamp'] >= cutoff)
        ])
        r_count = len(df[
            (df['receiver_account'] == receiver) &
            (df['timestamp'] < time) &
            (df['timestamp'] >= cutoff)
        ])
        sender_counts.append(s_count)
        receiver_counts.append(r_count)

    df['sender_velocity_2h'] = sender_counts
    df['receiver_velocity_2h'] = receiver_counts

    return df


def train_and_evaluate():
    dataset_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), 'dataset', 'dataset.csv'
    )

    if not os.path.exists(dataset_path):
        print(f"Dataset not found at {dataset_path}. Generating it first...")
        from dataset.generate_dataset import generate_aml_data
        generate_aml_data(15000)

    print(f"Loading dataset from: {dataset_path}")
    df = pd.read_csv(dataset_path)
    print(f"Loaded {len(df):,} rows. Running feature engineering...")
    df = engineer_features(df)

    feature_cols = [
        'log_amount',               # log-scaled amount (handles huge INR range)
        'amount',                   # raw amount for threshold-detection context
        'is_high_risk_country',
        'is_wire_or_crypto',
        'is_night',
        'is_transfer',
        'amount_near_threshold',
        'is_large_amount',
        'sender_time_diff',
        'receiver_time_diff',
        'sender_velocity_2h',
        'receiver_velocity_2h',
    ]

    X = df[feature_cols]
    y = df['is_laundering']

    fraud_rate = y.mean()
    print(f"Class balance — fraud rate: {fraud_rate:.3%}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled  = scaler.transform(X_test)

    # scale_pos_weight for XGBoost (handles class imbalance)
    scale_pos_weight = max(1.0, (1.0 - fraud_rate) / fraud_rate)

    candidates = {
        'Logistic Regression': {
            'model': LogisticRegression(
                max_iter=1000, random_state=42,
                class_weight='balanced'   # auto-handles imbalance
            ),
            'scaled': True
        },
        'Decision Tree': {
            'model': DecisionTreeClassifier(
                max_depth=7, random_state=42,
                class_weight='balanced'
            ),
            'scaled': False
        },
        'Random Forest': {
            'model': RandomForestClassifier(
                n_estimators=150, max_depth=10, random_state=42,
                class_weight='balanced', n_jobs=-1
            ),
            'scaled': False
        },
        'Gradient Boosting': {
            'model': GradientBoostingClassifier(
                n_estimators=150, max_depth=5, learning_rate=0.08,
                subsample=0.8, random_state=42
            ),
            'scaled': False
        },
        'XGBoost': {
            'model': xgb.XGBClassifier(
                n_estimators=150, max_depth=6, learning_rate=0.08,
                subsample=0.8, colsample_bytree=0.8,
                scale_pos_weight=scale_pos_weight,
                random_state=42, eval_metric='logloss',
                use_label_encoder=False
            ),
            'scaled': False
        },
    }

    results = {}
    best_score = 0.0
    best_model_name = ''
    best_model_obj  = None

    # For severe imbalance (fraud < 5%), AUC-ROC is more informative than F1.
    # Otherwise use F1 which balances precision + recall.
    use_auc_as_primary = fraud_rate < 0.05

    for name, config in candidates.items():
        clf = config['model']
        is_scaled = config['scaled']

        if is_scaled:
            clf.fit(X_train_scaled, y_train)
            y_pred = clf.predict(X_test_scaled)
            y_prob = clf.predict_proba(X_test_scaled)[:, 1]
        else:
            clf.fit(X_train, y_train)
            y_pred = clf.predict(X_test)
            y_prob = clf.predict_proba(X_test)[:, 1]

        acc  = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec  = recall_score(y_test, y_pred, zero_division=0)
        f1   = f1_score(y_test, y_pred, zero_division=0)
        auc  = roc_auc_score(y_test, y_prob)
        cm   = confusion_matrix(y_test, y_pred).tolist()

        results[name] = {
            'accuracy':          float(acc),
            'precision':         float(prec),
            'recall':            float(rec),
            'f1_score':          float(f1),
            'roc_auc':           float(auc),
            'confusion_matrix':  cm,
        }

        primary_score = auc if use_auc_as_primary else f1
        metric_label  = 'AUC-ROC' if use_auc_as_primary else 'F1'
        print(f"[{name}] F1={f1:.4f} | AUC={auc:.4f} | Recall={rec:.4f} "
              f"| Primary({metric_label})={primary_score:.4f}")

        if primary_score > best_score:
            best_score      = primary_score
            best_model_name = name
            best_model_obj  = clf

    print(f"\n[BEST] Model: {best_model_name} "
          f"({'AUC-ROC' if use_auc_as_primary else 'F1'}={best_score:.4f})")

    # ── Save artefacts ────────────────────────────────────────────────────────
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)

    with open(os.path.join(models_dir, 'best_model.pkl'), 'wb') as f:
        pickle.dump(best_model_obj, f)
    with open(os.path.join(models_dir, 'scaler.pkl'), 'wb') as f:
        pickle.dump(scaler, f)

    metrics_output = {
        'comparison':   results,
        'best_model':   best_model_name,
        'features':     feature_cols,
        'fraud_rate':   float(fraud_rate),
        'trained_at':   datetime.now().isoformat(),
    }
    with open(os.path.join(models_dir, 'metrics.json'), 'w') as f:
        json.dump(metrics_output, f, indent=4)

    print(f"[OK] Models and metrics saved to {models_dir}")
    return metrics_output


if __name__ == '__main__':
    train_and_evaluate()
