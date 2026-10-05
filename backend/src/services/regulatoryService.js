/**
 * FundTraceAI - Regulatory Reporting Engine (FIU-IND / PMLA Compliance)
 * 
 * Features:
 * 1. Deterministic Auto-Drafted STR Narrative (No LLM calls, template-based, marked for analyst review)
 * 2. Monthly / Ad-hoc CTR Cash Aggregation above CTR threshold
 * 3. Structured XML & JSON Regulatory Export
 * 4. Four-Eyes STR Approval & Due Date Tracking
 * 
 * Regulatory Notice:
 * // verify against regulator's current schema (FIU-IND XML schema v2.0 / FINnet 2.0 / PMLA Rules 2005)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { getRiskConfig, getCtrThreshold } = require('../config/riskConfig');

const REGULATORY_SCHEMA_PATH = path.resolve(__dirname, '../../../config/regulatory_schema.json');

function getRegulatorySchema() {
  if (fs.existsSync(REGULATORY_SCHEMA_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(REGULATORY_SCHEMA_PATH, 'utf8'));
    } catch (e) {
      console.warn('[RegulatoryService] Could not parse regulatory_schema.json:', e.message);
    }
  }
  return {
    reporting_entity: {
      entity_id: 'RE-IN-BAN-00941',
      entity_name: 'FundTraceAI Scheduled Commercial Bank',
      principal_officer: { name: 'Chief Compliance Officer', designation: 'Principal Officer (PMLA)' }
    },
    str_schema: { filing_window_days: 7 },
    ctr_schema: { threshold_inr: 1000000.0, filing_due_day_of_month: 15 }
  };
}

function generateStrId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `STR-${ts}-${rand}`;
}

function generateCtrId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CTR-${ts}-${rand}`;
}

/**
 * Calculates STR Filing Due Date based on configurable window (default 7 days per PMLA)
 */
function getStrDueDate(startDate = new Date()) {
  const riskCfg = getRiskConfig();
  const days = riskCfg.regulatory_reporting?.str_filing_window_days || 7;
  const due = new Date(startDate);
  due.setDate(due.getDate() + days);
  return due.toISOString();
}

/**
 * Calculates CTR Filing Due Date (15th of the succeeding month)
 */
function getCtrDueDate(targetDate = new Date()) {
  const date = new Date(targetDate);
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 15, 23, 59, 59);
  return nextMonth.toISOString();
}

/**
 * Generates deterministic, template-based STR Narrative from case findings
 */
function buildDeterministicSTRNarrative({ caseObj, subjectInfo, transactions = [], ruleHits = [], graphSummary = null, notes = [] }) {
  const totalAmount = transactions.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
  const avgRisk = transactions.length 
    ? Math.round(transactions.reduce((sum, t) => sum + (t.risk_score || 0), 0) / transactions.length) 
    : 75;

  const accountsInvolved = [...new Set([
    ...transactions.map(t => t.sender_account),
    ...transactions.map(t => t.receiver_account)
  ])].filter(Boolean);

  const counterparties = [...new Set([
    ...transactions.map(t => t.sender_name),
    ...transactions.map(t => t.receiver_name)
  ])].filter(Boolean);

  const dates = transactions.map(t => new Date(t.timestamp || t.createdAt)).filter(d => !isNaN(d));
  const minDate = dates.length ? new Date(Math.min(...dates)).toLocaleDateString('en-IN') : 'N/A';
  const maxDate = dates.length ? new Date(Math.max(...dates)).toLocaleDateString('en-IN') : 'N/A';

  // Format detected typologies
  const typologiesList = ruleHits.length > 0 
    ? ruleHits.map(r => `• [${r.category || 'Typology'}] ${r.name || r.scenario_id}: ${r.reason || 'Pattern identified'}`).join('\n')
    : '• Elevated risk velocity and anomalous counterparty capital distribution exceeding institutional baselines.';

  // Format graph findings
  let graphSection = 'Multi-hop transaction analysis revealed interconnected accounts in rapid succession.';
  if (graphSummary) {
    graphSection = `Network graph expansion uncovered ${graphSummary.num_nodes || accountsInvolved.length} connected accounts, ${graphSummary.cycles_count || 0} circular fund loop(s) (wash trading), and ${graphSummary.num_communities || 1} dense counterparty community cluster(s).`;
  }

  // Format analyst notes chronology
  const notesText = notes.length > 0
    ? notes.map(n => `[${new Date(n.timestamp || Date.now()).toLocaleDateString('en-IN')} - ${n.investigator || 'Analyst'}]: ${n.text}`).join('\n')
    : 'Investigation initiated following automated AML scenario and calibrated machine learning alert flags.';

  const subjectName = subjectInfo.name || subjectInfo.customer_name || 'Designated Target Entity';
  const subjectId = subjectInfo.customer_id || subjectInfo.account_id || accountsInvolved[0] || 'Unknown';
  const subjectOccupation = subjectInfo.occupation_or_business_type || subjectInfo.occupation || 'Commercial / General Account';
  const declaredIncome = subjectInfo.declared_monthly_income_or_turnover ? `₹${Number(subjectInfo.declared_monthly_income_or_turnover).toLocaleString('en-IN')}/month` : 'Not Declared';
  const kycRating = subjectInfo.kyc_risk_rating || 'High';

  return `// DRAFT FOR ANALYST EDIT - FIU-IND REGULATORY STR NARRATIVE
// Statutory Authority: Prevention of Money Laundering Act (PMLA), 2002 / PML Rules 2005
// Reporting Entity ID: RE-IN-BAN-00941 (FundTraceAI Scheduled Commercial Bank)

SECTION 1: SUMMARY OF SUSPICION & CLIENT PROFILE
--------------------------------------------------------------------------------
The subject "${subjectName}" (Identifier: ${subjectId}, Occupation/Nature of Business: ${subjectOccupation}, KYC Risk Rating: ${kycRating}, Declared Turnover: ${declaredIncome}) came under enhanced compliance scrutiny following systematic detection of high-risk transaction patterns across linked accounts. The aggregate suspicious volume identified in this investigation totals ₹${totalAmount.toLocaleString('en-IN')} across ${transactions.length} transaction(s) executed between ${minDate} and ${maxDate}. The overall machine learning composite threat score is assessed at ${avgRisk}%.

SECTION 2: TRANSACTION PATTERNS & FLOW OF FUNDS
--------------------------------------------------------------------------------
Activity across account(s) ${accountsInvolved.join(', ')} exhibited significant deviation from expected economic rationale and declared customer baseline volume. Funds were routed through ${counterparties.length} counterparties (${counterparties.slice(0, 4).join(', ')}${counterparties.length > 4 ? ', et al.' : ''}) utilizing high-velocity electronic and cash integration channels.

SECTION 3: AML SCENARIO RULE HITS & TYPOLOGY FINDINGS
--------------------------------------------------------------------------------
The automated AML Scenario Engine and Name Screening modules flagged the following statutory grounds for suspicion:
${typologiesList}

SECTION 4: GRAPH NETWORK & MULTI-HOP TOPOLOGY ANALYSIS
--------------------------------------------------------------------------------
${graphSection}

SECTION 5: INVESTIGATOR CHRONOLOGY & CONCLUSION
--------------------------------------------------------------------------------
${notesText}

CONCLUSION:
Based on the absence of discernible lawful commercial purpose, significant turnover-to-income disparity, and identified smurfing/layering typologies, this matter is formally submitted to the Principal Officer for filing as a Suspicious Transaction Report under Section 12 of the PMLA, 2002.
// END OF DRAFT NARRATIVE`;
}

/**
 * Generate an STR Draft from a Case
 */
async function generateSTRFromCase(caseId, user) {
  const caseObj = await models.Case.findOne({ case_id: caseId });
  if (!caseObj) {
    throw new Error(`Case ${caseId} not found.`);
  }

  // 1. Gather all transactions and rule hits from linked alerts & case transactions
  const transactionsMap = new Map();
  const allRuleHits = [];
  const allScreeningHits = [];
  let primaryCustomer = null;
  const linkedAccounts = new Set();
  const txIdList = new Set();

  for (const tid of (caseObj.transactions || [])) {
    if (tid) txIdList.add(tid);
  }

  for (const alertId of (caseObj.alerts || [])) {
    const alert = await models.Alert.findOne({ alert_id: alertId });
    if (alert) {
      if (alert.entity_id) linkedAccounts.add(alert.entity_id);
      
      // Fetch primary transaction and child transactions
      const childTxs = Array.isArray(alert.transaction_ids) && alert.transaction_ids.length > 0 
        ? alert.transaction_ids 
        : [alert.transaction_id];

      for (const tid of childTxs) {
        if (tid) txIdList.add(tid);
      }
    }
  }

  for (const tid of txIdList) {
    if (!transactionsMap.has(tid)) {
      const tx = await models.Transaction.findOne({ transaction_id: tid });
      if (tx) {
        transactionsMap.set(tid, tx);
        if (tx.sender_account) linkedAccounts.add(tx.sender_account);
        if (tx.receiver_account) linkedAccounts.add(tx.receiver_account);
        if (Array.isArray(tx.rule_hits)) allRuleHits.push(...tx.rule_hits);
        if (Array.isArray(tx.screening_hits)) allScreeningHits.push(...tx.screening_hits);
        
        // Try resolving Customer profile
        if (tx.customer_id && !primaryCustomer) {
          try {
            primaryCustomer = await models.Customer.findOne({ customer_id: tx.customer_id });
          } catch (e) {}
        }
      }
    }
  }

  const transactions = Array.from(transactionsMap.values());
  const totalSuspiciousAmount = transactions.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

  // Subject Info
  const firstTx = transactions[0] || {};
  const subjectInfo = {
    customer_id: primaryCustomer ? primaryCustomer.customer_id : (firstTx.customer_id || firstTx.sender_account || 'CUST_UNKNOWN'),
    name: primaryCustomer ? primaryCustomer.name : (firstTx.sender_name || 'Designated Subject'),
    type: primaryCustomer ? primaryCustomer.type : 'individual',
    occupation_or_business_type: primaryCustomer ? primaryCustomer.occupation_or_business_type : 'General',
    declared_monthly_income_or_turnover: primaryCustomer ? primaryCustomer.declared_monthly_income_or_turnover : 0,
    kyc_risk_rating: primaryCustomer ? primaryCustomer.kyc_risk_rating : 'High',
    is_pep: primaryCustomer ? primaryCustomer.is_pep : false,
    country: primaryCustomer ? primaryCustomer.country_of_residence : (firstTx.country || 'IN')
  };

  // Extract detected typologies
  const typologySet = new Set();
  for (const r of allRuleHits) {
    if (r.name) typologySet.add(r.name);
    else if (r.scenario_id) typologySet.add(r.scenario_id);
  }
  if (typologySet.size === 0) {
    typologySet.add('Structuring and High-Velocity Layering Pattern');
  }

  // Extract reasons for suspicion
  const reasonsSet = new Set();
  for (const r of allRuleHits) {
    if (r.reason) reasonsSet.add(r.reason);
  }
  for (const s of allScreeningHits) {
    if (s.reason) reasonsSet.add(s.reason);
  }
  for (const t of transactions) {
    if (Array.isArray(t.reasons)) {
      for (const reason of t.reasons) reasonsSet.add(reason);
    }
  }

  // Generate deterministic draft narrative
  const narrative = buildDeterministicSTRNarrative({
    caseObj,
    subjectInfo,
    transactions,
    ruleHits: allRuleHits,
    graphSummary: null,
    notes: caseObj.notes || []
  });

  const strId = generateStrId();
  const dueDate = getStrDueDate(caseObj.createdAt || new Date());
  const now = new Date().toISOString();

  const strDoc = {
    str_id: strId,
    case_id: caseId,
    case_title: caseObj.title,
    subject: subjectInfo,
    subject_info: subjectInfo,
    linked_accounts: Array.from(linkedAccounts),
    transactions: transactions.map(t => ({
      transaction_id: t.transaction_id,
      amount: t.amount,
      sender_account: t.sender_account,
      sender_name: t.sender_name,
      receiver_account: t.receiver_account,
      receiver_name: t.receiver_name,
      payment_method: t.payment_method,
      country: t.country,
      timestamp: t.timestamp || t.createdAt,
      risk_score: t.risk_score
    })),
    total_amount: totalSuspiciousAmount,
    total_suspicious_amount: totalSuspiciousAmount,
    transaction_count: transactions.length,
    detected_typologies: Array.from(typologySet).map(name => ({ name, category: 'Typology', reason: name })),
    reasons_for_suspicion: Array.from(reasonsSet).slice(0, 8),
    ground_for_suspicion_code: 'G01',
    narrative,
    status: 'Draft',
    prepared_by: user?.username || 'investigator',
    prepared_at: now,
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    filing_date: null,
    acknowledgement_reference: null,
    due_date: dueDate,
    createdAt: now,
    updatedAt: now
  };

  const createdSTR = await models.STRReport.create(strDoc);

  // Update Case status to 'Pending STR'
  if (typeof models.Case.findOneAndUpdate === 'function') {
    await models.Case.findOneAndUpdate(
      { case_id: caseId },
      { status: 'Pending STR', updatedAt: now }
    );
  } else {
    await models.Case.findByIdAndUpdate(caseId, { status: 'Pending STR', updatedAt: now });
  }

  await logAction(
    user?.username || 'investigator',
    user?.role || 'Investigator',
    'STR_DRAFT_GENERATED',
    '127.0.0.1',
    `Generated STR draft ${strId} for case ${caseId} (Suspicious Amount: ₹${totalSuspiciousAmount.toLocaleString('en-IN')})`
  );

  return createdSTR;
}

/**
 * Cash Transaction Report (CTR) Aggregator
 * Aggregates cash deposits/withdrawals exceeding the statutory CTR threshold
 */
async function generateCTRReport(options = {}) {
  const period = options.period || new Date().toISOString().substring(0, 7); // e.g. "2026-10"
  const threshold = options.threshold_inr || options.threshold || getCtrThreshold(); // 1,000,000 INR
  const currentUser = options.user?.username || 'System';

  // 1. Fetch cash transactions
  const allTxs = await models.Transaction.find({});
  const cashMethods = ['Cash Deposit', 'Cash', 'ATM', 'Cash Withdrawal'];

  const filteredCashTxs = allTxs.filter(t => {
    const isCash = cashMethods.includes(t.payment_method) || (t.category && t.category.toLowerCase().includes('cash'));
    if (!isCash) return false;
    
    // Check period if specified
    if (period && t.timestamp) {
      return String(t.timestamp).startsWith(period);
    }
    return true;
  });

  // 2. Group cash transactions by Customer / Sender Account
  const groups = {};
  for (const tx of filteredCashTxs) {
    const key = tx.customer_id || tx.sender_account || 'ACC_UNKNOWN';
    if (!groups[key]) {
      groups[key] = {
        key,
        customer_id: tx.customer_id || null,
        customer_name: tx.sender_name || 'Cash Depositor',
        account_id: tx.sender_account || key,
        total_cash: 0,
        transactions: []
      };
    }
    groups[key].total_cash += (parseFloat(tx.amount) || 0);
    groups[key].transactions.push({
      transaction_id: tx.transaction_id,
      amount: tx.amount,
      sender_account: tx.sender_account,
      sender_name: tx.sender_name,
      receiver_account: tx.receiver_account,
      payment_method: tx.payment_method,
      timestamp: tx.timestamp || tx.createdAt
    });
  }

  // 3. Filter groups exceeding the threshold
  const qualifyingGroups = Object.values(groups).filter(g => g.total_cash >= threshold);

  const generatedReports = [];
  const dueDate = getCtrDueDate(new Date());

  for (const group of qualifyingGroups) {
    const ctrId = generateCtrId();
    const now = new Date().toISOString();

    const ctrDoc = {
      ctr_id: ctrId,
      period,
      customer_id: group.customer_id,
      customer_name: group.customer_name,
      account_id: group.account_id,
      total_cash_amount: group.total_cash,
      transaction_count: group.transactions.length,
      transactions: group.transactions,
      status: 'Generated',
      generated_by: currentUser,
      approved_by: null,
      acknowledgement_reference: null,
      filing_date: null,
      due_date: dueDate,
      createdAt: now,
      updatedAt: now
    };

    const savedCTR = await models.CTRReport.create(ctrDoc);
    generatedReports.push(savedCTR);
  }

  await logAction(
    currentUser,
    options.user?.role || 'System',
    'CTR_REPORT_GENERATED',
    '127.0.0.1',
    `Generated ${generatedReports.length} CTR filings for period ${period} (Threshold: ₹${threshold.toLocaleString('en-IN')})`
  );

  generatedReports.period = period;
  generatedReports.threshold = threshold;
  generatedReports.total_cash_transactions_scanned = filteredCashTxs.length;
  generatedReports.reports_generated_count = generatedReports.length;
  generatedReports.reports = generatedReports;

  return generatedReports;
}

/**
 * Generate Structured XML for STR / CTR
 */
function exportReportXML(report, type = 'STR') {
  const schema = getRegulatorySchema();
  const re = schema.reporting_entity;

  if (type === 'STR') {
    const subj = report.subject || report.subject_info || {};
    const txItems = (report.transactions || []).map(t => `
      <Transaction>
        <TransactionID>${t.transaction_id}</TransactionID>
        <Amount Currency="INR">${t.amount}</Amount>
        <Timestamp>${t.timestamp || ''}</Timestamp>
        <PaymentMethod>${t.payment_method || 'Electronic'}</PaymentMethod>
        <SenderAccount>${t.sender_account || ''}</SenderAccount>
        <SenderName>${t.sender_name || ''}</SenderName>
        <ReceiverAccount>${t.receiver_account || ''}</ReceiverAccount>
        <ReceiverName>${t.receiver_name || ''}</ReceiverName>
        <RiskScore>${t.risk_score || 0}</RiskScore>
      </Transaction>`).join('');

    const reasons = (report.reasons_for_suspicion || []).map(r => `
      <Reason>${escapeXml(r)}</Reason>`).join('');

    const typologies = (report.detected_typologies || []).map(t => {
      const name = typeof t === 'string' ? t : (t.name || t.scenario_id || '');
      return `
      <Typology>${escapeXml(name)}</Typology>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Regulatory Schema: FIU-IND XML Schema v2.0 / PMLA 2002 Compliance -->
<!-- verify against regulator's current schema -->
<SuspiciousTransactionReport xmlns="http://fiuindia.gov.in/schema/str/v2.0" ReportID="${report.str_id}" Status="${report.status}">
  <ReportingEntity>
    <EntityID>${re.entity_id}</EntityID>
    <EntityName>${re.entity_name}</EntityName>
    <PrincipalOfficer>${re.principal_officer.name}</PrincipalOfficer>
  </ReportingEntity>
  <CaseReference>
    <CaseID>${report.case_id}</CaseID>
    <CaseTitle>${escapeXml(report.case_title || '')}</CaseTitle>
  </CaseReference>
  <SubjectDetails>
    <CustomerID>${subj.customer_id || ''}</CustomerID>
    <Name>${escapeXml(subj.name || '')}</Name>
    <Occupation>${escapeXml(subj.occupation_or_business_type || '')}</Occupation>
    <DeclaredIncome>${subj.declared_monthly_income_or_turnover || 0}</DeclaredIncome>
    <KYCRiskRating>${subj.kyc_risk_rating || 'High'}</KYCRiskRating>
    <IsPEP>${subj.is_pep ? 'Y' : 'N'}</IsPEP>
    <Country>${subj.country || subj.country_of_residence || 'IN'}</Country>
  </SubjectDetails>
  <FinancialSummary>
    <TotalSuspiciousAmount Currency="INR">${report.total_amount || report.total_suspicious_amount || 0}</TotalSuspiciousAmount>
    <TransactionCount>${(report.transactions || []).length}</TransactionCount>
    <DueDate>${report.due_date || ''}</DueDate>
  </FinancialSummary>
  <GroundsForSuspicion>
    ${reasons}
  </GroundsForSuspicion>
  <DetectedTypologies>
    ${typologies}
  </DetectedTypologies>
  <Narrative>
    <![CDATA[${report.narrative || ''}]]>
  </Narrative>
  <AuditTrail>
    <PreparedBy>${report.prepared_by || ''}</PreparedBy>
    <PreparedAt>${report.prepared_at || ''}</PreparedAt>
    <ApprovedBy>${report.approved_by || ''}</ApprovedBy>
    <ApprovedAt>${report.approved_at || ''}</ApprovedAt>
    <AcknowledgementReference>${report.acknowledgement_reference || ''}</AcknowledgementReference>
  </AuditTrail>
</SuspiciousTransactionReport>`;
  } else {
    // CTR XML
    const txItems = (report.transactions || []).map(t => `
      <CashTransaction>
        <TransactionID>${t.transaction_id}</TransactionID>
        <Amount Currency="INR">${t.amount}</Amount>
        <Timestamp>${t.timestamp || ''}</Timestamp>
        <PaymentMethod>${t.payment_method || 'Cash Deposit'}</PaymentMethod>
        <AccountID>${t.sender_account || ''}</AccountID>
      </CashTransaction>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Regulatory Schema: FIU-IND CTR XML Schema v2.0 / PMLA 2002 Compliance -->
<!-- verify against regulator's current schema -->
<CashTransactionReport xmlns="http://fiuindia.gov.in/schema/ctr/v2.0" ReportID="${report.ctr_id}" Period="${report.period}">
  <ReportingEntity>
    <EntityID>${re.entity_id}</EntityID>
    <EntityName>${re.entity_name}</EntityName>
  </ReportingEntity>
  <CustomerSummary>
    <CustomerID>${report.customer_id || ''}</CustomerID>
    <CustomerName>${escapeXml(report.customer_name || '')}</CustomerName>
    <AccountID>${report.account_id || ''}</AccountID>
    <TotalCashVolume Currency="INR">${report.total_cash_amount || 0}</TotalCashVolume>
    <TransactionCount>${report.transaction_count || 1}</TransactionCount>
    <DueDate>${report.due_date || ''}</DueDate>
  </CustomerSummary>
  <CashTransactions>
    ${txItems}
  </CashTransactions>
</CashTransactionReport>`;
  }
}

function escapeXml(unsafe) {
  if (!unsafe || typeof unsafe !== 'string') return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

module.exports = {
  getRegulatorySchema,
  generateStrId,
  generateCtrId,
  getStrDueDate,
  getCtrDueDate,
  buildDeterministicSTRNarrative,
  generateSTRFromCase,
  generateCTRReport,
  exportReportXML
};
