import os
import json
import pickle
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime

from train import train_and_evaluate, engineer_features

app = Flask(__name__)
CORS(app)

# ── Global model state ────────────────────────────────────────────────────────
model               = None
scaler              = None
feature_cols        = None
metrics             = None
shap_bg_sample      = None
shap_tree_explainer = None
shap_kernel_explainer = None


def load_resources():
    global model, scaler, feature_cols, metrics
    global shap_bg_sample, shap_tree_explainer, shap_kernel_explainer
    try:
        models_dir   = os.path.join(os.path.dirname(__file__), 'models')
        model_path   = os.path.join(models_dir, 'best_model.pkl')
        scaler_path  = os.path.join(models_dir, 'scaler.pkl')
        metrics_path = os.path.join(models_dir, 'metrics.json')

        if os.path.exists(model_path) and os.path.exists(scaler_path):
            with open(model_path, 'rb') as f:
                model = pickle.load(f)
            with open(scaler_path, 'rb') as f:
                scaler = pickle.load(f)
            print("Successfully loaded model and scaler.")
        else:
            print("Model files not found. Train the model first via /train.")

        if os.path.exists(metrics_path):
            with open(metrics_path, 'r') as f:
                metrics = json.load(f)
            feature_cols = metrics.get('features')
            print(f"Loaded metrics. Best model: {metrics.get('best_model')}")

        # ── Pre-compute SHAP explainer once at startup ────────────────────
        # Doing this per-request previously took ~30s and blew past the
        # backend's timeout on every call.  Building it once here makes
        # /predict return in milliseconds.
        if model is not None and feature_cols is not None:
            import shap
            dataset_path = os.path.join(
                os.path.dirname(__file__), '..', 'dataset', 'dataset.csv'
            )
            if os.path.exists(dataset_path):
                df_bg     = pd.read_csv(dataset_path, nrows=300)
                df_bg_eng = engineer_features(df_bg)[feature_cols]
                shap_bg_sample = df_bg_eng.sample(
                    n=min(100, len(df_bg_eng)), random_state=42
                )

                model_type = str(type(model))
                if any(k in model_type for k in ['xgb', 'Forest', 'Tree', 'Boosting']):
                    shap_tree_explainer = shap.TreeExplainer(model)
                else:
                    shap_kernel_explainer = shap.Explainer(
                        model.predict_proba, shap_bg_sample
                    )
                print("SHAP explainer precomputed and cached.")
    except Exception as e:
        print(f"Error loading resources: {e}")


load_resources()


# ── Feature computation for a single transaction ──────────────────────────────

def calculate_single_features(tx, sender_history, receiver_history):
    """
    Computes the exact same feature set as engineer_features() but for a
    single live transaction, using sender/receiver history as context.
    """
    amount       = float(tx.get('amount', 0))
    country      = tx.get('country', 'IN')
    pay_method   = tx.get('payment_method', 'UPI')
    category     = tx.get('category', 'Transfer')
    tx_time      = pd.to_datetime(tx.get('timestamp', datetime.now().isoformat()))

    high_risk_countries = ['KY', 'PA', 'AE', 'RU', 'BS', 'LU']

    is_high_risk_country  = 1 if country in high_risk_countries else 0
    is_wire_or_crypto     = 1 if pay_method in ['Crypto Transfer', 'Cash Deposit', 'RTGS'] else 0
    is_night              = 1 if tx_time.hour in [22, 23, 0, 1, 2, 3, 4, 5] else 0
    is_transfer           = 1 if category == 'Transfer' else 0
    amount_near_threshold = 1 if (820000 <= amount <= 999000) else 0
    is_large_amount       = 1 if amount >= 500000 else 0
    log_amount            = float(np.log1p(amount))

    def _last_time_diff(history):
        if not history:
            return 9999.0
        prev = [pd.to_datetime(h.get('timestamp'))
                for h in history if h.get('timestamp')]
        prev = [t for t in prev if t < tx_time]
        if not prev:
            return 9999.0
        return (tx_time - max(prev)).total_seconds() / 60.0

    def _velocity_2h(history):
        if not history:
            return 0
        cutoff = tx_time - pd.Timedelta(hours=2)
        return sum(
            1 for h in history
            if h.get('timestamp') and cutoff <= pd.to_datetime(h.get('timestamp')) < tx_time
        )

    return {
        'log_amount':            log_amount,
        'amount':                amount,
        'is_high_risk_country':  is_high_risk_country,
        'is_wire_or_crypto':     is_wire_or_crypto,
        'is_night':              is_night,
        'is_transfer':           is_transfer,
        'amount_near_threshold': amount_near_threshold,
        'is_large_amount':       is_large_amount,
        'sender_time_diff':      _last_time_diff(sender_history),
        'receiver_time_diff':    _last_time_diff(receiver_history),
        'sender_velocity_2h':    _velocity_2h(sender_history),
        'receiver_velocity_2h':  _velocity_2h(receiver_history),
    }


# ── Rich, context-aware SHAP reason generator ─────────────────────────────────

def _build_rich_reasons(shap_explanations, features_dict, risk_score):
    """
    Converts SHAP values + actual feature values into detailed, human-readable
    AML investigation reasons.  Each reason is specific to the actual values
    observed — not a generic label.
    """
    amount      = features_dict.get('amount', 0)
    country     = features_dict.get('_country', '')
    pay_method  = features_dict.get('_payment_method', '')
    velocity_s  = int(features_dict.get('sender_velocity_2h', 0))
    velocity_r  = int(features_dict.get('receiver_velocity_2h', 0))
    s_diff      = features_dict.get('sender_time_diff', 9999)
    r_diff      = features_dict.get('receiver_time_diff', 9999)
    tx_hour     = features_dict.get('_hour', -1)

    COUNTRY_NAMES = {
        'KY': 'Cayman Islands (offshore tax haven)',
        'PA': 'Panama (FATF grey-listed jurisdiction)',
        'AE': 'UAE / Dubai (high cash-intensity hub)',
        'RU': 'Russia (sanctions-listed jurisdiction)',
        'BS': 'Bahamas (offshore financial centre)',
        'LU': 'Luxembourg (opaque holding jurisdiction)',
    }

    reason_templates = {
        'amount_near_threshold': (
            f"₹{amount:,.0f} structured just below the ₹10,00,000 Cash Transaction "
            f"Report (CTR) threshold — classic smurfing/structuring pattern to evade "
            f"regulatory reporting obligations"
        ),
        'is_large_amount': (
            f"Abnormally large single transfer of ₹{amount:,.0f} — "
            f"{'exceeds ₹25L' if amount >= 2500000 else 'exceeds ₹5L'} retail baseline; "
            f"consistent with layering or integration stage of money laundering"
        ),
        'amount': (
            f"Transfer amount ₹{amount:,.0f} is statistically anomalous "
            f"for this account tier"
        ),
        'is_high_risk_country': (
            f"Transaction routed through {COUNTRY_NAMES.get(country, country)} — "
            f"a FATF-flagged or offshore jurisdiction with high ML/TF exposure; "
            f"cross-border flows to such jurisdictions require enhanced due diligence"
        ),
        'is_wire_or_crypto': (
            f"Payment channel '{pay_method}' is high-risk and semi-anonymous — "
            f"{'cryptocurrency transfers bypass traditional AML controls' if pay_method == 'Crypto Transfer' else 'large RTGS/cash deposits are frequently used in layering schemes'}"
        ),
        'is_night': (
            f"Transaction executed at {tx_hour:02d}:xx hours — "
            f"off-hours transfers outside business windows are a recognized red flag "
            f"in RBI's suspicious transaction guidelines"
        ),
        'is_transfer': (
            f"Direct capital transfer with no associated retail/commercial purpose — "
            f"unclassified fund movements are a hallmark of placement and layering phases"
        ),
        'sender_time_diff': (
            f"Sender initiated another transaction only {s_diff:.1f} minutes ago — "
            f"rapid-fire transfers from the same account suggest automated structuring "
            f"or account takeover activity"
        ) if s_diff < 30 else (
            f"Unusually fast repeat transactions from sender account "
            f"({s_diff:.1f} min gap) indicate potential velocity abuse"
        ),
        'receiver_time_diff': (
            f"Receiver account received a prior transaction {r_diff:.1f} minutes ago — "
            f"multiple rapid inflows to the same account are consistent with "
            f"smurfing aggregation or funnel account behavior"
        ),
        'sender_velocity_2h': (
            f"Sender made {velocity_s} transaction(s) within the last 2 hours — "
            f"high-velocity bursts are a primary indicator of structuring, "
            f"account mule activity, or automated fraud scripts"
        ),
        'receiver_velocity_2h': (
            f"Receiver collected {velocity_r} inbound transaction(s) within 2 hours — "
            f"consistent with a funnel/mule account aggregating illicit proceeds "
            f"before onward transfer"
        ),
    }

    # Rank SHAP contributors descending
    ranked = sorted(
        [s for s in shap_explanations if s['shap_value'] > 0.005],
        key=lambda x: x['shap_value'],
        reverse=True
    )

    reasons = []
    for item in ranked[:4]:
        col = item['feature']
        if col in reason_templates:
            text = reason_templates[col]
            # Only add the same reason once
            if not any(text[:40] in r for r in reasons):
                reasons.append(text)

    if not reasons and risk_score >= 35:
        reasons.append(
            f"Elevated composite risk score ({risk_score}/100) driven by a combination "
            f"of transaction pattern anomalies — manual review recommended per PMLA guidelines"
        )

    return reasons


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status':       'healthy',
        'model_loaded': model is not None,
        'best_model':   metrics.get('best_model') if metrics else None,
        'fraud_rate':   metrics.get('fraud_rate') if metrics else None,
    })


@app.route('/train', methods=['POST'])
def train():
    try:
        new_metrics = train_and_evaluate()
        load_resources()
        return jsonify({
            'success': True,
            'message': 'Model training completed successfully.',
            'metrics': new_metrics
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/predict', methods=['POST'])
def predict():
    global model, scaler, feature_cols
    if model is None:
        return jsonify({
            'success': False,
            'error':   'Model not trained. Please train first via /train.'
        }), 400

    try:
        data             = request.get_json() or {}
        tx               = data.get('transaction', {})
        sender_history   = data.get('sender_history', [])
        receiver_history = data.get('receiver_history', [])

        features_dict = calculate_single_features(tx, sender_history, receiver_history)
        # Stash raw fields for rich reason generation
        features_dict['_country']        = tx.get('country', '')
        features_dict['_payment_method'] = tx.get('payment_method', '')
        features_dict['_hour']           = pd.to_datetime(
            tx.get('timestamp', datetime.now().isoformat())
        ).hour

        features_df = pd.DataFrame([
            {k: v for k, v in features_dict.items() if not k.startswith('_')}
        ])[feature_cols]

        model_name = metrics.get('best_model', '')
        features_input = (scaler.transform(features_df)
                          if model_name == 'Logistic Regression'
                          else features_df.values)

        prob       = float(model.predict_proba(features_input)[0][1])
        prediction = int(model.predict(features_input)[0])
        risk_score = int(prob * 100)

        # ── SHAP explanation ─────────────────────────────────────────────
        shap_explanations = []
        try:
            if shap_tree_explainer is not None:
                shap_vals = shap_tree_explainer.shap_values(features_df)
                # Handle both old (list/2D) and new (3D ndarray: samples x features x classes) formats
                if isinstance(shap_vals, list):
                    shap_vals = shap_vals[1]   # old: list[class] -> (samples, features)
                elif isinstance(shap_vals, np.ndarray) and shap_vals.ndim == 3:
                    shap_vals = shap_vals[:, :, 1]  # new: (samples, features, classes) -> class 1
                raw_shap = shap_vals[0]
            elif shap_kernel_explainer is not None:
                shap_vals = shap_kernel_explainer(features_df).values[:, :, 1]
                raw_shap  = shap_vals[0]
            else:
                raise RuntimeError("No precomputed SHAP explainer available.")

            for col, val in zip(feature_cols, raw_shap):
                shap_explanations.append({
                    'feature':      col,
                    'shap_value':   float(val),
                    'actual_value': float(features_dict.get(col, 0))
                })

        except Exception as shap_err:
            print(f"SHAP computation failed, using heuristic: {shap_err}")
            importances = (
                model.feature_importances_ if hasattr(model, 'feature_importances_')
                else np.abs(model.coef_[0]) if hasattr(model, 'coef_')
                else [0.1] * len(feature_cols)
            )
            for idx, col in enumerate(feature_cols):
                actual = float(features_dict.get(col, 0))
                val = importances[idx] * (
                    2.0 if col in ('sender_time_diff', 'receiver_time_diff') and actual < 30
                    else (1.0 if actual > 0 and col not in ('sender_time_diff', 'receiver_time_diff')
                          else -0.05)
                )
                shap_explanations.append({
                    'feature':      col,
                    'shap_value':   float(val),
                    'actual_value': actual
                })

        reasons = _build_rich_reasons(shap_explanations, features_dict, risk_score)

        return jsonify({
            'success':          True,
            'prediction':       prediction,
            'risk_score':       risk_score,
            'features':         {k: v for k, v in features_dict.items() if not k.startswith('_')},
            'shap_explanations': shap_explanations,
            'reasons':          reasons
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/batch-predict', methods=['POST'])
def batch_predict():
    """
    High-throughput batch scoring for bulk CSV imports.
    Accepts a list of transactions and returns predictions for all in one call.
    No per-row HTTP overhead — dramatically faster than N sequential /predict calls.
    """
    global model, scaler, feature_cols
    if model is None:
        return jsonify({
            'success': False,
            'error':   'Model not trained. Please train first via /train.'
        }), 400

    try:
        data         = request.get_json() or {}
        transactions = data.get('transactions', [])

        if not transactions:
            return jsonify({'success': True, 'results': []})

        # ── Build feature matrix for all transactions in one pass ─────────
        rows = []
        meta = []  # store raw fields for rich reason generation
        for tx in transactions:
            fd = calculate_single_features(tx, [], [])  # no history in batch mode
            fd['_country']        = tx.get('country', '')
            fd['_payment_method'] = tx.get('payment_method', '')
            fd['_hour']           = pd.to_datetime(
                tx.get('timestamp', datetime.now().isoformat())
            ).hour
            rows.append({k: v for k, v in fd.items() if not k.startswith('_')})
            meta.append(fd)

        features_df = pd.DataFrame(rows)[feature_cols]

        model_name = metrics.get('best_model', '')
        features_input = (scaler.transform(features_df)
                          if model_name == 'Logistic Regression'
                          else features_df.values)

        probs       = model.predict_proba(features_input)[:, 1]
        predictions = model.predict(features_input)

        # ── Compute SHAP for all rows at once (tree models only) ──────────
        all_shap = None
        try:
            if shap_tree_explainer is not None:
                sv = shap_tree_explainer.shap_values(features_df)
                # Handle both old (list/2D) and new (3D ndarray: samples x features x classes) formats
                if isinstance(sv, list):
                    all_shap = sv[1]            # old: list[class] -> (samples, features)
                elif isinstance(sv, np.ndarray) and sv.ndim == 3:
                    all_shap = sv[:, :, 1]      # new: (samples, features, classes) -> class 1
                else:
                    all_shap = sv
        except Exception as shap_err:
            print(f"SHAP batch computation failed, using heuristic: {shap_err}")
            all_shap = None

        results = []
        for i, tx in enumerate(transactions):
            risk_score  = int(float(probs[i]) * 100)
            prediction  = int(predictions[i])
            fd          = meta[i]

            shap_explanations = []
            if all_shap is not None:
                for col, val in zip(feature_cols, all_shap[i]):
                    shap_explanations.append({
                        'feature':      col,
                        'shap_value':   float(val),
                        'actual_value': float(rows[i].get(col, 0))
                    })
            else:
                # Lightweight heuristic SHAP for batch mode fallback
                importances = (
                    model.feature_importances_ if hasattr(model, 'feature_importances_')
                    else np.abs(model.coef_[0]) if hasattr(model, 'coef_')
                    else [0.1] * len(feature_cols)
                )
                for idx, col in enumerate(feature_cols):
                    actual = float(rows[i].get(col, 0))
                    shap_val = importances[idx] * (1.0 if actual > 0 else -0.05)
                    shap_explanations.append({
                        'feature':      col,
                        'shap_value':   float(shap_val),
                        'actual_value': actual
                    })

            reasons = _build_rich_reasons(shap_explanations, fd, risk_score)

            results.append({
                'transaction_id':    tx.get('transaction_id', ''),
                'risk_score':        risk_score,
                'is_laundering':     prediction,
                'reasons':           reasons,
                'shap_explanations': shap_explanations,
            })

        return jsonify({'success': True, 'results': results})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/graph-analysis', methods=['POST'])
def graph_analysis():
    try:
        from graph_module import analyze_transaction_graph
        data              = request.get_json() or {}
        transactions_list = data.get('transactions', [])
        analysis_result   = analyze_transaction_graph(transactions_list)
        return jsonify({'success': True, 'data': analysis_result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/metrics', methods=['GET'])
def get_metrics():
    if metrics is None:
        load_resources()
    return jsonify({'success': True, 'metrics': metrics})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
