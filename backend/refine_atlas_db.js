/**
 * Database Perfection & AML Calibration Script for MongoDB Atlas
 * 
 * Curates MongoDB Atlas into a realistic, presentation-grade compliance dataset:
 * - 500 clean, diverse transactions (94% legitimate, 6% true suspicious/laundering)
 * - Calibrated alert distribution (~8 Critical, ~15 High, ~25 Medium, ~30 Low)
 * - Realistic multi-hop circular laundering cases with Cytoscape graph linkages
 * - Realistic compliance audit trail
 * - Preserves existing user accounts
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

const TARGET_URI = process.env.MONGODB_URI;

if (!TARGET_URI) {
  console.error('❌ MONGODB_URI not found in backend/.env');
  process.exit(1);
}

// Risk calculation helper
function computeRisk(tx) {
  let score = 5;
  const reasons = [];
  const shap = [];

  const amount = parseFloat(tx.amount || 0);
  const country = tx.country || 'IN';
  const payMethod = tx.payment_method || 'UPI';
  const category = tx.category || 'Transfer';
  const hour = new Date(tx.timestamp).getHours();

  // 1. Structuring or Large Amount
  if (amount >= 9000 && amount <= 9999) {
    score += 40;
    reasons.push('Transaction structured just below reporting limit (near $10K)');
    shap.push({ feature: 'amount_near_threshold', shap_value: 0.40, actual_value: 1 });
  } else if (amount >= 100000) {
    score += 35;
    reasons.push('Extremely large transfer volume ($100k+)');
    shap.push({ feature: 'is_large_amount', shap_value: 0.35, actual_value: 1 });
  } else if (amount >= 50000) {
    score += 20;
    reasons.push('Elevated transfer volume ($50k+)');
    shap.push({ feature: 'is_large_amount', shap_value: 0.20, actual_value: 1 });
  } else {
    shap.push({ feature: 'amount_near_threshold', shap_value: -0.05, actual_value: 0 });
    shap.push({ feature: 'is_large_amount', shap_value: -0.05, actual_value: 0 });
  }
  shap.push({ feature: 'amount', shap_value: amount > 25000 ? 0.1 : -0.1, actual_value: amount });

  // 2. High risk jurisdictions
  const highRiskCountries = ['KY', 'PA', 'AE', 'RU', 'BS', 'LU'];
  if (highRiskCountries.includes(country)) {
    score += 30;
    reasons.push(`Transacting with high-risk jurisdiction / offshore haven (${country})`);
    shap.push({ feature: 'is_high_risk_country', shap_value: 0.30, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_high_risk_country', shap_value: -0.1, actual_value: 0 });
  }

  // 3. Payment Method: Only actual high-risk anonymous channels
  if (['Crypto Transfer', 'Cash Deposit'].includes(payMethod)) {
    score += 20;
    reasons.push(`Use of high-risk payment channel (${payMethod})`);
    shap.push({ feature: 'is_wire_or_crypto', shap_value: 0.20, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_wire_or_crypto', shap_value: -0.05, actual_value: 0 });
  }

  // 4. Time
  if (hour >= 23 || hour <= 4) {
    score += 10;
    reasons.push('Late-night transaction timing');
    shap.push({ feature: 'is_night', shap_value: 0.10, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_night', shap_value: -0.05, actual_value: 0 });
  }

  // 5. Category
  if (category === 'Transfer' && (highRiskCountries.includes(country) || ['Crypto Transfer', 'Cash Deposit'].includes(payMethod))) {
    score += 10;
    reasons.push('Direct unclassified capital transfer');
    shap.push({ feature: 'is_transfer', shap_value: 0.10, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_transfer', shap_value: -0.05, actual_value: 0 });
  }

  // Velocity defaults in fallback
  shap.push({ feature: 'sender_time_diff', shap_value: 0.0, actual_value: 9999 });
  shap.push({ feature: 'receiver_time_diff', shap_value: 0.0, actual_value: 9999 });
  shap.push({ feature: 'sender_velocity_2h', shap_value: 0.0, actual_value: 0 });
  shap.push({ feature: 'receiver_velocity_2h', shap_value: 0.0, actual_value: 0 });

  if (tx.is_laundering === 1 && score < 70) {
    score = 75;
    if (reasons.length === 0) reasons.push('Suspicious transfer pattern');
  }

  return {
    risk_score: Math.min(score, 98),
    reasons: reasons.slice(0, 3),
    shap_explanation: shap
  };
}

async function refineDatabase() {
  console.log('====================================================');
  console.log('     MONGODB ATLAS DATABASE REFINEMENT TOOL         ');
  console.log('====================================================');

  const maskedUri = TARGET_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  console.log(`Target: ${maskedUri}\n`);

  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(TARGET_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log('Connected to Atlas successfully.\n');

  // 1. Read synthetic dataset
  const csvPath = path.join(__dirname, '..', 'dataset', 'dataset.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error('dataset.csv not found at ' + csvPath);
  }
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n');

  const legitimateRows = [];
  const launderingRows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.replace('\r', '').split(',');
    if (cols.length < 17) continue;

    const row = {
      transaction_id: cols[0],
      sender_account: cols[1],
      sender_name: cols[2],
      receiver_account: cols[3],
      receiver_name: cols[4],
      amount: parseFloat(cols[5]),
      currency: cols[6] || 'INR',
      timestamp: new Date(cols[7]).toISOString(),
      country: cols[8],
      city: cols[9],
      device_id: cols[10],
      ip_address: cols[11],
      payment_method: cols[12],
      merchant: cols[13],
      category: cols[14],
      status: cols[15],
      is_laundering: parseInt(cols[16] || 0)
    };

    if (row.is_laundering === 1) {
      launderingRows.push(row);
    } else {
      legitimateRows.push(row);
    }
  }

  console.log(`Parsed ${legitimateRows.length} clean and ${launderingRows.length} laundering rows from CSV.`);

  // Curate 470 clean + 30 suspicious = 500 total transactions
  const selectedLegit = legitimateRows.slice(0, 470);
  const selectedLaundering = launderingRows.slice(0, 25);

  // Add 5 custom high-profile structuring & circular layering cases for demo perfection
  const circularTransactions = [
    {
      transaction_id: 'TX990001',
      sender_account: 'ACC_HYDRA_1',
      sender_name: 'Starlight Holdings Ltd',
      receiver_account: 'ACC_HYDRA_2',
      receiver_name: 'Apex Global Trading',
      amount: 9850.00,
      currency: 'INR',
      timestamp: new Date('2026-01-14T02:15:00Z').toISOString(),
      country: 'KY',
      city: 'George Town',
      device_id: 'DEV884910',
      ip_address: '198.51.100.24',
      payment_method: 'Crypto Transfer',
      merchant: 'Offshore Exchange',
      category: 'Transfer',
      status: 'Approved',
      is_laundering: 1
    },
    {
      transaction_id: 'TX990002',
      sender_account: 'ACC_HYDRA_2',
      sender_name: 'Apex Global Trading',
      receiver_account: 'ACC_HYDRA_3',
      receiver_name: 'Zenith Capital Logistics',
      amount: 9780.00,
      currency: 'INR',
      timestamp: new Date('2026-01-14T03:30:00Z').toISOString(),
      country: 'PA',
      city: 'Panama City',
      device_id: 'DEV884911',
      ip_address: '198.51.100.25',
      payment_method: 'Crypto Transfer',
      merchant: 'Offshore Exchange',
      category: 'Transfer',
      status: 'Approved',
      is_laundering: 1
    },
    {
      transaction_id: 'TX990003',
      sender_account: 'ACC_HYDRA_3',
      sender_name: 'Zenith Capital Logistics',
      receiver_account: 'ACC_HYDRA_1',
      receiver_name: 'Starlight Holdings Ltd',
      amount: 9650.00,
      currency: 'INR',
      timestamp: new Date('2026-01-14T04:45:00Z').toISOString(),
      country: 'KY',
      city: 'George Town',
      device_id: 'DEV884912',
      ip_address: '198.51.100.26',
      payment_method: 'Crypto Transfer',
      merchant: 'Offshore Exchange',
      category: 'Transfer',
      status: 'Approved',
      is_laundering: 1
    },
    {
      transaction_id: 'TX990004',
      sender_account: 'ACC_SMURF_1',
      sender_name: 'Vanguard Retail Corp',
      receiver_account: 'ACC_SMURF_HUB',
      receiver_name: 'Metro Aggregate Funds',
      amount: 9950.00,
      currency: 'INR',
      timestamp: new Date('2026-01-13T23:10:00Z').toISOString(),
      country: 'IN',
      city: 'Mumbai',
      device_id: 'DEV441201',
      ip_address: '103.22.45.10',
      payment_method: 'Cash Deposit',
      merchant: 'Cash Agent Branch',
      category: 'Transfer',
      status: 'Approved',
      is_laundering: 1
    },
    {
      transaction_id: 'TX990005',
      sender_account: 'ACC_SMURF_2',
      sender_name: 'Pacific Trading House',
      receiver_account: 'ACC_SMURF_HUB',
      receiver_name: 'Metro Aggregate Funds',
      amount: 9920.00,
      currency: 'INR',
      timestamp: new Date('2026-01-13T23:45:00Z').toISOString(),
      country: 'IN',
      city: 'Delhi',
      device_id: 'DEV441202',
      ip_address: '103.22.45.11',
      payment_method: 'Cash Deposit',
      merchant: 'Cash Agent Branch',
      category: 'Transfer',
      status: 'Approved',
      is_laundering: 1
    }
  ];

  const allCuratedTxs = [...selectedLegit, ...selectedLaundering, ...circularTransactions];
  console.log(`Assembled total ${allCuratedTxs.length} curated transactions.`);

  // Calculate risk and generate alerts
  const processedTransactions = [];
  const processedAlerts = [];

  for (const rawTx of allCuratedTxs) {
    const riskData = computeRisk(rawTx);
    const txDoc = {
      ...rawTx,
      risk_score: riskData.risk_score,
      reasons: riskData.reasons,
      shap_explanation: riskData.shap_explanation
    };
    processedTransactions.push(txDoc);

    // Alert threshold calibration:
    // Critical: >= 80
    // High: >= 60
    // Medium: >= 35
    // Low: >= 20
    let alertLevel = null;
    if (txDoc.risk_score >= 80) alertLevel = 'Critical';
    else if (txDoc.risk_score >= 60) alertLevel = 'High';
    else if (txDoc.risk_score >= 35) alertLevel = 'Medium';
    else if (txDoc.risk_score >= 20) alertLevel = 'Low';

    if (alertLevel) {
      const alertId = 'ALT' + Math.floor(100000 + Math.random() * 900000);
      processedAlerts.push({
        alert_id: alertId,
        transaction_id: txDoc.transaction_id,
        risk_score: txDoc.risk_score,
        level: alertLevel,
        status: alertLevel === 'Critical' ? 'Investigating' : (Math.random() > 0.4 ? 'New' : 'Under Review'),
        createdAt: txDoc.timestamp
      });
    }
  }

  // Create realistic Investigation Cases linking these alerts
  const criticalAlerts = processedAlerts.filter(a => a.level === 'Critical');
  const highAlerts = processedAlerts.filter(a => a.level === 'High');
  const mediumAlerts = processedAlerts.filter(a => a.level === 'Medium');

  // Circular case alerts (TX990001, TX990002, TX990003)
  const hydraAlerts = processedAlerts.filter(a => ['TX990001', 'TX990002', 'TX990003'].includes(a.transaction_id)).map(a => a.alert_id);
  const smurfAlerts = processedAlerts.filter(a => ['TX990004', 'TX990005'].includes(a.transaction_id)).map(a => a.alert_id);

  const casesToInsert = [
    {
      case_id: 'CASE1001',
      title: 'Operation Hydra: Offshore Circular Layering Ring',
      assigned_to: 'investigator',
      status: 'Under Review',
      alerts: hydraAlerts.length > 0 ? hydraAlerts : [criticalAlerts[0]?.alert_id].filter(Boolean),
      notes: [
        {
          investigator: 'investigator',
          text: 'Discovered triangular cyclic fund flow between Cayman Islands (KY) and Panama (PA). Funds routed in rapid crypto transfers under $10k.',
          timestamp: new Date().toISOString()
        },
        {
          investigator: 'admin',
          text: 'Verified offshore registrar documents. Counterparties share common ultimate beneficial ownership.',
          timestamp: new Date().toISOString()
        }
      ],
      evidence: [],
      createdAt: new Date('2026-01-14T05:00:00Z').toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      case_id: 'CASE1002',
      title: 'High-Volume Cash Structuring & Smurfing Network',
      assigned_to: 'investigator',
      status: 'Open',
      alerts: smurfAlerts.length > 0 ? smurfAlerts : [criticalAlerts[1]?.alert_id].filter(Boolean),
      notes: [
        {
          investigator: 'investigator',
          text: 'Multiple sub-threshold cash deposits aggregating into Metro Aggregate Funds within 45 minutes.',
          timestamp: new Date().toISOString()
        }
      ],
      evidence: [],
      createdAt: new Date('2026-01-14T01:00:00Z').toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      case_id: 'CASE1003',
      title: 'Offshore Shell Capital Flight (Luxembourg & UAE)',
      assigned_to: 'admin',
      status: 'Open',
      alerts: [highAlerts[0]?.alert_id, highAlerts[1]?.alert_id].filter(Boolean),
      notes: [
        {
          investigator: 'admin',
          text: 'High-value transfers into non-resident corporate accounts without documented commercial trade backing.',
          timestamp: new Date().toISOString()
        }
      ],
      evidence: [],
      createdAt: new Date('2026-01-12T10:00:00Z').toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      case_id: 'CASE1004',
      title: 'Unusual Nocturnal Wire Surge Investigation',
      assigned_to: 'investigator',
      status: 'Closed',
      alerts: [mediumAlerts[0]?.alert_id, mediumAlerts[1]?.alert_id].filter(Boolean),
      notes: [
        {
          investigator: 'investigator',
          text: 'Investigated nocturnal velocity spikes. Client provided verified commercial vendor payment invoices.',
          timestamp: new Date().toISOString()
        }
      ],
      evidence: [],
      createdAt: new Date('2026-01-08T12:00:00Z').toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  // Realistic Audit Logs
  const auditLogsToInsert = [
    { username: 'admin', role: 'Admin', action: 'SYSTEM_BOOTSTRAP', details: 'Initialized AML Compliance Database', ip_address: '127.0.0.1', timestamp: new Date(Date.now() - 86400000 * 2).toISOString() },
    { username: 'investigator', role: 'Investigator', action: 'CASE_CREATED', details: 'Created Case CASE1001 (Operation Hydra)', ip_address: '127.0.0.1', timestamp: new Date(Date.now() - 86400000).toISOString() },
    { username: 'investigator', role: 'Investigator', action: 'CASE_NOTE_ADDED', details: 'Added intelligence note to CASE1001', ip_address: '127.0.0.1', timestamp: new Date(Date.now() - 43200000).toISOString() },
    { username: 'admin', role: 'Admin', action: 'RULE_UPDATED', details: 'Calibrated threshold velocity alert sensitivity', ip_address: '127.0.0.1', timestamp: new Date(Date.now() - 21600000).toISOString() },
    { username: 'auditor', role: 'Auditor', action: 'CASE_REPORT_DOWNLOADED', details: 'Audited case dossier for CASE1004', ip_address: '127.0.0.1', timestamp: new Date(Date.now() - 3600000).toISOString() }
  ];

  console.log('\nWriting refined data to MongoDB Atlas collections...');
  
  // Clean and insert collections (Preserving 'users' collection!)
  await db.collection('transactions').deleteMany({});
  await db.collection('transactions').insertMany(processedTransactions);
  console.log(`✅ Saved ${processedTransactions.length} calibrated transactions.`);

  await db.collection('alerts').deleteMany({});
  await db.collection('alerts').insertMany(processedAlerts);
  console.log(`✅ Saved ${processedAlerts.length} calibrated alerts.`);

  await db.collection('cases').deleteMany({});
  await db.collection('cases').insertMany(casesToInsert);
  console.log(`✅ Saved ${casesToInsert.length} realistic investigation cases.`);

  await db.collection('auditlogs').deleteMany({});
  await db.collection('auditlogs').insertMany(auditLogsToInsert);
  console.log(`✅ Saved ${auditLogsToInsert.length} audit logs.`);

  // Print distribution summary
  const critCount = processedAlerts.filter(a => a.level === 'Critical').length;
  const highCount = processedAlerts.filter(a => a.level === 'High').length;
  const medCount = processedAlerts.filter(a => a.level === 'Medium').length;
  const lowCount = processedAlerts.filter(a => a.level === 'Low').length;

  console.log('\n====================================================');
  console.log('🎉 ATLAS DATABASE REFINEMENT COMPLETE!');
  console.log('====================================================');
  console.log(`Total Transactions: ${processedTransactions.length}`);
  console.log(`Clean Volume:       ${processedTransactions.filter(t => t.is_laundering === 0).length} (94%)`);
  console.log(`Suspicious Volume:  ${processedTransactions.filter(t => t.is_laundering === 1).length} (6%)`);
  console.log(`Alerts Generated:   ${processedAlerts.length}`);
  console.log(`  - Critical (≥80%): ${critCount}`);
  console.log(`  - High (60-79%):   ${highCount}`);
  console.log(`  - Medium (35-59%): ${medCount}`);
  console.log(`  - Low (20-34%):    ${lowCount}`);
  console.log('====================================================\n');

  await mongoose.disconnect();
}

refineDatabase().catch(err => {
  console.error('\n❌ Refinement failed:', err);
  process.exit(1);
});
