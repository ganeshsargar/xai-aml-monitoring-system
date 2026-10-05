const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const riskConfig = require('../src/config/riskConfig');
const { app } = require('../server');
const { connectDB, models } = require('../src/config/db');

let server;
let baseUrl;
let adminToken;
let investigatorToken;
let originalConfigFileContent;

const configFilePath = path.resolve(__dirname, '../../config/risk_config.json');

test.before(async () => {
  // Backup config file
  originalConfigFileContent = fs.readFileSync(configFilePath, 'utf8');

  await connectDB();

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api`;
      resolve();
    });
  });

  // Admin login
  const adminRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const adminData = await adminRes.json();
  assert.equal(adminRes.status, 200);
  adminToken = adminData.token;

  // Investigator login
  const invRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'investigator', password: 'investigator123' })
  });
  const invData = await invRes.json();
  assert.equal(invRes.status, 200);
  investigatorToken = invData.token;
});

test.after(async () => {
  // Restore original config
  if (originalConfigFileContent) {
    fs.writeFileSync(configFilePath, originalConfigFileContent, 'utf8');
  }
  if (server) {
    server.close();
  }
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Unit Test: riskConfig manager loads JSON and derives regulatory thresholds', () => {
  const cfg = riskConfig.loadRiskConfig(true);
  assert.ok(cfg, 'Config should load');

  const ctr = riskConfig.getCtrThreshold();
  assert.ok(ctr > 0, 'CTR threshold should be positive');

  const bounds = riskConfig.getStructuringBounds();
  assert.equal(bounds.ctr, ctr);
  assert.ok(bounds.lower < bounds.upper);
  assert.equal(bounds.lower, (ctr * cfg.structuring_band.min_percent) / 100);
  assert.equal(bounds.upper, (ctr * cfg.structuring_band.max_percent) / 100);

  const jurisdictions = riskConfig.getHighRiskJurisdictions();
  assert.ok(typeof jurisdictions === 'object');
  assert.ok(Object.keys(jurisdictions).length > 0);

  // Check alert level calculation
  const cutoffs = riskConfig.getAlertCutoffs();
  assert.equal(riskConfig.getAlertLevel(cutoffs.critical + 5), 'Critical');
  assert.equal(riskConfig.getAlertLevel(cutoffs.high + 5), 'High');
  assert.equal(riskConfig.getAlertLevel(cutoffs.medium + 5), 'Medium');
  assert.equal(riskConfig.getAlertLevel(cutoffs.low + 5), 'Low');
  assert.equal(riskConfig.getAlertLevel(cutoffs.low - 5), null);
});

test('Integration Test: GET /api/admin/risk-config returns current config for admin', async () => {
  const res = await fetch(`${baseUrl}/admin/risk-config`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.data.ctr_threshold);
  assert.ok(data.data.high_risk_jurisdictions);
  assert.ok(data.data.alert_level_cutoffs);
});

test('Integration Test: GET /api/admin/risk-config rejects non-admin users', async () => {
  const res = await fetch(`${baseUrl}/admin/risk-config`, {
    headers: { Authorization: `Bearer ${investigatorToken}` }
  });
  assert.equal(res.status, 403);
});

test('Integration Test: PUT /api/admin/risk-config validates and updates config, audit-logging old & new values', async () => {
  const getRes = await fetch(`${baseUrl}/admin/risk-config`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const { data: currentConfig } = await getRes.json();

  const modifiedConfig = JSON.parse(JSON.stringify(currentConfig));
  modifiedConfig.ctr_threshold = 1200000;
  modifiedConfig.structuring_band.min_percent = 80.0;
  modifiedConfig.structuring_band.max_percent = 99.5;

  const putRes = await fetch(`${baseUrl}/admin/risk-config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(modifiedConfig)
  });

  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.equal(putData.success, true);
  assert.equal(putData.data.ctr_threshold, 1200000);

  // Verify memory cache reloads the updated CTR threshold
  assert.equal(riskConfig.getCtrThreshold(), 1200000);

  // Verify AuditLog record was written with old and new values
  const auditLogs = await models.AuditLog.find({ action: 'RISK_CONFIG_UPDATED' })
    .sort({ timestamp: -1 })
    .limit(1);

  assert.ok(auditLogs.length > 0, 'Audit log entry must be created');
  const latestLog = auditLogs[0];
  assert.equal(latestLog.username, 'admin');
  assert.ok(latestLog.details.includes('old_values'), 'Details must log previous config');
  assert.ok(latestLog.details.includes('new_values'), 'Details must log new config');
  assert.ok(latestLog.details.includes('1200000'), 'Details must record updated CTR');
});

test('Integration Test: PUT /api/admin/risk-config rejects invalid structuring percentages', async () => {
  const badConfig = riskConfig.loadRiskConfig();
  badConfig.structuring_band.min_percent = 95.0;
  badConfig.structuring_band.max_percent = 80.0; // Invalid min >= max

  const putRes = await fetch(`${baseUrl}/admin/risk-config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(badConfig)
  });

  assert.equal(putRes.status, 400);
  const errData = await putRes.json();
  assert.ok(errData.error.includes('Structuring band'));
});

test('Anti-Hardcoding Grep Test: Verify no backend controller has hardcoded structuring or jurisdiction literals', () => {
  const controllersDir = path.resolve(__dirname, '../src/controllers');
  const files = ['transactionController.js', 'uploadController.js', 'caseController.js'];

  for (const filename of files) {
    const content = fs.readFileSync(path.join(controllersDir, filename), 'utf8');

    assert.ok(!content.includes('820000'), `Found hardcoded 820000 in ${filename}`);
    assert.ok(!content.includes('999000'), `Found hardcoded 999000 in ${filename}`);
    assert.ok(!content.includes("['KY', 'PA', 'AE'"), `Found hardcoded country array in ${filename}`);
    assert.ok(!content.includes('FATF grey-listed'), `Found unverified claim in ${filename}`);
  }
});
