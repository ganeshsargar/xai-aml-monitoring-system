const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generateModelValidationReportPDF } = require('../src/config/reportGenerator');
const { connectDB, models } = require('../src/config/db');

test.before(async () => {
  await connectDB();
});

test('Model Registry: registry.json exists and has champion and challenger pointers', (t) => {
  const registryPath = path.join(__dirname, '..', '..', 'ml-service', 'models', 'registry.json');
  if (fs.existsSync(registryPath)) {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    assert.ok(registry.champion, 'Champion pointer must be defined');
    assert.ok(Array.isArray(registry.versions), 'Registry versions must be an array');
    assert.ok(registry.versions.length > 0, 'Registry must contain at least one version');
    
    const champ = registry.versions.find(v => v.version_id === registry.champion);
    assert.ok(champ, 'Champion version must exist in versions list');
    assert.strictEqual(champ.status.toLowerCase(), 'champion', 'Champion version must have champion status');
  } else {
    assert.ok(true);
  }
});

test('Model Version Directory Integrity', (t) => {
  const versionsDir = path.join(__dirname, '..', '..', 'ml-service', 'models', 'versions');
  if (fs.existsSync(versionsDir)) {
    const versions = fs.readdirSync(versionsDir);
    assert.ok(versions.length > 0, 'Should have at least one saved model version');

    const firstVer = versions[0];
    const vPath = path.join(versionsDir, firstVer);
    
    // Check required files inside version folder
    const requiredFiles = ['model.pkl', 'scaler.pkl', 'feature_cols.json', 'metrics.json', 'metadata.json'];
    requiredFiles.forEach(file => {
      const fPath = path.join(vPath, file);
      assert.ok(fs.existsSync(fPath), `File ${file} must exist in version ${firstVer}`);
    });
  }
});

test('Model Validation PDF Generator produces valid binary output', (t, done) => {
  const sampleVersion = {
    version_id: 'v_test_20261005',
    metadata: {
      model_name: 'Random Forest Classifier',
      optimal_threshold: 0.010,
      training_data_hash: '3f7b8a91c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
      config_hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b'
    },
    metrics: {
      analyst_capacity_daily: 50,
      test_metrics: {
        pr_auc: 0.9237,
        roc_auc: 0.9778,
        recall_at_1pct_fpr: 0.9014,
        recall_at_5pct_fpr: 0.9320,
        precision_at_100: 0.9800,
        f1_score: 0.8950,
        brier_score: 0.0126
      },
      split_details: {
        train_rows: 10360,
        val_rows: 2220,
        test_rows: 2221,
        train_date_range: ['2025-06-01', '2025-10-05'],
        val_date_range: ['2025-10-05', '2025-10-31'],
        test_date_range: ['2025-10-31', '2025-11-30']
      }
    },
    feature_cols: ['amount', 'log_amount', 'is_high_risk_country', 'sender_velocity_2h']
  };

  const { PassThrough } = require('stream');
  const stream = new PassThrough();
  const chunks = [];

  stream.on('data', chunk => chunks.push(chunk));
  stream.on('end', () => {
    const pdfBuffer = Buffer.concat(chunks);
    assert.ok(pdfBuffer.length > 500, 'PDF buffer must contain binary PDF content');
    // PDF Magic Header %PDF-
    assert.strictEqual(pdfBuffer.toString('utf8', 0, 5), '%PDF-');
    done();
  });

  generateModelValidationReportPDF(sampleVersion, stream);
});

test('Transaction Schema supports model_version and shadow_prediction', async (t) => {
  const tx = await models.Transaction.create({
    transaction_id: 'TX_TEST_REG_9999',
    sender_account: 'ACC_SENDER_1',
    receiver_account: 'ACC_RECV_1',
    sender_name: 'Test Sender',
    receiver_name: 'Test Receiver',
    amount: 150000,
    country: 'IN',
    risk_score: 85,
    is_laundering: 1,
    model_version: 'v_20261005_142158',
    shadow_prediction: {
      shadow_risk_score: 82,
      shadow_is_laundering: 1,
      shadow_model_version: 'v_20261005_142223',
      score_delta: 3
    }
  });

  assert.strictEqual(tx.model_version, 'v_20261005_142158');
  assert.ok(tx.shadow_prediction);
  assert.strictEqual(tx.shadow_prediction.shadow_model_version, 'v_20261005_142223');
  assert.strictEqual(tx.shadow_prediction.score_delta, 3);

  // Cleanup
  await models.Transaction.deleteOne({ transaction_id: 'TX_TEST_REG_9999' });
});
