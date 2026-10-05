const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { connectDB, models } = require('../src/config/db');
const {
  buildDeterministicSTRNarrative,
  generateSTRFromCase,
  generateCTRReport,
  exportReportXML,
  getStrDueDate,
  getCtrDueDate
} = require('../src/services/regulatoryService');

test('Regulatory Reporting & STR/CTR Workflow Suite', async (t) => {
  await connectDB();

  await t.test('1. Deterministic STR narrative drafting (no LLM)', () => {
    const caseObj = {
      case_id: 'CASE-TEST-001',
      title: 'Pass-through velocity investigation',
      assigned_to: 'analyst_rahul',
      notes: [{ investigator: 'analyst_rahul', text: 'Rapid mule fund dispersion observed.', timestamp: new Date() }]
    };

    const subjectInfo = {
      customer_id: 'CUST-TEST-99',
      name: 'Alpha Apex Enterprises',
      occupation_or_business_type: 'Wholesale Trade',
      declared_monthly_income_or_turnover: 500000,
      kyc_risk_rating: 'High',
      is_pep: false,
      country_of_residence: 'IN'
    };

    const transactions = [
      {
        transaction_id: 'TX-101',
        sender_account: 'ACC-111',
        sender_name: 'Alpha Apex Enterprises',
        receiver_account: 'ACC-222',
        receiver_name: 'Beta Global Ltd',
        amount: 2500000,
        risk_score: 85,
        timestamp: new Date().toISOString()
      },
      {
        transaction_id: 'TX-102',
        sender_account: 'ACC-111',
        sender_name: 'Alpha Apex Enterprises',
        receiver_account: 'ACC-333',
        receiver_name: 'Gamma Trading',
        amount: 1800000,
        risk_score: 90,
        timestamp: new Date().toISOString()
      }
    ];

    const ruleHits = [
      { scenario_id: 'STRUCTURING_WINDOW', name: 'Rapid Layering Pattern', category: 'Velocity', reason: 'High velocity out of profile' },
      { scenario_id: 'GRAPH_CYCLE', name: 'Circular Fund Flow', category: 'Topology', reason: '2-hop wash cycle detected' }
    ];

    const narrative = buildDeterministicSTRNarrative({
      caseObj,
      subjectInfo,
      transactions,
      ruleHits,
      graphSummary: { cycles_count: 1, num_communities: 2 },
      notes: caseObj.notes
    });

    assert.ok(narrative.includes('DRAFT FOR ANALYST EDIT - FIU-IND REGULATORY STR NARRATIVE'), 'Must include analyst draft header');
    assert.ok(narrative.includes('SECTION 1: SUMMARY OF SUSPICION & CLIENT PROFILE'), 'Must contain Section 1');
    assert.ok(narrative.includes('SECTION 2: TRANSACTION PATTERNS & FLOW OF FUNDS'), 'Must contain Section 2');
    assert.ok(narrative.includes('SECTION 3: AML SCENARIO RULE HITS & TYPOLOGY FINDINGS'), 'Must contain Section 3');
    assert.ok(narrative.includes('SECTION 4: GRAPH NETWORK & MULTI-HOP TOPOLOGY ANALYSIS'), 'Must contain Section 4');
    assert.ok(narrative.includes('SECTION 5: INVESTIGATOR CHRONOLOGY & CONCLUSION'), 'Must contain Section 5');
    assert.ok(narrative.includes('Alpha Apex Enterprises'), 'Must include customer name');
    assert.ok(narrative.includes('43,00,000') || narrative.includes('4,300,000'), 'Must include sum of reported transactions');
  });

  await t.test('2. Due Date calculations per PMLA / FIU-IND rules', () => {
    const baseDate = new Date('2026-10-01T10:00:00Z');
    const strDue = new Date(getStrDueDate(baseDate));
    const diffDays = Math.round((strDue - baseDate) / (1000 * 60 * 60 * 24));
    assert.equal(diffDays, 7, 'STR Due Date should default to 7 days from drafting');

    const ctrDue = new Date(getCtrDueDate(baseDate));
    assert.equal(ctrDue.getDate(), 15, 'CTR Due Date must be the 15th of the succeeding month');
    assert.equal(ctrDue.getMonth(), 10, 'CTR Due Date month should be next month (November)');
  });

  await t.test('3. Generate STR from Case & Four-Eyes Approval Workflow', async () => {
    // Setup test customer, transaction, and case
    const custId = 'CUST-REG-' + Date.now();
    await models.Customer.create({
      customer_id: custId,
      name: 'Vikram Real Estate Holdings',
      type: 'business',
      kyc_risk_rating: 'High',
      declared_monthly_income_or_turnover: 1000000,
      country_of_residence: 'IN'
    });

    const tx1 = 'TX-REG-' + Date.now() + '-1';
    await models.Transaction.create({
      transaction_id: tx1,
      sender_account: 'ACC-REG-S',
      sender_name: 'Vikram Real Estate Holdings',
      receiver_account: 'ACC-REG-R',
      receiver_name: 'Mule Express Account',
      amount: 4500000,
      risk_score: 88,
      timestamp: new Date().toISOString()
    });

    const caseId = 'CASE-REG-' + Date.now();
    await models.Case.create({
      case_id: caseId,
      title: 'Vikram Real Estate Layering',
      status: 'Under Review',
      assigned_to: 'analyst_arun',
      transactions: [tx1],
      alerts: []
    });

    // Step 1: Generate STR Draft
    const strDoc = await generateSTRFromCase(caseId, { username: 'analyst_arun', role: 'Investigator' });
    assert.ok(strDoc, 'STR record should be created');
    assert.equal(strDoc.status, 'Draft', 'Status must start as Draft');
    assert.equal(strDoc.prepared_by, 'analyst_arun', 'Preparer should be recorded');
    assert.equal(strDoc.case_id, caseId);
    assert.equal(strDoc.total_amount, 4500000);

    // Verify Case status transitioned to 'Pending STR'
    const updatedCase = await models.Case.findOne({ case_id: caseId });
    assert.equal(updatedCase.status, 'Pending STR');

    // Step 2: Test Four-Eyes Violation
    // Approver == Preparer should be rejected
    const { approveSTR, fileSTR } = require('../src/controllers/regulatoryController');
    let fourEyesRejected = false;
    const reqSelfApprove = {
      params: { id: strDoc.str_id },
      user: { username: 'analyst_arun', role: 'Investigator' },
      ip: '127.0.0.1'
    };
    const resSelfApprove = {
      status: (code) => {
        if (code === 403) fourEyesRejected = true;
        return { json: (d) => d };
      },
      json: (d) => d
    };
    await approveSTR(reqSelfApprove, resSelfApprove);
    assert.ok(fourEyesRejected, 'Four-Eyes rule must block preparer from approving their own STR');

    // Step 3: Valid Four-Eyes Approval by a different user
    let approvedOk = false;
    const reqOfficerApprove = {
      params: { id: strDoc.str_id },
      user: { username: 'compliance_officer_priya', role: 'Admin' },
      ip: '127.0.0.1'
    };
    const resOfficerApprove = {
      status: (code) => ({ json: (d) => d }),
      json: (d) => {
        if (d.str && d.str.status === 'Pending Approval') approvedOk = true;
      }
    };
    await approveSTR(reqOfficerApprove, resOfficerApprove);
    assert.ok(approvedOk, 'Approver differing from preparer must successfully approve STR');

    // Step 4: Mark STR as Filed
    let filedOk = false;
    const reqFile = {
      params: { id: strDoc.str_id },
      body: { acknowledgement_reference: 'FIU-ACK-2026-TEST-99' },
      user: { username: 'compliance_officer_priya', role: 'Admin' },
      ip: '127.0.0.1'
    };
    const resFile = {
      status: (code) => ({ json: (d) => d }),
      json: (d) => {
        if (d.str && d.str.status === 'Filed') filedOk = true;
      }
    };
    await fileSTR(reqFile, resFile);
    assert.ok(filedOk, 'Filing must succeed and set status to Filed');

    // Verify Case status updated to Closed (True Positive - STR Filed)
    const closedCase = await models.Case.findOne({ case_id: caseId });
    assert.equal(closedCase.status, 'Closed');
    assert.equal(closedCase.closure_disposition, 'True Positive - STR Filed');
  });

  await t.test('4. CTR Cash Aggregation above ₹10L Threshold', async () => {
    const period = '2026-10';
    const custId = 'CUST-CTR-CASH-' + Date.now();
    await models.Customer.create({
      customer_id: custId,
      name: 'Kavita Cash Jewelers',
      type: 'business',
      kyc_risk_rating: 'Medium',
      country_of_residence: 'IN'
    });

    // Create cash transactions totaling ₹14,00,000 (above ₹10L threshold)
    const accId = 'ACC-CTR-' + Date.now();
    await models.Transaction.create({
      transaction_id: 'TX-CASH-1-' + Date.now(),
      sender_account: accId,
      sender_name: 'Kavita Cash Jewelers',
      receiver_account: 'ACC-VAULT',
      receiver_name: 'Bank Cash Vault',
      amount: 600000,
      payment_method: 'Cash Deposit',
      timestamp: '2026-10-02T11:00:00Z'
    });

    await models.Transaction.create({
      transaction_id: 'TX-CASH-2-' + Date.now(),
      sender_account: accId,
      sender_name: 'Kavita Cash Jewelers',
      receiver_account: 'ACC-VAULT',
      receiver_name: 'Bank Cash Vault',
      amount: 800000,
      payment_method: 'Cash Deposit',
      timestamp: '2026-10-03T14:30:00Z'
    });

    const ctrs = await generateCTRReport({ period, threshold_inr: 1000000 });
    const match = ctrs.find(c => c.account_id === accId);
    assert.ok(match, 'Customer with >= ₹10L cash transactions must generate a CTR');
    assert.equal(match.total_cash_amount, 1400000, 'Aggregated total cash amount must equal ₹14,00,000');
    assert.equal(match.transaction_count, 2, 'Should aggregate 2 cash transactions');
  });

  await t.test('5. XML & JSON Regulatory Export Format Compliance', () => {
    const mockSTR = {
      str_id: 'STR-2026-EXP-1',
      case_id: 'CASE-EXP-1',
      ground_for_suspicion_code: 'G01',
      total_amount: 5000000,
      due_date: '2026-10-12T00:00:00Z',
      prepared_by: 'analyst_1',
      approved_by: 'officer_1',
      subject: {
        customer_id: 'CUST-001',
        name: 'Nexus Shell Company & Associates',
        kyc_risk_rating: 'High'
      },
      linked_accounts: ['ACC-1', 'ACC-2'],
      narrative: 'Detailed suspicious transaction rationale.',
      transactions: [
        { transaction_id: 'TX-1', amount: 5000000, sender_account: 'ACC-1', receiver_account: 'ACC-2', risk_score: 95 }
      ]
    };

    const xml = exportReportXML(mockSTR, 'STR');
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Must be valid XML');
    assert.ok(xml.includes('<SuspiciousTransactionReport'), 'Must have root STR tag');
    assert.ok(xml.includes('Nexus Shell Company &amp; Associates'), 'Must escape XML entities');
    assert.ok(xml.includes('verify against regulator\'s current schema'), 'Must include schema citation');
  });
});
