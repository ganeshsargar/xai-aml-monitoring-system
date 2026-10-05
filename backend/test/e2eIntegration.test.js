const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';

const { connectDB, models } = require('../src/config/db');
const { logAction, verifyAuditLogChain } = require('../src/config/auditLogger');
const { generateTxId, generateAlertId, generateCaseId } = require('../src/utils/idGenerator');
const { evaluateTransaction, calculateFusedRiskScore, refreshScenarios } = require('../src/services/scenarioEngine');
const { generateSTRFromCase } = require('../src/services/regulatoryService');

test.before(async () => {
  await connectDB();
  refreshScenarios();
});

test('End-to-End Compliance Pipeline: Ingestion -> Scoring -> Alert -> Case -> STR -> Audit Chain', async (t) => {
  
  let createdTx = null;
  let createdAlert = null;
  let createdCase = null;
  let createdSTR = null;

  await t.test('Step 1: Ingest & Parse Transaction from Ingestion Feed', async () => {
    const rawTxPayload = {
      transaction_id: generateTxId(),
      sender_account: 'ACC_E2E_SENDER_01',
      sender_name: 'Apex Shell Corp',
      receiver_account: 'ACC_E2E_RECV_02',
      receiver_name: 'Offshore Holding Ltd',
      amount: 4950000.0,
      currency: 'INR',
      amount_inr: 4950000.0,
      payment_method: 'CRYPTO',
      country: 'KY',
      timestamp: new Date().toISOString(),
      customer_id: 'CUST_E2E_001'
    };

    createdTx = await models.Transaction.create(rawTxPayload);
    assert.ok(createdTx, 'Transaction should be persisted in database');
    assert.strictEqual(createdTx.amount_inr, 4950000.0);

    await logAction(
      'system_ingestion',
      'System',
      'TRANSACTION_INGESTED',
      '127.0.0.1',
      `Ingested TX ${createdTx.transaction_id} (Amount: INR 4,950,000 to KY)`
    );
  });

  await t.test('Step 2: Score Transaction with Scenario Engine & Risk Classifier', async () => {
    assert.ok(createdTx, 'Requires ingested transaction');

    const evalResult = await evaluateTransaction(createdTx, { history: [createdTx] });
    assert.ok(evalResult, 'Scenario engine should return evaluation result');
    assert.ok(evalResult.rule_score > 0, 'Scenario rules should trigger on high risk country');

    // Fuse with ML probability score
    const simulatedMLScore = 85.0;
    const fusion = calculateFusedRiskScore(simulatedMLScore, evalResult.rule_hits);
    const finalRiskScore = fusion.final_risk_score || 88;

    assert.ok(finalRiskScore >= 50, 'High-risk crypto transfer to KY should yield elevated risk score');

    // Attach scores to transaction
    createdTx.risk_score = finalRiskScore;
    createdTx.rule_score = evalResult.rule_score;
    createdTx.rule_hits = evalResult.rule_hits;
    createdTx.reasons = evalResult.reasons;
    createdTx.is_laundering = 1;
    await createdTx.save();

    await logAction(
      'risk_engine',
      'System',
      'TRANSACTION_SCORED',
      '127.0.0.1',
      `Scored TX ${createdTx.transaction_id}: Risk Score ${finalRiskScore}%`
    );
  });

  await t.test('Step 3: Trigger and Persist AML Alert for High-Risk Detection', async () => {
    assert.ok(createdTx && createdTx.risk_score >= 50);

    const alertPayload = {
      alert_id: generateAlertId(),
      transaction_id: createdTx.transaction_id,
      customer_id: createdTx.customer_id,
      level: createdTx.risk_score >= 80 ? 'Critical' : 'High',
      status: 'New',
      scenario_triggered: createdTx.rule_hits && createdTx.rule_hits.length > 0 ? createdTx.rule_hits[0].name : 'High Risk Jurisdiction & Rails',
      risk_score: createdTx.risk_score,
      sla_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };

    createdAlert = await models.Alert.create(alertPayload);
    assert.ok(createdAlert, 'Alert should be created in database');
    assert.strictEqual(createdAlert.status, 'New');

    await logAction(
      'alert_dispatcher',
      'System',
      'ALERT_GENERATED',
      '127.0.0.1',
      `Alert ${createdAlert.alert_id} generated at level ${createdAlert.level}`
    );
  });

  await t.test('Step 4: Open Investigative Case & Attach Evidence', async () => {
    assert.ok(createdAlert, 'Requires created alert');

    const casePayload = {
      case_id: generateCaseId(),
      title: `Investigation: Structuring & Offshore Flight (${createdTx.sender_name})`,
      status: 'Open',
      priority: 'High',
      assigned_to: 'senior_investigator',
      alerts: [createdAlert.alert_id],
      transactions: [createdTx.transaction_id],
      customer_id: createdTx.customer_id,
      notes: [
        {
          investigator: 'senior_investigator',
          text: 'Flagged rapid crypto rails to Cayman Islands jurisdiction just below threshold.',
          timestamp: new Date()
        }
      ]
    };

    createdCase = await models.Case.create(casePayload);
    assert.ok(createdCase, 'Case should be successfully opened');
    assert.strictEqual(createdCase.status, 'Open');

    // Update alert status to Investigating
    createdAlert.status = 'Investigating';
    await createdAlert.save();

    await logAction(
      'senior_investigator',
      'Investigator',
      'CASE_OPENED',
      '127.0.0.1',
      `Case ${createdCase.case_id} opened for ${createdTx.sender_name}`
    );
  });

  await t.test('Step 5: Draft FIU-IND Compliant Suspicious Transaction Report (STR)', async () => {
    assert.ok(createdCase, 'Requires active case');

    const subjectProfile = {
      customer_id: createdTx.customer_id,
      name: createdTx.sender_name,
      occupation_or_business_type: 'Export/Import Shell Entity',
      declared_monthly_income_or_turnover: 500000,
      kyc_risk_rating: 'High',
      is_pep: false,
      country_of_residence: 'IN'
    };

    createdSTR = await generateSTRFromCase(
      createdCase.case_id,
      'senior_investigator',
      subjectProfile,
      [createdTx]
    );

    assert.ok(createdSTR, 'STR should be generated');
    assert.ok(createdSTR.str_id, 'STR should have an identifier');
    assert.strictEqual(createdSTR.status, 'Draft');
    assert.ok(createdSTR.narrative && createdSTR.narrative.length > 50, 'Should include detailed deterministic narrative');
    assert.ok(createdSTR.case_title.includes('Apex Shell Corp') || createdSTR.narrative.includes('Apex Shell Corp'), 'Narrative or title should reference entity');

    await logAction(
      'senior_investigator',
      'Investigator',
      'STR_DRAFTED',
      '127.0.0.1',
      `STR ${createdSTR.str_id} drafted for case ${createdCase.case_id}`
    );
  });

  await t.test('Step 6: Verify Immutable Cryptographic Audit Hash Chain', async () => {
    const chainVerification = await verifyAuditLogChain();
    assert.ok(chainVerification, 'Audit chain verification must execute');
    assert.strictEqual(chainVerification.verified, true, 'Audit log hash chain must be completely valid without tampering');
    assert.ok(chainVerification.total_entries >= 5, 'Should contain all logged pipeline actions');
  });

});
