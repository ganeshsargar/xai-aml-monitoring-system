from typing import List, Dict, Any, Optional
import os
import json
import pickle
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime

from train import train_and_evaluate
from features import FEATURE_COLS, compute_features_batch, compute_features_single
from risk_config import get_high_risk_jurisdictions, get_ctr_threshold, get_large_amount_threshold
import model_registry


app = Flask(__name__)
CORS(app)

# ── Global Model & Registry State ─────────────────────────────────────────────
champion_bundle       = None
challenger_bundle     = None
shadow_mode_enabled   = False
shap_bg_sample        = None
shap_tree_explainer   = None
shap_kernel_explainer = None


def load_resources():
    """
    Version-aware model loader.
    Loads active Champion model and (if shadow mode enabled) Challenger model
    from registry.json. Precomputes SHAP explainer on champion classifier.
    """
    global champion_bundle, challenger_bundle, shadow_mode_enabled
    global shap_bg_sample, shap_tree_explainer, shap_kernel_explainer

    try:
        active_models = model_registry.get_active_models()
        champion_bundle = active_models.get('champion')
        challenger_bundle = active_models.get('challenger')
        shadow_mode_enabled = active_models.get('shadow_mode_enabled', False)

        if champion_bundle:
            c_ver = champion_bundle.get('version_id')
            c_name = champion_bundle.get('metadata', {}).get('model_name', 'Classifier')
            print(f"[Model Registry Loader] Active Champion: {c_name} (Version: {c_ver})")
        else:
            print("[Model Registry Loader] No champion model loaded. Please trigger training first.")

        if shadow_mode_enabled and challenger_bundle:
            ch_ver = challenger_bundle.get('version_id')
            ch_name = challenger_bundle.get('metadata', {}).get('model_name', 'Classifier')
            print(f"[Model Registry Loader] Shadow Mode Active: Running Challenger {ch_name} (Version: {ch_ver})")

        # Precompute SHAP explainer on champion
        if champion_bundle and champion_bundle.get('model') is not None:
            import shap
            champ_model = champion_bundle['model']
            f_cols = champion_bundle.get('feature_cols', FEATURE_COLS)

            dataset_path = os.path.join(os.path.dirname(__file__), '..', 'dataset', 'dataset.csv')
            if os.path.exists(dataset_path):
                df_bg = pd.read_csv(dataset_path, nrows=300)
                df_bg_eng = compute_features_batch(df_bg)[f_cols]
                shap_bg_sample = df_bg_eng.sample(n=min(100, len(df_bg_eng)), random_state=42)

                base_model = champ_model
                while hasattr(base_model, 'estimator'):
                    base_model = base_model.estimator

                model_type = str(type(base_model))
                if any(k in model_type for k in ['xgb', 'Forest', 'Tree', 'Boosting']):
                    shap_tree_explainer = shap.TreeExplainer(base_model)
                else:
                    shap_kernel_explainer = shap.Explainer(champ_model.predict_proba, shap_bg_sample)
                print("SHAP explainer precomputed and cached on Champion model.")

    except Exception as e:
        print(f"[Model Loader Error]: {e}")


load_resources()


# ── Rich, Context-Aware SHAP Reason Generator ─────────────────────────────────

def _build_rich_reasons(shap_explanations, features_dict, risk_score):
    """
    Converts SHAP values + actual feature values into detailed, human-readable
    AML investigation reasons with calibrated thresholds.
    """
    amount      = features_dict.get('amount', 0)
    country     = features_dict.get('_country', '')
    pay_method  = features_dict.get('_payment_method', '')
    velocity_s  = int(features_dict.get('sender_velocity_2h', 0))
    velocity_r  = int(features_dict.get('receiver_velocity_2h', 0))
    s_diff      = features_dict.get('sender_time_diff', 9999)
    r_diff      = features_dict.get('receiver_time_diff', 9999)
    tx_hour     = features_dict.get('_hour', -1)

    in_cycle    = int(features_dict.get('in_cycle', 0))
    cycle_cnt   = int(features_dict.get('cycle_count', 0))
    pt_ratio    = float(features_dict.get('pass_through_ratio', 0.0))
    counterparties = int(features_dict.get('distinct_counterparties', 0))
    in_deg      = int(features_dict.get('in_degree', 0))
    out_deg     = int(features_dict.get('out_degree', 0))
    pr          = float(features_dict.get('pagerank', 0.0))
    dev_deg     = int(features_dict.get('shared_device_degree', 0))
    neigh_risk  = float(features_dict.get('neighbor_max_risk', 0.0))

    z_score     = float(features_dict.get('amount_zscore_vs_own_history', 0.0))
    vol_ratio   = float(features_dict.get('volume_vs_declared_income', 0.0))
    new_cp      = int(features_dict.get('new_counterparty_flag', 0))
    new_geo     = int(features_dict.get('new_country_flag', 0))
    acc_age     = float(features_dict.get('account_age_days', 365.0))
    dormant_act = int(features_dict.get('dormant_reactivation', 0))
    peer_pct    = float(features_dict.get('peer_percentile', 0.5))

    reasons = []

    if in_cycle == 1 or cycle_cnt > 0:
        reasons.append(
            f"Network round-trip cycle detected: funds routed through {max(cycle_cnt, 1)} directed loop(s) returning to origin account (layering topology)"
        )

    if dev_deg > 0:
        reasons.append(
            f"Device / IP fingerprint shared across {dev_deg} distinct counterparties — potential multi-account syndicate or mule operator"
        )

    if pt_ratio >= 0.70:
        reasons.append(
            f"High pass-through flow: {int(pt_ratio * 100)}% of inbound credits forwarded immediately to third parties (rapid transit account pattern)"
        )

    if neigh_risk >= 0.60:
        reasons.append(
            f"High counterparty contamination: direct counterparties include high-risk entities (max counterparty risk {int(neigh_risk * 100)}%)"
        )

    if in_deg >= 4 and out_deg <= 1:
        reasons.append(
            f"Many-to-one funnel aggregation: account received funds from {in_deg} disparate sources with concentrated outbound dispersion"
        )
    elif out_deg >= 4 and in_deg <= 1:
        reasons.append(
            f"One-to-many dispersion (smurfing/fan-out): account dispersed funds rapidly to {out_deg} separate recipient accounts"
        )

    if dormant_act == 1:
        reasons.append(
            f"Dormant account reactivation: account inactive for >90 days suddenly transacted high-value transfer of ₹{amount:,.2f}"
        )

    if vol_ratio >= 2.0:
        reasons.append(
            f"Turnover anomaly: 30-day transacted volume represents {vol_ratio:.1f}x declared monthly income/turnover baseline"
        )

    if z_score >= 2.5:
        reasons.append(
            f"Behavioral departure: transaction amount is {z_score:.1f} standard deviations above account's historical average"
        )

    high_risk_jurisdictions = get_high_risk_jurisdictions()
    if country in high_risk_jurisdictions:
        j_label = high_risk_jurisdictions[country].get('label', 'FATF Monitored')
        reasons.append(
            f"Cross-border transfer to/from {country} ({j_label}) — jurisdiction with elevated AML/CFT deficiencies"
        )

    ctr = get_ctr_threshold()
    if 0.82 * ctr <= amount < ctr:
        reasons.append(
            f"₹{amount:,.2f} structured near statutory CTR threshold (₹{ctr:,.2f}) — smurfing to evade regulatory reporting"
        )
    elif amount >= ctr * 5:
        reasons.append(
            f"Exceptionally large transfer ₹{amount:,.2f} — exceeds retail baseline; consistent with integration stage of money laundering"
        )
    elif amount >= ctr:
        reasons.append(
            f"High-value transfer ₹{amount:,.2f} exceeds mandatory CTR reporting threshold (₹{ctr:,.2f})"
        )

    if pay_method in ('Crypto Transfer', 'Cash Deposit', 'RTGS'):
        reasons.append(
            f"Payment method '{pay_method}' carries high anonymity or instant settlement risk"
        )

    if velocity_s >= 3:
        reasons.append(
            f"Sender velocity burst: {velocity_s} transactions executed within preceding 2-hour window (burst dispersion pattern)"
        )
    elif s_diff < 15:
        reasons.append(
            f"Rapid successive transaction: sender initiated subsequent transfer within {s_diff:.1f} minutes of previous operation"
        )

    if tx_hour in (22, 23, 0, 1, 2, 3, 4, 5):
        reasons.append(
            f"Off-hours execution: transaction timestamp ({tx_hour:02d}:00) occurs during off-hours execution window"
        )

    if new_cp == 1 and new_geo == 1:
        reasons.append(
            f"Unprecedented interaction: novel recipient account in novel country '{country}' for this sender"
        )

    if not reasons and shap_explanations:
        positive_shaps = sorted(
            [s for s in shap_explanations if s['shap_value'] > 0],
            key=lambda x: x['shap_value'],
            reverse=True
        )
        for s in positive_shaps[:3]:
            reasons.append(
                f"Feature '{s['feature']}' (value: {s['actual_value']:.2f}) positively contributed +{s['shap_value']:.3f} to ML risk score"
            )

    return reasons[:5]


# ── Health & Diagnostics ───────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    registry = model_registry.load_registry()
    return jsonify({
        'status': 'healthy',
        'model_loaded': champion_bundle is not None,
        'champion_loaded': champion_bundle is not None,
        'champion_version': registry.get('champion'),
        'challenger_version': registry.get('challenger'),
        'shadow_mode_enabled': registry.get('shadow_mode_enabled', False),
        'shadow_mode_active': registry.get('shadow_mode_enabled', False),
        'model_name': champion_bundle.get('metadata', {}).get('model_name') if champion_bundle else None,
        'metrics': champion_bundle.get('metrics') if champion_bundle else None
    })


@app.route('/metrics', methods=['GET'])
def get_metrics():
    if champion_bundle is None:
        load_resources()
    return jsonify({
        'success': True,
        'metrics': champion_bundle.get('metrics') if champion_bundle else None,
        'version_id': champion_bundle.get('version_id') if champion_bundle else None
    })


@app.route('/ablation', methods=['GET'])
def get_ablation():
    try:
        ablation_path = os.path.join(os.path.dirname(__file__), 'models', 'ablation.json')
        if os.path.exists(ablation_path):
            with open(ablation_path, 'r') as f:
                ablation_data = json.load(f)
            return jsonify({'success': True, 'data': ablation_data})
        return jsonify({'success': True, 'data': champion_bundle.get('metrics', {}).get('ablation', {}) if champion_bundle else {}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/feature-importance', methods=['GET'])
def get_feature_importance():
    try:
        if champion_bundle is None:
            load_resources()
        champ_model = champion_bundle.get('model')
        f_cols = champion_bundle.get('feature_cols', FEATURE_COLS)
        importances = []
        if hasattr(champ_model, 'feature_importances_'):
            importances = champ_model.feature_importances_.tolist()
        elif hasattr(champ_model, 'coef_'):
            importances = np.abs(champ_model.coef_[0]).tolist()
        else:
            importances = [0.05] * len(f_cols)

        fi_list = [{'feature': f, 'importance': float(i)} for f, i in zip(f_cols, importances)]
        fi_list.sort(key=lambda x: x['importance'], reverse=True)
        return jsonify({'success': True, 'feature_importance': fi_list})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Training & Versioning ──────────────────────────────────────────────────────

@app.route('/train', methods=['POST'])
def train_model():
    try:
        data = request.get_json() or {}
        labels = data.get('labels', [])
        weight = float(data.get('analyst_label_weight', 3.0))
        split_mode = data.get('split_mode', 'temporal')
        dataset_name = data.get('dataset_name', None)
        max_rows = data.get('max_rows', None)

        print(f"[ML Service] Versioned retraining triggered with {len(labels)} analyst labels (weight={weight}, split={split_mode})...")
        metrics_output = train_and_evaluate(
            split_mode=split_mode,
            dataset_name=dataset_name,
            max_rows=max_rows,
            analyst_labels=labels,
            analyst_label_weight=weight
        )

        # Reload updated model registry pointers into memory
        load_resources()

        return jsonify({
            'success': True,
            'message': f"Model retrained and saved to registry as version '{metrics_output.get('version_id')}'.",
            'version_id': metrics_output.get('version_id'),
            'metrics': metrics_output
        })
    except Exception as e:
        print(f"[ML Train Error]: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Model Registry Governance Endpoints ────────────────────────────────────────

@app.route('/versions', methods=['GET'])
@app.route('/models', methods=['GET'])
def list_versions_endpoint():
    try:
        versions = model_registry.list_versions()
        registry = model_registry.load_registry()
        return jsonify({
            'success': True,
            'count': len(versions),
            'champion': registry.get('champion'),
            'challenger': registry.get('challenger'),
            'shadow_mode_enabled': registry.get('shadow_mode_enabled', False),
            'versions': versions
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/registry', methods=['GET'])
def get_registry_endpoint():
    try:
        reg = model_registry.load_registry()
        return jsonify({'success': True, 'data': reg})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/promote', methods=['POST'])
def promote_endpoint():
    try:
        data = request.get_json() or {}
        version_id = data.get('version_id')
        if not version_id:
            return jsonify({'success': False, 'error': 'version_id is required for promotion.'}), 400

        result = model_registry.promote_version(version_id)
        load_resources()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/rollback', methods=['POST'])
def rollback_endpoint():
    try:
        data = request.get_json() or {}
        target_version = data.get('version_id')
        result = model_registry.rollback_version(target_version)
        load_resources()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/shadow-mode', methods=['POST'])
def shadow_mode_endpoint():
    try:
        data = request.get_json() or {}
        enabled = bool(data.get('enabled', False))
        challenger_version_id = data.get('challenger_version_id')
        result = model_registry.set_shadow_mode(enabled, challenger_version_id)
        load_resources()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/drift', methods=['POST'])
def drift_endpoint():
    try:
        data = request.get_json() or {}
        transactions = data.get('transactions', [])
        version_id = data.get('version_id')

        # If no live transactions provided, load a sample from recent dataset
        if not transactions:
            dataset_path = os.path.join(os.path.dirname(__file__), '..', 'dataset', 'dataset.csv')
            if os.path.exists(dataset_path):
                df_live = pd.read_csv(dataset_path, nrows=500)
            else:
                return jsonify({'success': False, 'error': 'No transactions provided and dataset.csv not found.'}), 400
        else:
            df_live = pd.DataFrame(transactions)

        drift_report = model_registry.compute_drift_analysis(df_live, version_id=version_id)
        return jsonify({'success': True, 'data': drift_report})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/versions/<version_id>/report', methods=['GET'])
def get_validation_report_endpoint(version_id):
    try:
        report_md = model_registry.generate_validation_report_markdown(version_id)
        return jsonify({
            'success': True,
            'version_id': version_id,
            'markdown': report_md
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Correlated Feature Grouping for Attribution Reporting ───────────────────────


FEATURE_GROUPS = {
    'Amount & Structuring': [
        'amount', 'log_amount', 'is_large_amount', 'amount_near_threshold'
    ],
    'Velocity & Execution Timing': [
        'sender_velocity_2h', 'receiver_velocity_2h', 'sender_time_diff', 'receiver_time_diff', 'is_night'
    ],
    'Graph Network & Typologies': [
        'in_degree', 'out_degree', 'distinct_counterparties', 'pass_through_ratio',
        'in_cycle', 'cycle_count', 'pagerank', 'shared_device_degree', 'neighbor_max_risk'
    ],
    'Jurisdiction & Payment Channel': [
        'is_high_risk_country', 'is_wire_or_crypto', 'new_country_flag', 'is_transfer'
    ],
    'Behavioral & Customer Profile': [
        'amount_zscore_vs_own_history', 'volume_vs_declared_income', 'new_counterparty_flag',
        'dormant_reactivation', 'peer_percentile', 'account_age_days'
    ]
}


def group_feature_attributions(shap_explanations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Combines correlated individual feature attributions into cohesive risk domain groups
    so attribution ranking isn't artificially split among collinear signals.
    """
    if not shap_explanations:
        return []

    shap_map = {item['feature']: item for item in shap_explanations}
    grouped_results = []
    total_abs_shap = sum(abs(item['shap_value']) for item in shap_explanations) or 1.0

    for group_name, group_features in FEATURE_GROUPS.items():
        member_items = []
        group_shap_sum = 0.0
        group_abs_sum = 0.0

        for feat in group_features:
            if feat in shap_map:
                f_item = shap_map[feat]
                member_items.append(f_item)
                group_shap_sum += f_item['shap_value']
                group_abs_sum += abs(f_item['shap_value'])

        if not member_items:
            continue

        # Find dominant driver in group
        member_items.sort(key=lambda x: abs(x['shap_value']), reverse=True)
        dominant_feature = member_items[0]['feature'] if member_items else 'N/A'

        grouped_results.append({
            'group_name': group_name,
            'group_shap_sum': round(float(group_shap_sum), 4),
            'group_abs_impact': round(float(group_abs_sum), 4),
            'importance_percentage': round(float((group_abs_sum / total_abs_shap) * 100), 1),
            'direction': 'Elevates Risk' if group_shap_sum > 0 else 'Mitigates Risk',
            'dominant_feature': dominant_feature,
            'feature_count': len(member_items),
            'features': member_items
        })

    # Sort groups by highest net risk attribution first
    grouped_results.sort(key=lambda g: g['group_shap_sum'], reverse=True)
    return grouped_results


def _generate_why_alert_summary(reasons: List[str], grouped_attributions: List[Dict], risk_score: int) -> str:
    """Produces a concise 1-2 sentence executive explanation of primary risk drivers."""
    if risk_score < 30:
        return "Transaction exhibits standard retail behavioral patterns with minimal typology risk indicators."

    top_groups = [g['group_name'] for g in grouped_attributions if g['group_shap_sum'] > 0]
    if top_groups:
        primary_group = top_groups[0]
        secondary_clause = f" combined with elevated {top_groups[1].lower()}" if len(top_groups) > 1 else ""
        top_reason = reasons[0] if reasons else "anomalous transaction parameters"
        return f"Alert triggered primarily due to high-risk signals in {primary_group}{secondary_clause}. Key factor: {top_reason}"
    
    if reasons:
        return f"Alert triggered based on AML detection rules: {reasons[0]}"

    return f"Elevated machine learning risk score ({risk_score}%) exceeding operational monitoring threshold."


# ── Counterfactual Explanations Engine ─────────────────────────────────────────

def generate_counterfactuals(
    tx_dict: Dict[str, Any],
    sender_history: List[Dict[str, Any]] = None,
    receiver_history: List[Dict[str, Any]] = None,
    target_threshold: float = 0.50
) -> Dict[str, Any]:
    """
    Computes actionable counterfactual explanations by finding minimal parameter shifts
    that successfully lower the model risk score below the decision threshold.
    """
    global champion_bundle
    if champion_bundle is None or champion_bundle.get('model') is None:
        load_resources()

    if champion_bundle is None or champion_bundle.get('model') is None:
        return {'is_achievable': False, 'error': 'Champion model unavailable'}

    champ_model = champion_bundle['model']
    champ_scaler = champion_bundle['scaler']
    f_cols = champion_bundle.get('feature_cols', FEATURE_COLS)
    champ_name = champion_bundle.get('metadata', {}).get('model_name', '')

    def _score_tx(tx_candidate):
        feat_d = compute_features_single(tx_candidate, sender_history or [], receiver_history or [])
        df_row = pd.DataFrame([{k: v for k, v in feat_d.items() if not k.startswith('_')}])[f_cols]
        inputs = champ_scaler.transform(df_row) if champ_name == 'Logistic Regression' else df_row.values
        prob_val = float(champ_model.predict_proba(inputs)[0][1])
        return int(prob_val * 100)

    original_score = _score_tx(tx_dict)
    target_score = int(target_threshold * 100)

    if original_score < target_score:
        return {
            'original_score': original_score,
            'target_threshold': target_score,
            'is_achievable': True,
            'message': 'Transaction is already below the alert threshold; no counterfactual modification needed.',
            'counterfactuals': []
        }

    orig_amount = float(tx_dict.get('amount', 100000))
    orig_method = str(tx_dict.get('payment_method', 'Transfer'))
    orig_country = str(tx_dict.get('country', 'IN'))

    recommendations = []

    # 1. Actionable Dimension: Amount Reduction
    amount_steps = [
        orig_amount * 0.75,
        orig_amount * 0.50,
        orig_amount * 0.25,
        180000.0,
        95000.0,
        45000.0
    ]
    for test_amt in amount_steps:
        if test_amt >= orig_amount:
            continue
        c_tx = dict(tx_dict, amount=test_amt)
        s = _score_tx(c_tx)
        if s < target_score:
            drop = original_score - s
            recommendations.append({
                'category': 'Transaction Volume',
                'actionable_feature': 'amount',
                'original_value': f"₹{orig_amount:,.2f}",
                'counterfactual_value': f"≤ ₹{test_amt:,.2f}",
                'predicted_score': s,
                'score_drop': drop,
                'narrative': f"If transaction amount was reduced to ₹{test_amt:,.2f} (currently ₹{orig_amount:,.2f}), the risk score would drop from {original_score}% to {s}% (below {target_score}% alert threshold)."
            })
            break

    # 2. Actionable Dimension: Payment Channel Substitution
    high_risk_methods = ['Crypto Transfer', 'RTGS', 'Cash Deposit', 'Wire Transfer', 'Wire']
    if orig_method in high_risk_methods:
        for benign_method in ['UPI', 'NEFT', 'Direct Deposit']:
            c_tx = dict(tx_dict, payment_method=benign_method)
            s = _score_tx(c_tx)
            if s < target_score or (original_score - s >= 20):
                drop = original_score - s
                recommendations.append({
                    'category': 'Payment Channel',
                    'actionable_feature': 'payment_method',
                    'original_value': orig_method,
                    'counterfactual_value': benign_method,
                    'predicted_score': s,
                    'score_drop': drop,
                    'narrative': f"If payment channel was changed from '{orig_method}' to standard verified clearing ('{benign_method}'), risk score would drop by {drop} pts to {s}%."
                })
                break

    # 3. Actionable Dimension: High-Risk Jurisdiction Shift
    high_risk_countries = get_high_risk_jurisdictions()
    if orig_country in high_risk_countries:
        c_tx = dict(tx_dict, country='IN')
        s = _score_tx(c_tx)
        drop = original_score - s
        recommendations.append({
            'category': 'Jurisdiction',
            'actionable_feature': 'country',
            'original_value': orig_country,
            'counterfactual_value': 'IN (Domestic)',
            'predicted_score': s,
            'score_drop': drop,
            'narrative': f"If destination jurisdiction was domestic ('IN') instead of high-risk ('{orig_country}'), risk score would drop from {original_score}% to {s}%."
        })

    # 4. Actionable Dimension: Combined Minimal Shift
    c_tx_combo = dict(tx_dict, amount=min(orig_amount * 0.4, 150000.0), payment_method='UPI', country='IN')
    s_combo = _score_tx(c_tx_combo)
    if s_combo < target_score:
        drop_combo = original_score - s_combo
        recommendations.append({
            'category': 'Multi-Factor Optimization',
            'actionable_feature': 'amount + channel + country',
            'original_value': f"₹{orig_amount:,.0f} | {orig_method} | {orig_country}",
            'counterfactual_value': f"₹{c_tx_combo['amount']:,.0f} | UPI | IN",
            'predicted_score': s_combo,
            'score_drop': drop_combo,
            'narrative': f"Combined parameter adjustment (Amount ≤ ₹{c_tx_combo['amount']:,.0f}, UPI channel, domestic transfer) achieves clean rating: {s_combo}% risk score."
        })

    # Sort recommendations by highest score drop
    recommendations.sort(key=lambda r: r['score_drop'], reverse=True)

    return {
        'original_score': original_score,
        'target_threshold': target_score,
        'is_achievable': len(recommendations) > 0,
        'counterfactuals': recommendations
    }


# ── Prediction & Parallel Shadow Scoring ───────────────────────────────────────

@app.route('/predict', methods=['POST'])
def predict():
    global champion_bundle, challenger_bundle, shadow_mode_enabled

    if champion_bundle is None or champion_bundle.get('model') is None:
        load_resources()

    if champion_bundle is None or champion_bundle.get('model') is None:
        return jsonify({
            'success': False,
            'error': 'No champion model active in registry. Please run /train first.'
        }), 400

    try:
        data             = request.get_json() or {}
        tx               = data.get('transaction') if ('transaction' in data and isinstance(data['transaction'], dict)) else data
        sender_history   = data.get('sender_history', [])
        receiver_history = data.get('receiver_history', [])

        features_dict = compute_features_single(tx, sender_history, receiver_history)
        features_dict['_country']        = tx.get('country', '')
        features_dict['_payment_method'] = tx.get('payment_method', '')
        features_dict['_hour']           = pd.to_datetime(
            tx.get('timestamp', datetime.now().isoformat())
        ).hour

        f_cols = champion_bundle.get('feature_cols', FEATURE_COLS)
        features_df = pd.DataFrame([
            {k: v for k, v in features_dict.items() if not k.startswith('_')}
        ])[f_cols]

        # ── 1. Champion Model Scoring ─────────────────────────────────────────
        champ_model = champion_bundle['model']
        champ_scaler = champion_bundle['scaler']
        champ_name = champion_bundle.get('metadata', {}).get('model_name', '')
        features_input = (champ_scaler.transform(features_df)
                          if champ_name == 'Logistic Regression'
                          else features_df.values)

        prob = float(champ_model.predict_proba(features_input)[0][1])
        optimal_threshold = float(champion_bundle.get('metadata', {}).get('optimal_threshold', 0.5))
        prediction = 1 if prob >= optimal_threshold else 0
        risk_score = int(prob * 100)

        # ── 2. Real SHAP Explanation (No Heuristic Fake Values) ───────────────
        shap_explanations = None
        explanation_type = "rule-based"
        try:
            if shap_tree_explainer is not None:
                shap_vals = shap_tree_explainer.shap_values(features_df)
                if isinstance(shap_vals, list):
                    shap_vals = shap_vals[1]
                elif isinstance(shap_vals, np.ndarray) and shap_vals.ndim == 3:
                    shap_vals = shap_vals[:, :, 1]
                raw_shap = shap_vals[0]
                explanation_type = "shap"
            elif shap_kernel_explainer is not None:
                shap_vals = shap_kernel_explainer(features_df).values[:, :, 1]
                raw_shap  = shap_vals[0]
                explanation_type = "shap"
            else:
                raw_shap = None

            if raw_shap is not None:
                shap_explanations = []
                for col, val in zip(f_cols, raw_shap):
                    shap_explanations.append({
                        'feature':      col,
                        'shap_value':   float(val),
                        'actual_value': float(features_dict.get(col, 0))
                    })
        except Exception as shap_err:
            print(f"[SHAP Computation Notice]: Real SHAP unavailable ({shap_err}). Flagging as rule-based.")
            shap_explanations = None
            explanation_type = "rule-based"

        # ── 3. Correlated Group Attribution & Dynamic Config Reasons ───────────
        grouped_attributions = group_feature_attributions(shap_explanations) if shap_explanations else []
        reasons = _build_rich_reasons(shap_explanations, features_dict, risk_score)
        why_alert_summary = _generate_why_alert_summary(reasons, grouped_attributions, risk_score)

        response_payload = {
            'success':              True,
            'prediction':           prediction,
            'risk_score':           risk_score,
            'model_version':        champion_bundle.get('version_id', 'v_champion'),
            'explanation_type':     explanation_type,
            'features':             {k: v for k, v in features_dict.items() if not k.startswith('_')},
            'shap_explanations':    shap_explanations,
            'grouped_attributions': grouped_attributions,
            'why_alert_summary':    why_alert_summary,
            'reasons':              reasons
        }

        # ── 4. Parallel Shadow Mode Scoring (Challenger Model) ─────────────────
        if shadow_mode_enabled and challenger_bundle and challenger_bundle.get('model') is not None:
            try:
                chal_model = challenger_bundle['model']
                chal_scaler = challenger_bundle['scaler']
                chal_cols = challenger_bundle.get('feature_cols', f_cols)
                chal_features_df = pd.DataFrame([
                    {k: v for k, v in features_dict.items() if not k.startswith('_')}
                ])[chal_cols]

                chal_inputs = (chal_scaler.transform(chal_features_df)
                               if challenger_bundle.get('metadata', {}).get('model_name') == 'Logistic Regression'
                               else chal_features_df.values)

                chal_prob = float(chal_model.predict_proba(chal_inputs)[0][1])
                chal_thresh = float(challenger_bundle.get('metadata', {}).get('optimal_threshold', 0.5))
                shadow_risk_score = int(chal_prob * 100)
                shadow_prediction = 1 if chal_prob >= chal_thresh else 0

                response_payload['shadow_prediction'] = {
                    'shadow_risk_score': shadow_risk_score,
                    'shadow_is_laundering': shadow_prediction,
                    'shadow_model_version': challenger_bundle.get('version_id', 'v_challenger'),
                    'score_delta': shadow_risk_score - risk_score
                }
            except Exception as chal_err:
                print(f"[Shadow Mode Scoring Error]: {chal_err}")

        return jsonify(response_payload)

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/predict/counterfactual', methods=['POST'])
def counterfactual_endpoint():
    """
    Computes actionable counterfactual recommendations for a transaction.
    """
    try:
        data = request.get_json() or {}
        tx = data.get('transaction') if ('transaction' in data and isinstance(data['transaction'], dict)) else data
        sender_history = data.get('sender_history', [])
        receiver_history = data.get('receiver_history', [])
        threshold = float(data.get('threshold', 0.50))

        cf_results = generate_counterfactuals(tx, sender_history, receiver_history, threshold)
        return jsonify({'success': True, 'data': cf_results})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500



@app.route('/batch-predict', methods=['POST'])

def batch_predict():
    """
    Vectorized batch prediction endpoint with champion scoring and parallel challenger shadow scoring.
    """
    global champion_bundle, challenger_bundle, shadow_mode_enabled
    if champion_bundle is None or champion_bundle.get('model') is None:
        load_resources()

    if champion_bundle is None or champion_bundle.get('model') is None:
        return jsonify({'success': False, 'error': 'No model active in registry.'}), 400

    try:
        data         = request.get_json() or {}
        transactions = data.get('transactions', [])

        if not transactions:
            return jsonify({'success': True, 'results': []})

        batch_df = pd.DataFrame(transactions)
        prior_history = data.get('history') or data.get('prior_history')
        features_full_df = compute_features_batch(batch_df, history=prior_history)

        f_cols = champion_bundle.get('feature_cols', FEATURE_COLS)
        features_df = features_full_df[f_cols]

        champ_model = champion_bundle['model']
        champ_scaler = champion_bundle['scaler']
        champ_name = champion_bundle.get('metadata', {}).get('model_name', '')
        features_input = (champ_scaler.transform(features_df)
                          if champ_name == 'Logistic Regression'
                          else features_df.values)

        probs = champ_model.predict_proba(features_input)[:, 1]
        optimal_threshold = float(champion_bundle.get('metadata', {}).get('optimal_threshold', 0.5))
        predictions = (probs >= optimal_threshold).astype(int)

        # Shadow mode batch scoring
        shadow_probs = None
        if shadow_mode_enabled and challenger_bundle and challenger_bundle.get('model') is not None:
            try:
                chal_model = challenger_bundle['model']
                chal_scaler = challenger_bundle['scaler']
                chal_cols = challenger_bundle.get('feature_cols', f_cols)
                chal_features_df = features_full_df[chal_cols]
                chal_input = (chal_scaler.transform(chal_features_df)
                              if challenger_bundle.get('metadata', {}).get('model_name') == 'Logistic Regression'
                              else chal_features_df.values)
                shadow_probs = chal_model.predict_proba(chal_input)[:, 1]
            except Exception as s_err:
                print(f"[Batch Shadow Scoring Error]: {s_err}")

        # Batch SHAP
        all_shap = None
        try:
            if shap_tree_explainer is not None:
                sv = shap_tree_explainer.shap_values(features_df)
                if isinstance(sv, list):
                    all_shap = sv[1]
                elif isinstance(sv, np.ndarray) and sv.ndim == 3:
                    all_shap = sv[:, :, 1]
                else:
                    all_shap = sv
        except Exception:
            all_shap = None

        results = []
        for i, tx in enumerate(transactions):
            risk_score = int(float(probs[i]) * 100)
            prediction = int(predictions[i])
            fd = features_full_df.iloc[i].to_dict()
            fd['_country']        = tx.get('country', '')
            fd['_payment_method'] = tx.get('payment_method', '')
            fd['_hour']           = pd.to_datetime(
                tx.get('timestamp', datetime.now().isoformat())
            ).hour

            shap_explanations = []
            if all_shap is not None:
                for col, val in zip(f_cols, all_shap[i]):
                    shap_explanations.append({
                        'feature':      col,
                        'shap_value':   float(val),
                        'actual_value': float(fd.get(col, 0))
                    })
            else:
                importances = (
                    champ_model.feature_importances_ if hasattr(champ_model, 'feature_importances_')
                    else np.abs(champ_model.coef_[0]) if hasattr(champ_model, 'coef_')
                    else [0.1] * len(f_cols)
                )
                for idx, col in enumerate(f_cols):
                    actual = float(fd.get(col, 0))
                    val = importances[idx] * (
                        2.5 if col == 'in_cycle' and actual > 0
                        else (2.0 if col == 'shared_device_degree' and actual > 0
                        else (1.8 if col == 'pass_through_ratio' and actual >= 0.7
                        else (1.5 if col in ('in_degree', 'out_degree', 'distinct_counterparties') and actual >= 3
                        else (2.0 if col in ('sender_time_diff', 'receiver_time_diff') and actual < 30
                        else (1.0 if actual > 0 and col not in ('sender_time_diff', 'receiver_time_diff')
                        else -0.05))))))
                    shap_explanations.append({
                        'feature':      col,
                        'shap_value':   float(val),
                        'actual_value': actual
                    })

            reasons = _build_rich_reasons(shap_explanations, fd, risk_score)

            row_res = {
                'transaction_id':    tx.get('transaction_id', ''),
                'risk_score':        risk_score,
                'is_laundering':     prediction,
                'model_version':     champion_bundle.get('version_id', 'v_champion'),
                'reasons':           reasons,
                'shap_explanations': shap_explanations
            }

            if shadow_probs is not None:
                s_score = int(float(shadow_probs[i]) * 100)
                row_res['shadow_prediction'] = {
                    'shadow_risk_score': s_score,
                    'shadow_is_laundering': 1 if s_score >= 50 else 0,
                    'shadow_model_version': challenger_bundle.get('version_id', 'v_challenger'),
                    'score_delta': s_score - risk_score
                }

            results.append(row_res)

        return jsonify({'success': True, 'results': results, 'model_version': champion_bundle.get('version_id', 'v_champion')})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/graph-analysis', methods=['POST'])
@app.route('/graph', methods=['POST'])
def graph_analysis():
    try:
        from graph_module import analyze_transaction_graph
        data              = request.get_json() or {}
        transactions_list = data.get('transactions', [])
        analysis_result   = analyze_transaction_graph(transactions_list)
        return jsonify({'success': True, 'data': analysis_result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500



if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
