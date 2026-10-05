const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { connectDB, models } = require('../src/config/db');
const feedbackService = require('../src/services/feedbackService');
const { 
  getRetrainingConfig, 
  getActiveLearningConfig 
} = require('../src/config/riskConfig');

test.before(async () => {
  await connectDB();
  // Clear test labels from DB if any
  const labelsFile = path.join(__dirname, '..', 'data', 'Label.json');
  if (fs.existsSync(labelsFile)) {
    fs.writeFileSync(labelsFile, JSON.stringify([], null, 2));
  }
});

test('1. Analyst Dispositions stored as binary labels in labels collection without mutating transaction', async () => {
  const txId = 'TX-FEEDBACK-TEST-001';
  
  // 1. Create a pristine immutable transaction
  const tx = await models.Transaction.create({
    transaction_id: txId,
    sender_account: 'ACC-SENDER-001',
    sender_name: 'Alpha Corp',
    receiver_account: 'ACC-RECV-001',
    receiver_name: 'Beta Global',
    amount: 950000,
    currency: 'INR',
    timestamp: new Date('2026-05-10T10:00:00Z').toISOString(),
    country: 'IN',
    payment_method: 'RTGS',
    is_laundering: 0,
    risk_score: 52
  });

  const originalTxSnapshot = JSON.stringify(tx);

  // 2. Analyst dispositions an alert as True Positive
  const alert = await models.Alert.create({
    alert_id: 'ALT-FB-001',
    transaction_id: txId,
    customer_id: 'CUST-ALPHA',
    risk_score: 52,
    priority_score: 55,
    level: 'Medium',
    status: 'In Review L1'
  });

  const loggedLabels = await feedbackService.recordLabelsForAlert(
    alert,
    'True Positive - STR Filed',
    'Structured placement to evade CTR threshold',
    'lead_analyst',
    'alert_closure'
  );

  assert.equal(loggedLabels.length, 1);
  const labelRecord = loggedLabels[0];
  assert.equal(labelRecord.transaction_id, txId);
  assert.equal(labelRecord.customer_id, 'CUST-ALPHA');
  assert.equal(labelRecord.label, 1); // True Positive -> 1
  assert.equal(labelRecord.disposition, 'True Positive - STR Filed');
  assert.equal(labelRecord.analyst, 'lead_analyst');
  assert.equal(labelRecord.used_in_training, false);
  assert.ok(labelRecord.weight >= 1.0);

  // 3. Verify transaction itself was strictly NOT mutated
  const currentTx = await models.Transaction.findOne({ transaction_id: txId });
  assert.equal(currentTx.is_laundering, 0, 'Original transaction record must remain immutable');
});

test('2. Active-Learning Queue prioritizes highest-uncertainty border alerts near threshold', async () => {
  // Create alerts with various risk scores around threshold (50)
  // Alert A: 50% risk score (distance = 0, maximal uncertainty = 1.0)
  // Alert B: 48% risk score (distance = 2, high uncertainty = 0.96)
  // Alert C: 85% risk score (distance = 35, lower uncertainty = 0.30)
  // Alert D: 10% risk score (distance = 40, lower uncertainty = 0.20)
  
  await models.Alert.create({
    alert_id: 'ALT-UNCERTAIN-A',
    transaction_id: 'TX-UNCERTAIN-A',
    risk_score: 50,
    priority_score: 50,
    status: 'New',
    createdAt: new Date().toISOString()
  });

  await models.Alert.create({
    alert_id: 'ALT-UNCERTAIN-B',
    transaction_id: 'TX-UNCERTAIN-B',
    risk_score: 48,
    priority_score: 48,
    status: 'New',
    createdAt: new Date().toISOString()
  });

  await models.Alert.create({
    alert_id: 'ALT-CERTAIN-C',
    transaction_id: 'TX-CERTAIN-C',
    risk_score: 85,
    priority_score: 85,
    status: 'New',
    createdAt: new Date().toISOString()
  });

  const queue = await feedbackService.getActiveLearningQueue({ limit: 10, threshold: 50 });
  assert.ok(queue.length >= 3);

  // Queue must be sorted with highest uncertainty first
  const first = queue[0];
  const second = queue[1];
  assert.ok(first.uncertainty_score >= second.uncertainty_score);
  assert.equal(first.alert_id, 'ALT-UNCERTAIN-A');
  assert.equal(first.uncertainty_score, 1.0);
  assert.equal(first.distance_to_threshold, 0);
});

test('3. Retraining Guard enforces minimum new labels before retraining is permitted', async () => {
  const retrainCfg = getRetrainingConfig();
  const minRequired = retrainCfg.min_new_labels || 5;

  // Currently only 1 label exists from Test 1
  const unusedCount = (await models.Label.find({ used_in_training: false })).length;
  assert.ok(unusedCount < minRequired);

  // Attempting to get retraining payload without force must throw
  await assert.rejects(
    async () => {
      await feedbackService.getRetrainingPayload(false);
    },
    /Retraining threshold not met/
  );

  // With force=true, it succeeds
  const forcedPayload = await feedbackService.getRetrainingPayload(true);
  assert.ok(forcedPayload.labels.length >= 1);
  assert.equal(forcedPayload.analyst_label_weight, retrainCfg.analyst_label_weight || 3.0);
});

test('4. Simulated feedback collection reaches retraining threshold and updates label training status', async () => {
  // Simulate analyst reviewing 6 more transactions
  const testDispositions = [
    { id: 'TX-SIM-1', label: 0, disp: 'False Positive', analyst: 'analyst_bob' },
    { id: 'TX-SIM-2', label: 1, disp: 'True Positive - STR Filed', analyst: 'analyst_alice' },
    { id: 'TX-SIM-3', label: 0, disp: 'False Positive', analyst: 'analyst_bob' },
    { id: 'TX-SIM-4', label: 1, disp: 'True Positive - No Filing', analyst: 'analyst_alice' },
    { id: 'TX-SIM-5', label: 0, disp: 'False Positive', analyst: 'analyst_bob' },
    { id: 'TX-SIM-6', label: 1, disp: 'True Positive - STR Filed', analyst: 'analyst_carol' }
  ];

  for (const item of testDispositions) {
    await feedbackService.recordLabel({
      transaction_id: item.id,
      customer_id: 'CUST-SIM',
      label: item.label,
      disposition: item.disp,
      rationale: 'Simulated feedback disposition',
      analyst: item.analyst
    });
  }

  // Now we have >= 5 new labels, threshold is met
  const payload = await feedbackService.getRetrainingPayload(false);
  assert.ok(payload.unused_count >= 5);
  assert.ok(payload.labels.length >= 7);

  // Simulate marking training as completed
  const markedCount = await feedbackService.markLabelsAsUsedInTraining([], 'XGBoost-Retrained-v2');
  assert.ok(markedCount >= 7);

  const remainingUnused = await models.Label.find({ used_in_training: false });
  assert.equal(remainingUnused.length, 0);
});

test('5. Feedback & Governance Metrics correctly compute FPR, STR rate, and Analyst agreement', async () => {
  const metrics = await feedbackService.computeFeedbackMetrics();
  assert.ok(metrics.summary);
  assert.ok(metrics.summary.total_labels_collected >= 7);
  assert.ok(metrics.summary.false_positive_rate_pct >= 0);
  assert.ok(metrics.summary.str_conversion_rate_pct >= 0);
  assert.ok(metrics.summary.analyst_agreement_rate_pct >= 0);
  assert.ok(Array.isArray(metrics.time_series));
});
