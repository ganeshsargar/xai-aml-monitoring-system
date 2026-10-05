const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const { models } = require('../config/db');
const screeningService = require('../services/screeningService');

// Peer benchmarks for demographic comparison
const PEER_BENCHMARKS = {
  individual_low: { median: 2500, p90: 10000, max_expected: 25000 },
  individual_mid: { median: 8000, p90: 35000, max_expected: 80000 },
  individual_high: { median: 25000, p90: 150000, max_expected: 350000 },
  individual_affluent: { median: 75000, p90: 500000, max_expected: 1200000 },
  business_micro: { median: 30000, p90: 200000, max_expected: 500000 },
  business_sme: { median: 150000, p90: 1500000, max_expected: 4000000 },
  business_corporate: { median: 800000, p90: 8000000, max_expected: 25000000 }
};

function getPeerKey(type, declaredIncome) {
  const isBiz = String(type || '').toLowerCase().includes('biz') || String(type || '').toLowerCase().includes('business');
  const inc = parseFloat(declaredIncome || 0);
  if (isBiz) {
    if (inc < 1000000) return 'business_micro';
    if (inc < 10000000) return 'business_sme';
    return 'business_corporate';
  } else {
    if (inc < 50000) return 'individual_low';
    if (inc < 150000) return 'individual_mid';
    if (inc < 500000) return 'individual_high';
    return 'individual_affluent';
  }
}

/**
 * Ensures Customer and Account collections have initial data from dataset CSVs.
 */
async function ensureCustomerSeed() {
  try {
    const custCount = await models.Customer.countDocuments({});
    if (custCount > 0) return;

    const datasetDir = path.join(__dirname, '..', '..', '..', 'dataset');
    const custCsvPath = path.join(datasetDir, 'customers.csv');
    const accCsvPath = path.join(datasetDir, 'accounts.csv');

    if (!fs.existsSync(custCsvPath) || !fs.existsSync(accCsvPath)) return;

    // Load customers
    const rawCustomers = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(custCsvPath)
        .pipe(csv())
        .on('data', (row) => rawCustomers.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    const custDocs = rawCustomers.map(r => ({
      customer_id: r.customer_id || `CUST_${r.account_number}`,
      name: r.name || r.customer_name || 'Customer',
      type: (r.type && r.type.toLowerCase().includes('biz')) ? 'business' : 'individual',
      occupation_or_business_type: r.occupation_or_business_type || r.occupation || 'General',
      declared_monthly_income_or_turnover: parseFloat(r.declared_monthly_income_or_turnover || 75000),
      kyc_risk_rating: r.kyc_risk_rating || r.risk_tier || 'Low',
      is_pep: r.is_pep === '1' || r.is_pep === 1 || r.is_pep === true,
      onboarding_date: r.onboarding_date || r.account_created_at || new Date().toISOString(),
      country_of_residence: r.country_of_residence || 'IN',
      beneficial_owner_ids: r.beneficial_owner_ids ? String(r.beneficial_owner_ids).split(',').filter(Boolean) : []
    }));

    if (models.Customer.insertMany) {
      await models.Customer.insertMany(custDocs);
    } else {
      for (const d of custDocs) await models.Customer.create(d);
    }

    // Load accounts
    const rawAccounts = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(accCsvPath)
        .pipe(csv())
        .on('data', (row) => rawAccounts.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    const accDocs = rawAccounts.map(r => ({
      account_id: r.account_id || r.acc_number,
      customer_id: r.customer_id,
      open_date: r.open_date || new Date().toISOString(),
      product_type: r.product_type || 'savings'
    }));

    if (models.Account.insertMany) {
      await models.Account.insertMany(accDocs);
    } else {
      for (const d of accDocs) await models.Account.create(d);
    }

    console.log(`[Customer Seeder] Seeded ${custDocs.length} customers and ${accDocs.length} accounts.`);
  } catch (err) {
    console.warn('[Customer Seeder Warning]:', err.message);
  }
}

/**
 * GET /api/customers
 * List customers with risk profile, linked account count, total volume, and alert count.
 */
exports.getCustomers = async (req, res) => {
  try {
    await ensureCustomerSeed();

    const page = parseInt(req.query.page || 1);
    const limit = Math.min(100, parseInt(req.query.limit || 20));
    const search = (req.query.search || '').trim().toLowerCase();
    const riskRating = req.query.risk_rating;
    const type = req.query.type;

    let allCustomers = await models.Customer.find({});

    // Filter
    if (search) {
      allCustomers = allCustomers.filter(c => 
        (c.customer_id && c.customer_id.toLowerCase().includes(search)) ||
        (c.name && c.name.toLowerCase().includes(search)) ||
        (c.occupation_or_business_type && c.occupation_or_business_type.toLowerCase().includes(search))
      );
    }
    if (riskRating && riskRating !== 'All') {
      allCustomers = allCustomers.filter(c => c.kyc_risk_rating === riskRating);
    }
    if (type && type !== 'All') {
      allCustomers = allCustomers.filter(c => c.type === type);
    }

    const total = allCustomers.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = allCustomers.slice((page - 1) * limit, page * limit);

    // Enrich paginated customers with accounts and quick volume/alert counts
    const customerIds = paginated.map(c => c.customer_id);
    const allAccounts = await models.Account.find({ customer_id: { $in: customerIds } });
    const accByCust = {};
    for (const a of allAccounts) {
      if (!accByCust[a.customer_id]) accByCust[a.customer_id] = [];
      accByCust[a.customer_id].push(a.account_id);
    }

    const enriched = paginated.map(c => {
      const doc = c.toObject ? c.toObject() : (c._doc || c);
      const accList = accByCust[doc.customer_id] || [];
      return {
        ...doc,
        account_count: accList.length,
        accounts: accList
      };
    });

    return res.json({
      success: true,
      total,
      page,
      limit,
      total_pages: totalPages,
      data: enriched
    });
  } catch (err) {
    console.error('[Customer List Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/customers/:id
 * Full Customer 360: Profile, baselines, risk summary, linked accounts, transactions, alerts, cases.
 */
exports.getCustomerById = async (req, res) => {
  try {
    await ensureCustomerSeed();

    const id = req.params.id;
    let customer = await models.Customer.findOne({ customer_id: id });
    if (!customer) {
      customer = await models.Customer.findById(id);
    }
    if (!customer) {
      // Check if this ID is an account ID, then find customer
      const linkedAcc = await models.Account.findOne({ account_id: id });
      if (linkedAcc) {
        customer = await models.Customer.findOne({ customer_id: linkedAcc.customer_id });
      }
    }

    if (!customer) {
      return res.status(404).json({ success: false, error: `Customer not found with identifier: ${id}` });
    }

    const custId = customer.customer_id;

    // 1. Linked Accounts
    let accounts = await models.Account.find({ customer_id: custId });
    if (!accounts || accounts.length === 0) {
      // Create fallback account if none exists
      accounts = [{
        account_id: `ACC_${custId}`,
        customer_id: custId,
        open_date: customer.onboarding_date || new Date().toISOString(),
        product_type: customer.type === 'business' ? 'business_current' : 'savings'
      }];
    }
    const accIds = accounts.map(a => a.account_id);

    // 2. Transactions
    const transactions = await models.Transaction.find({
      $or: [
        { sender_account: { $in: accIds } },
        { receiver_account: { $in: accIds } }
      ]
    });

    // Sort transactions by timestamp descending
    transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 3. Alerts
    const txIds = transactions.map(t => t.transaction_id);
    const alerts = await models.Alert.find({ transaction_id: { $in: txIds } });

    // 4. Cases
    const alertIds = alerts.map(a => a.alert_id);
    const allCases = await models.Case.find({});
    const linkedCases = allCases.filter(c => 
      c.alerts && c.alerts.some(aId => alertIds.includes(aId))
    );

    // 5. Baselines Computation
    const amounts = transactions.map(t => parseFloat(t.amount || 0));
    amounts.sort((a, b) => a - b);
    const medianAmount = amounts.length > 0 ? (
      amounts.length % 2 === 0 
        ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2 
        : amounts[Math.floor(amounts.length / 2)]
    ) : 0;

    const meanAmount = amounts.length > 0 ? (amounts.reduce((a, b) => a + b, 0) / amounts.length) : 0;
    const stdAmount = amounts.length > 1 ? Math.sqrt(
      amounts.reduce((sum, val) => sum + Math.pow(val - meanAmount, 2), 0) / amounts.length
    ) : 0;

    // Rolling 30-day volume
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const recentSentTxs = transactions.filter(t => 
      accIds.includes(t.sender_account) && new Date(t.timestamp) >= thirtyDaysAgo
    );
    const monthlyVolume = recentSentTxs.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const declaredIncome = parseFloat(customer.declared_monthly_income_or_turnover || 75000);
    const volumeVsDeclaredRatio = roundTo(monthlyVolume / (declaredIncome + 1), 2);

    // Habitual countries & hours
    const countriesSet = new Set();
    const hoursSet = new Set();
    const counterpartiesSet = new Set();

    for (const t of transactions) {
      if (t.country) countriesSet.add(t.country);
      if (t.timestamp) hoursSet.add(new Date(t.timestamp).getHours());
      if (accIds.includes(t.sender_account) && t.receiver_account && !accIds.includes(t.receiver_account)) {
        counterpartiesSet.add(t.receiver_account);
      }
      if (accIds.includes(t.receiver_account) && t.sender_account && !accIds.includes(t.sender_account)) {
        counterpartiesSet.add(t.sender_account);
      }
    }

    const peerKey = getPeerKey(customer.type, declaredIncome);
    const peerBench = PEER_BENCHMARKS[peerKey] || PEER_BENCHMARKS.individual_mid;

    // 6. Risk Summary
    let maxRiskScore = 0;
    for (const t of transactions) {
      if (t.risk_score && t.risk_score > maxRiskScore) maxRiskScore = t.risk_score;
    }

    const criticalCount = alerts.filter(a => a.level === 'Critical').length;
    const highCount = alerts.filter(a => a.level === 'High').length;
    const medCount = alerts.filter(a => a.level === 'Medium').length;
    const lowCount = alerts.filter(a => a.level === 'Low').length;

    const riskFactors = [];
    if (volumeVsDeclaredRatio > 2.0) riskFactors.push(`Transaction volume exceeds declared income by ${volumeVsDeclaredRatio}x`);
    if (customer.is_pep) riskFactors.push('Customer is a Politically Exposed Person (PEP)');
    if (alerts.length > 0) riskFactors.push(`${alerts.length} AML compliance alert(s) on linked accounts`);
    if (countriesSet.has('KP') || countriesSet.has('IR') || countriesSet.has('MM')) riskFactors.push('Transactions in high-risk jurisdiction');

    const peerPercentileEstimate = Math.min(0.99, Math.max(0.1, (monthlyVolume / (peerBench.p90 || 1)) * 0.9));

    const riskSummary = {
      overall_risk_score: maxRiskScore,
      kyc_risk_rating: customer.kyc_risk_rating,
      is_pep: Boolean(customer.is_pep),
      alerts_count: alerts.length,
      critical_alerts: criticalCount,
      high_alerts: highCount,
      medium_alerts: medCount,
      low_alerts: lowCount,
      is_profile_deviating: volumeVsDeclaredRatio > 2.0 || maxRiskScore >= 65,
      volume_to_income_ratio: volumeVsDeclaredRatio,
      peer_percentile_estimate: roundTo(peerPercentileEstimate, 2),
      risk_factors: riskFactors
    };

    const baseline = {
      median_amount: Math.round(medianAmount),
      rolling_median_amount: Math.round(medianAmount),
      std_amount: Math.round(stdAmount),
      rolling_std_amount: Math.round(stdAmount),
      mean_amount: Math.round(meanAmount),
      typical_monthly_volume: Math.round(monthlyVolume),
      declared_income: declaredIncome,
      volume_vs_declared_ratio: volumeVsDeclaredRatio,
      usual_countries: Array.from(countriesSet),
      usual_hours: Array.from(hoursSet).sort((a, b) => a - b),
      counterparties_count: counterpartiesSet.size,
      peer_group: {
        key: peerKey,
        median_amount: peerBench.median,
        peer_median_volume: peerBench.median,
        p90_amount: peerBench.p90,
        peer_q75_volume: peerBench.p90,
        max_expected: peerBench.max_expected
      }
    };

    // 6. Name Screening on Customer Profile & Beneficial Owners
    const screeningRes = await screeningService.screenName(customer.name);
    let customerDecisions = [];
    if (models.ScreeningDecision && models.ScreeningDecision.find) {
      customerDecisions = await models.ScreeningDecision.find({
        $or: [{ entity_id: custId }, { screened_name: customer.name }]
      });
    }

    const screening = {
      hits: screeningRes.hits,
      active_hits: screeningRes.active_hits,
      matched: screeningRes.matched,
      highest_score: screeningRes.highest_score,
      decisions: customerDecisions
    };

    const responsePayload = {
      profile: customer,
      customer,
      accounts,
      baselines: baseline,
      baseline,
      risk_summary: riskSummary,
      screening,
      transactions_count: transactions.length,
      recent_transactions: transactions.slice(0, 30),
      alerts: alerts.slice(0, 20),
      cases: linkedCases
    };

    return res.json({
      success: true,
      data: responsePayload,
      ...responsePayload
    });
  } catch (err) {
    console.error('[Customer 360 Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/customers
 * Onboard customer with real-time name screening
 */
exports.createCustomer = async (req, res) => {
  try {
    const data = req.body;
    if (!data.name) {
      return res.status(400).json({ success: false, error: 'Customer name is required.' });
    }
    const custId = data.customer_id || `CUST_${Date.now()}`;
    const screeningRes = await screeningService.screenName(data.name);

    const hasSanction = screeningRes.hits.some(h => h.list_type === 'Sanctions');
    const hasPep = screeningRes.hits.some(h => h.list_type === 'PEP');

    const newCust = await models.Customer.create({
      customer_id: custId,
      name: data.name,
      type: data.type || 'individual',
      occupation_or_business_type: data.occupation || data.occupation_or_business_type || 'General',
      declared_monthly_income_or_turnover: Number(data.declared_income || data.declared_monthly_income_or_turnover || 75000),
      kyc_risk_rating: data.kyc_risk_rating || (hasSanction ? 'High' : (hasPep ? 'Med' : 'Low')),
      is_pep: data.is_pep != null ? Boolean(data.is_pep) : hasPep,
      country_of_residence: data.country || data.country_of_residence || 'IN',
      beneficial_owner_ids: data.beneficial_owner_ids || [],
      screening_hits: screeningRes.hits,
      onboarding_date: new Date().toISOString()
    });

    return res.status(201).json({
      success: true,
      data: newCust,
      screening: screeningRes
    });
  } catch (err) {
    console.error('[Customer Onboarding Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

function roundTo(num, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round((num + Number.EPSILON) * factor) / factor;
}
