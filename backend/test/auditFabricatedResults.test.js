const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getModelDrift } = require('../src/controllers/adminController');

test('Audit: adminController.js contains no simulated benchmark drift constants', (t) => {
  const adminControllerPath = path.join(__dirname, '..', 'src', 'controllers', 'adminController.js');
  const content = fs.readFileSync(adminControllerPath, 'utf8');

  // Hardcoded constants that were previously part of the simulated benchmark fallback
  const forbiddenConstants = [
    '0.042',        // simulated overall_score_psi
    '0.112',        // simulated amount psi
    '148500.20',    // simulated baseline_mean
    '182300.50',    // simulated live_mean
    '0.082',        // simulated sender_velocity_2h psi
    '48.5',         // simulated KY flagged_rate_pct
    '68.9',         // simulated KY mean_risk_score
    '55.6',         // simulated PA flagged_rate_pct
    '145000000',    // simulated IN volume
    '177500000'     // simulated CTR volume
  ];

  forbiddenConstants.forEach(c => {
    assert.ok(
      !content.includes(c),
      `adminController.js must not contain simulated fallback constant: ${c}`
    );
  });
});

test('Audit: MLOps.jsx contains no simulated benchmark drift/segment constants', (t) => {
  const mlopsPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'MLOps.jsx');
  const content = fs.readFileSync(mlopsPath, 'utf8');

  const forbiddenConstants = [
    '0.112',
    '148500.20',
    '182300.50',
    '48.5',
    '68.9',
    '55.6'
  ];

  forbiddenConstants.forEach(c => {
    assert.ok(
      !content.includes(c),
      `MLOps.jsx must not contain simulated fallback constant: ${c}`
    );
  });

  // Verify that "Drift data unavailable" text is rendered when ML service is unreachable
  assert.ok(
    content.includes('Drift data unavailable'),
    'MLOps.jsx must display "Drift data unavailable" when ML service is unreachable'
  );
});

test('Audit: getModelDrift returns success:false and "Drift data unavailable" when ML service is unreachable', async (t) => {
  const req = {
    query: { days: 30 },
    ip: '127.0.0.1'
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  // With default ML_SERVICE_URL pointing to non-running or invalid endpoint during test,
  // getModelDrift must catch error and return success: false with 'Drift data unavailable'
  await getModelDrift(req, res);

  assert.strictEqual(statusCode, 503, 'Should respond with 503 status when ML service is unreachable');
  assert.ok(responseData, 'Response data must be defined');
  assert.strictEqual(responseData.success, false, 'success flag must be false');
  assert.strictEqual(responseData.error, 'Drift data unavailable', 'error must be "Drift data unavailable"');
});
