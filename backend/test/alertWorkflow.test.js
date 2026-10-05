const test = require('node:test');
const assert = require('node:assert/strict');

const { connectDB, models } = require('../src/config/db');
const { 
  generateAlertId, 
  generateCaseId, 
  calculatePriorityScore, 
  processTransactionAlert 
} = require('../src/services/alertService');

const {
  getAlerts,
  updateAlert,
  dispositionAlert,
  bulkAssignAlerts,
  bulkDismissAlerts
} = require('../src/controllers/alertController');

const {
  getCases,
  getCaseById,
  createCase,
  updateCaseStatus,
  mergeCase
} = require('../src/controllers/caseController');

test.before(async () => {
  await connectDB();
});

function createMockRes() {
  let responseData = null;
  let statusCode = 200;
  return {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { responseData = { statusCode, ...data }; }
      };
    },
    json: (data) => {
      responseData = { statusCode, ...data };
    },
    getData: () => responseData
  };
}

test('Collision-Safe IDs: Generates non-colliding formatted IDs for Alerts and Cases', () => {
  const alertId1 = generateAlertId();
  const alertId2 = generateAlertId();
  const caseId1 = generateCaseId();
  const caseId2 = generateCaseId();

  assert.ok(alertId1.startsWith('ALT-'));
  assert.ok(alertId2.startsWith('ALT-'));
  assert.notEqual(alertId1, alertId2);

  assert.ok(caseId1.startsWith('CAS-'));
  assert.ok(caseId2.startsWith('CAS-'));
  assert.notEqual(caseId1, caseId2);
});

test('Priority Score Calculation: Computes weighted priority score with SLA urgency', () => {
  const score1 = calculatePriorityScore({
    risk_score: 85,
    level: 'Critical',
    transaction_count: 3,
    total_volume: 5000000
  });
  assert.ok(score1 >= 70, `Critical priority score should be high, got ${score1}`);

  const score2 = calculatePriorityScore({
    risk_score: 25,
    level: 'Low',
    transaction_count: 1,
    total_volume: 10000
  });
  assert.ok(score2 <= 40, `Low priority score should be low, got ${score2}`);
});

test('Entity-Level Aggregation: Aggregates multiple transactions of the same customer/account within window', async () => {
  const entityId = 'ACC_AGG_TEST_' + Date.now();
  const tx1 = {
    transaction_id: 'TX_AGG_01_' + Date.now(),
    sender_account: entityId,
    sender_name: 'Test Aggregation Entity',
    amount: 1200000,
    risk_score: 85,
    reasons: ['High value transaction exceeding CTR threshold']
  };

  const alert1 = await processTransactionAlert(tx1);
  assert.ok(alert1);
  assert.ok(alert1.alert_id.startsWith('ALT-'));
  assert.equal(alert1.transaction_count, 1);
  assert.equal(alert1.total_volume, 1200000);

  // Second transaction from same entity
  const tx2 = {
    transaction_id: 'TX_AGG_02_' + Date.now(),
    sender_account: entityId,
    sender_name: 'Test Aggregation Entity',
    amount: 800000,
    risk_score: 75,
    reasons: ['Rapid subsequent outflow']
  };

  const alert2 = await processTransactionAlert(tx2);
  assert.equal(alert2.alert_id, alert1.alert_id, 'Should aggregate into the same parent alert');
  assert.equal(alert2.transaction_count, 2, 'Transaction count should be 2');
  assert.equal(alert2.total_volume, 2000000, 'Total volume should sum to 2,000,000');
  assert.ok(alert2.transaction_ids.includes(tx1.transaction_id));
  assert.ok(alert2.transaction_ids.includes(tx2.transaction_id));

  // Idempotency check: Reprocessing tx1 should not add a duplicate child
  const alert3 = await processTransactionAlert(tx1);
  assert.equal(alert3.alert_id, alert1.alert_id);
  assert.equal(alert3.transaction_count, 2, 'Re-alerting same transaction must be idempotent');
});

test('Four-Eyes Principle: Proposing True Positive requires secondary approval by different user', async () => {
  const alertId = generateAlertId();
  await models.Alert.create({
    alert_id: alertId,
    transaction_id: 'TX_FE_' + Date.now(),
    risk_score: 88,
    level: 'Critical',
    status: 'In Review L1',
    createdAt: new Date().toISOString()
  });

  // 1. First investigator proposes True Positive - STR Filed
  const req1 = {
    params: { id: alertId },
    body: {
      disposition_code: 'True Positive - STR Filed',
      rationale: 'Confirmed smurfing pattern across multiple accounts. Recommending STR filing.',
      action: 'propose'
    },
    user: { username: 'investigator_alice', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const res1 = createMockRes();
  await dispositionAlert(req1, res1);
  const data1 = res1.getData();

  assert.equal(data1.success, true);
  assert.equal(data1.pending_approval, true);
  assert.equal(data1.data.status, 'Escalated L2');
  assert.equal(data1.data.proposed_by, 'investigator_alice');

  // 2. Proposer attempts to approve their own proposal -> Rejected (Four-Eyes Violation)
  const req2 = {
    params: { id: alertId },
    body: {
      disposition_code: 'True Positive - STR Filed',
      rationale: 'Approving my own finding.',
      action: 'approve'
    },
    user: { username: 'investigator_alice', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const res2 = createMockRes();
  await dispositionAlert(req2, res2);
  const data2 = res2.getData();

  assert.equal(data2.statusCode, 403);
  assert.ok(data2.error.includes('Four-eyes principle violation'));

  // 3. Different compliance officer approves proposal -> Success
  const req3 = {
    params: { id: alertId },
    body: {
      disposition_code: 'True Positive - STR Filed',
      rationale: 'Independently verified and concurred with STR recommendation.',
      action: 'approve'
    },
    user: { username: 'compliance_officer_bob', role: 'Admin' },
    ip: '127.0.0.1'
  };
  const res3 = createMockRes();
  await dispositionAlert(req3, res3);
  const data3 = res3.getData();

  assert.equal(data3.success, true);
  assert.equal(data3.data.status, 'Closed');
  assert.equal(data3.data.closed_by, 'compliance_officer_bob');
  assert.equal(data3.data.disposition_code, 'True Positive - STR Filed');
});

test('Bulk Actions: Bulk assign and bulk dismiss with mandatory rationale', async () => {
  const alertIdA = generateAlertId();
  const alertIdB = generateAlertId();

  await models.Alert.create({
    alert_id: alertIdA,
    transaction_id: 'TX_BA_1',
    risk_score: 40,
    level: 'Medium',
    status: 'New',
    createdAt: new Date().toISOString()
  });

  await models.Alert.create({
    alert_id: alertIdB,
    transaction_id: 'TX_BA_2',
    risk_score: 42,
    level: 'Medium',
    status: 'New',
    createdAt: new Date().toISOString()
  });

  // 1. Bulk Assign
  const assignReq = {
    body: {
      alert_ids: [alertIdA, alertIdB],
      assignee: 'lead_analyst'
    },
    user: { username: 'admin', role: 'Admin' },
    ip: '127.0.0.1'
  };
  const assignRes = createMockRes();
  await bulkAssignAlerts(assignReq, assignRes);
  assert.equal(assignRes.getData().success, true);
  assert.equal(assignRes.getData().count, 2);

  // 2. Bulk Dismiss with mandatory rationale
  const dismissReq = {
    body: {
      alert_ids: [alertIdA, alertIdB],
      disposition_code: 'False Positive',
      rationale: 'Verified retail salary credits with supporting documentation.'
    },
    user: { username: 'lead_analyst', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const dismissRes = createMockRes();
  await bulkDismissAlerts(dismissReq, dismissRes);
  assert.equal(dismissRes.getData().success, true);

  const checkA = await models.Alert.findOne({ alert_id: alertIdA });
  assert.equal(checkA.status, 'Closed');
  assert.equal(checkA.disposition_code, 'False Positive');
});

test('Case Lifecycle & Fix Verification: Closing a case does NOT override linked alert statuses', async () => {
  const alertId = generateAlertId();
  await models.Alert.create({
    alert_id: alertId,
    transaction_id: 'TX_CASE_TEST',
    risk_score: 75,
    level: 'High',
    status: 'In Review L1',
    disposition_code: 'False Positive',
    createdAt: new Date().toISOString()
  });

  // Create Case
  const createReq = {
    body: {
      title: 'Investigation Case Lifecycle Test',
      alerts: [alertId]
    },
    user: { username: 'investigator_1', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const createRes = createMockRes();
  await createCase(createReq, createRes);
  const createdCase = createRes.getData().data;
  assert.ok(createdCase.case_id.startsWith('CAS-'));
  assert.equal(createdCase.status, 'Open');

  // Close Case
  const closeReq = {
    params: { id: createdCase.case_id },
    body: {
      status: 'Closed',
      rationale: 'Case completed and archived.'
    },
    user: { username: 'investigator_1', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const closeRes = createMockRes();
  await updateCaseStatus(closeReq, closeRes);
  assert.equal(closeRes.getData().success, true);
  assert.equal(closeRes.getData().data.status, 'Closed');

  // Verify BUG FIX: Linked alert must NOT be forced into "Escalated"
  const linkedAlert = await models.Alert.findOne({ alert_id: alertId });
  assert.notEqual(linkedAlert.status, 'Escalated', 'Closing case must not force alert status to Escalated');
});

test('Case Merging: Merges source case into target case, unions alerts, updates timeline, and closes source', async () => {
  const alert1 = generateAlertId();
  const alert2 = generateAlertId();

  // Create Target Case A
  const reqA = {
    body: { title: 'Primary Syndicate Case A', alerts: [alert1] },
    user: { username: 'investigator_a', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const resA = createMockRes();
  await createCase(reqA, resA);
  const caseA = resA.getData().data;

  // Create Source Case B
  const reqB = {
    body: { title: 'Related Mule Ring Case B', alerts: [alert2] },
    user: { username: 'investigator_b', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const resB = createMockRes();
  await createCase(reqB, resB);
  const caseB = resB.getData().data;

  // Merge Case B into Case A
  const mergeReq = {
    params: { id: caseA.case_id },
    body: {
      source_case_id: caseB.case_id,
      rationale: 'Identified shared IP and pass-through account connecting both clusters.'
    },
    user: { username: 'lead_investigator', role: 'Investigator' },
    ip: '127.0.0.1'
  };
  const mergeRes = createMockRes();
  await mergeCase(mergeReq, mergeRes);
  const mergeData = mergeRes.getData();

  assert.equal(mergeData.success, true);
  assert.ok(mergeData.data.alerts.includes(alert1));
  assert.ok(mergeData.data.alerts.includes(alert2));
  assert.ok(mergeData.data.merged_cases.includes(caseB.case_id));

  // Verify Source Case B is closed and cross-referenced
  const checkB = await models.Case.findOne({ case_id: caseB.case_id });
  assert.equal(checkB.status, 'Closed');
  assert.equal(checkB.merged_into_case_id, caseA.case_id);
});
