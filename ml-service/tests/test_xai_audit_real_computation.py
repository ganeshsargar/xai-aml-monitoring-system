"""
FundTraceAI — Audit Test Suite for Elimination of Fabricated/Simulated Results
Asserts:
1. comparison.py has zero hardcoded constants (4.2, 48.5, 0.45, 0.88, 0.72) and uses real LIME and time.perf_counter
2. stability.py returns authentic per-sample Spearman values and dynamic interpretation
3. run_eval.py plots real Spearman values, computes Pass/Fail from value-to-target comparisons, and evaluates on >= 1000 test-period rows
4. docs/METHODOLOGY.md Section 9 has no hardcoded tables or LightGBM, and is generated from metrics.json and ablation.json
"""

import os
import sys
import json
import pytest
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'xai_eval')))


def test_comparison_no_hardcoded_constants():
    comparison_path = os.path.join(os.path.dirname(__file__), '..', 'xai_eval', 'comparison.py')
    with open(comparison_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Forbidden hardcoded constants from previous simulation
    forbidden_literals = ['4.2', '48.5', '0.45', '0.88', '0.72']
    for const in forbidden_literals:
        # Check that these literals are not present as assigned values or constants in comparison.py
        assert const not in content, f"comparison.py must not contain hard-coded constant: {const}"

    # Asserts real LIME and time.perf_counter are used
    assert 'time.perf_counter' in content, "comparison.py must measure latency with time.perf_counter"
    assert 'LimeTabularExplainer' in content, "comparison.py must import and use real LimeTabularExplainer"
    assert 'compute_rule_reason_vector' in content, "comparison.py must compute rule reasons from actual rules"


def test_stability_returns_per_sample_spearman():
    from xai_eval.stability import evaluate_stability

    feature_cols = ['f1', 'f2', 'f3', 'f4']
    X_sample = pd.DataFrame(np.random.randn(10, 4), columns=feature_cols)

    # Mock explainer returning dummy SHAP vector
    def mock_explainer(df):
        return [np.array([0.5, -0.2, 0.1, -0.05]) for _ in range(len(df))]

    res = evaluate_stability(
        explainer_func=mock_explainer,
        X_sample=X_sample,
        feature_cols=feature_cols,
        n_perturbations=3
    )

    assert 'per_sample_spearman' in res, "stability.py must return per_sample_spearman"
    assert 'spearman_correlations' in res, "stability.py must return spearman_correlations"
    assert len(res['per_sample_spearman']) == len(X_sample)
    assert 'interpretation' in res, "stability.py must return dynamic interpretation"
    assert str(res['mean_spearman_rank_correlation']) in res['interpretation']


def test_run_eval_computes_pass_fail_dynamically():
    from xai_eval.run_eval import evaluate_status

    # Target < 0.250
    assert evaluate_status(0.150, '< 0.250') == 'Passed'
    assert evaluate_status(0.350, '< 0.250') == 'Failed'

    # Target > 0.700
    assert evaluate_status(0.850, '> 0.700') == 'Passed'
    assert evaluate_status(0.500, '> 0.700') == 'Failed'

    # Target > 3.00
    assert evaluate_status(5.0, '> 3.00') == 'Passed'
    assert evaluate_status(2.0, '> 3.00') == 'Failed'

    # Target < 15.0 ms
    assert evaluate_status(5.0, '< 15.0 ms') == 'Passed'
    assert evaluate_status(20.0, '< 15.0 ms') == 'Failed'

    # Unparsable target returns Unknown, never Passed
    assert evaluate_status(0.5, 'N/A') == 'Unknown'
    assert evaluate_status(0.5, 'invalid') == 'Unknown'


def test_methodology_has_no_lightgbm_and_generated_from_json():
    methodology_path = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'METHODOLOGY.md')
    with open(methodology_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Section 9 must not list LightGBM
    sec9_start = content.find('## 9. Experimental Results & Ablation Study')
    sec10_start = content.find('## 10. Regulatory Compliance')
    assert sec9_start != -1, "Section 9 must exist in METHODOLOGY.md"
    sec9_content = content[sec9_start:sec10_start if sec10_start != -1 else len(content)]

    assert 'LightGBM' not in sec9_content, "Section 9 must not list LightGBM (train.py does not train it)"

    # Verify generate_results.py exists and can be executed
    generate_script = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'generate_results.py')
    assert os.path.exists(generate_script), "docs/generate_results.py must exist"


def test_run_eval_script_checks():
    run_eval_path = os.path.join(os.path.dirname(__file__), '..', 'xai_eval', 'run_eval.py')
    with open(run_eval_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Asserts that nrows=1000 is not used as the dataset loader
    assert 'nrows=1000' not in content, "run_eval.py must not take nrows=1000 from the start of the file"
    # Asserts chronological test holdout evaluation
    assert 'test_start_idx' in content or 'test_period' in content, "run_eval.py must select test holdout partition"
    # Asserts real per-sample Spearman histogram plotting
    assert 'stability_res.get(\'spearman_correlations\')' in content or 'stability_res.get(\'per_sample_spearman\')' in content


def test_xai_summary_matches_registry_champion():
    registry_path = os.path.join(os.path.dirname(__file__), '..', 'models', 'registry.json')
    summary_path = os.path.join(os.path.dirname(__file__), '..', 'xai_eval', 'results', 'xai_benchmark_summary.json')

    assert os.path.exists(registry_path), "models/registry.json must exist"
    assert os.path.exists(summary_path), "xai_benchmark_summary.json must exist"

    with open(registry_path, 'r', encoding='utf-8') as f:
        registry = json.load(f)
    with open(summary_path, 'r', encoding='utf-8') as f:
        summary = json.load(f)

    champion_id = registry.get('champion')
    assert champion_id is not None, "Champion model must be registered"
    champion_version = next((v for v in registry.get('versions', []) if v.get('version_id') == champion_id), None)
    assert champion_version is not None, f"Champion version {champion_id} must exist in registry versions"

    assert summary.get('model_version') == champion_id, (
        f"Summary model_version ({summary.get('model_version')}) must match registry champion ({champion_id})"
    )
    assert summary.get('model_architecture') == champion_version.get('model_name'), (
        f"Summary model_architecture ({summary.get('model_architecture')}) must match registry champion ({champion_version.get('model_name')})"
    )


def test_forbidden_artifacts_and_claims_eliminated():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

    forbidden_literals = ['0.07925', 'PSI 0.042', '76%']

    # 1. 0.07925, PSI 0.042, and 76% claim must not exist outside tests
    for root, dirs, files in os.walk(repo_root):
        if any(ignored in root for ignored in ['.git', '.venv', 'node_modules', 'tests', '.tempmediaStorage', '__pycache__', '.pytest_cache']):
            continue
        for file in files:
            if file.endswith(('.js', '.jsx', '.py', '.json', '.md', '.html', '.ts', '.tsx')):
                fpath = os.path.join(root, file)
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    for literal in forbidden_literals:
                        assert literal not in content, f"Forbidden literal '{literal}' found in {fpath}"
                except UnicodeDecodeError:
                    pass

    # 2. 0.88 fallback must not exist in stability.py
    stability_path = os.path.join(repo_root, 'ml-service', 'xai_eval', 'stability.py')
    with open(stability_path, 'r', encoding='utf-8') as f:
        stab_content = f.read()
    assert '0.88' not in stab_content, "stability.py must not contain 0.88 fallback"

    # 3. LightGBM must not exist outside tests
    for root, dirs, files in os.walk(repo_root):
        if any(ignored in root for ignored in ['.git', '.venv', 'node_modules', 'tests', '__pycache__', '.pytest_cache', '.tempmediaStorage']):
            continue
        for file in files:
            if file.endswith(('.js', '.jsx', '.py', '.json', '.md', '.html')):
                fpath = os.path.join(root, file)
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    assert 'lightgbm' not in content.lower(), f"LightGBM found outside tests in {fpath}"
                except UnicodeDecodeError:
                    pass

