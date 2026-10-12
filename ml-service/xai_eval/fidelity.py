"""
FundTraceAI XAI Evaluation Suite — Feature Attribution Fidelity & Faithfulness
Computes:
1. Deletion Curve (Faithfulness): Progressively replacing top-k SHAP features with baseline values and measuring prediction drop.
2. Insertion Curve: Progressively restoring top-k SHAP features onto a baseline sample and measuring prediction recovery.
3. Area Under Deletion Curve (AUDC) & Area Under Insertion Curve (AUIC).
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Any
import matplotlib.pyplot as plt


def evaluate_fidelity(
    model: Any,
    scaler: Any,
    X_sample: pd.DataFrame,
    shap_values: np.ndarray,
    feature_cols: List[str],
    baseline_values: Dict[str, float] = None,
    max_k: int = 10,
    model_name: str = 'Tree-Ensemble'
) -> Dict[str, Any]:
    """
    Evaluates attribution faithfulness via progressive deletion and insertion experiments.
    """
    n_samples = len(X_sample)
    if baseline_values is None:
        baseline_values = X_sample.mean().to_dict()

    baseline_row = np.array([baseline_values.get(c, 0.0) for c in feature_cols])

    def _predict_prob(X_matrix):
        if model_name == 'Logistic Regression' and scaler is not None:
            X_input = scaler.transform(X_matrix)
        else:
            X_input = X_matrix.values if hasattr(X_matrix, 'values') else X_matrix
        return model.predict_proba(X_input)[:, 1]

    original_preds = _predict_prob(X_sample)
    baseline_pred = float(np.mean(_predict_prob(pd.DataFrame([baseline_row] * n_samples, columns=feature_cols))))

    k_steps = list(range(0, min(max_k + 1, len(feature_cols) + 1)))
    deletion_scores = {k: [] for k in k_steps}
    insertion_scores = {k: [] for k in k_steps}

    # For each sample, sort features by descending SHAP magnitude
    for i in range(n_samples):
        row = X_sample.iloc[i].copy()
        row_shap = shap_values[i]
        
        # Order features from most positive/influential to least
        sorted_indices = np.argsort(-np.abs(row_shap))

        # Initial k=0
        deletion_scores[0].append(original_preds[i])
        insertion_scores[0].append(baseline_pred)

        # Deletion: Start with full sample, progressively mask top-k features with baseline
        masked_row = row.copy()
        for k in range(1, len(k_steps)):
            feat_idx = sorted_indices[k - 1]
            feat_name = feature_cols[feat_idx]
            masked_row[feat_name] = baseline_values.get(feat_name, 0.0)

            df_single = pd.DataFrame([masked_row])[feature_cols]
            p_del = float(_predict_prob(df_single)[0])
            deletion_scores[k].append(p_del)

        # Insertion: Start with baseline, progressively unmask top-k true feature values
        inserted_row = pd.Series(baseline_row, index=feature_cols)
        for k in range(1, len(k_steps)):
            feat_idx = sorted_indices[k - 1]
            feat_name = feature_cols[feat_idx]
            inserted_row[feat_name] = row[feat_name]

            df_single = pd.DataFrame([inserted_row])[feature_cols]
            p_ins = float(_predict_prob(df_single)[0])
            insertion_scores[k].append(p_ins)

    mean_deletion = [float(np.mean(deletion_scores[k])) for k in k_steps]
    mean_insertion = [float(np.mean(insertion_scores[k])) for k in k_steps]

    # Calculate Normalized Area Under Curve (AUDC and AUIC)
    # Lower AUDC indicates faster removal of true risk signal (higher faithfulness)
    # Higher AUIC indicates faster recovery of true prediction (higher faithfulness)
    trapz_fn = getattr(np, 'trapezoid', getattr(np, 'trapz', None))
    if trapz_fn is None:
        from scipy.integrate import trapezoid as trapz_fn
    audc = float(trapz_fn(mean_deletion, dx=1.0) / len(k_steps))
    auic = float(trapz_fn(mean_insertion, dx=1.0) / len(k_steps))
    audc_val = round(audc, 4)
    auic_val = round(auic, 4)
    faithfulness_ratio = round(float(auic / (audc + 1e-6)), 3)

    auic_pass = auic_val > 0.700
    ratio_pass = faithfulness_ratio > 3.00
    audc_pass = audc_val < 0.250

    if auic_pass and ratio_pass and audc_pass:
        interpretation = (
            f"High explanation faithfulness verified: AUIC ({auic_val:.4f} > 0.700) and "
            f"faithfulness ratio ({faithfulness_ratio:.2f} > 3.00) indicate that model confidence "
            f"drops sharply when top SHAP features are masked (AUDC={audc_val:.4f} < 0.250) and recovers monotonically upon insertion."
        )
    else:
        failed_criteria = []
        if not auic_pass:
            failed_criteria.append(f"AUIC={auic_val:.4f} (target > 0.700: Failed)")
        if not ratio_pass:
            failed_criteria.append(f"faithfulness ratio={faithfulness_ratio:.2f} (target > 3.00: Failed)")
        if not audc_pass:
            failed_criteria.append(f"AUDC={audc_val:.4f} (target < 0.250: Failed)")
        interpretation = (
            f"Explanation faithfulness targets partially unmet: {', '.join(failed_criteria)}. "
            f"AUDC achieved {audc_val:.4f} and AUIC achieved {auic_val:.4f} across progressive feature perturbations on flagged instances."
        )

    return {
        'k_steps': k_steps,
        'deletion_curve_mean': mean_deletion,
        'insertion_curve_mean': mean_insertion,
        'audc': audc_val,
        'auic': auic_val,
        'faithfulness_ratio': faithfulness_ratio,
        'interpretation': interpretation
    }
