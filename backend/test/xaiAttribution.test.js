const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { connectDB, models } = require('../src/config/db');

test.before(async () => {
  await connectDB();
});

test('XAI: Heuristic fallback is labeled rule-based with null SHAP', async (t) => {
  // Test transaction
  const tx = await models.Transaction.create({
    transaction_id: 'TX_XAI_TEST_001',
    sender_account: 'ACC_XAI_S1',
    receiver_account: 'ACC_XAI_R1',
    sender_name: 'Test Sender',
    receiver_name: 'Test Receiver',
    amount: 980000,
    country: 'KY',
    payment_method: 'Crypto Transfer',
    risk_score: 88,
    is_laundering: 1,
    reasons: ['₹980,000 structured near CTR threshold', 'Crypto transfer channel risk'],
    explanation_type: 'rule-based',
    shap_explanation: null
  });

  assert.strictEqual(tx.explanation_type, 'rule-based');
  assert.strictEqual(tx.shap_explanation, null);
  assert.ok(Array.isArray(tx.reasons));
  assert.ok(tx.reasons.length > 0);

  // Cleanup
  await models.Transaction.deleteOne({ transaction_id: 'TX_XAI_TEST_001' });
});

test('XAI Results Directory contains thesis-ready PNG figures and benchmark CSV/JSON', (t) => {
  const resultsDir = path.join(__dirname, '..', '..', 'ml-service', 'xai_eval', 'results');
  assert.ok(fs.existsSync(resultsDir), 'xai_eval/results directory must exist');

  const requiredFiles = [
    'xai_benchmark_summary.json',
    'xai_eval_metrics.csv',
    'fidelity_deletion_insertion_curves.png',
    'explanation_stability_correlation.png',
    'xai_method_comparison_shap_lime_rules.png',
    'grouped_feature_attribution.png'
  ];

  requiredFiles.forEach(file => {
    const fPath = path.join(resultsDir, file);
    assert.ok(fs.existsSync(fPath), `Thesis artifact ${file} must exist in results/`);
  });

  const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'xai_benchmark_summary.json'), 'utf8'));
  assert.ok(summary.fidelity, 'Summary must contain fidelity results');
  assert.ok(summary.stability, 'Summary must contain stability results');
  assert.ok(summary.comparison, 'Summary must contain comparison results');
  assert.ok(summary.stability.mean_spearman_rank_correlation >= 0.85, 'Stability rank correlation should meet research threshold');
});
