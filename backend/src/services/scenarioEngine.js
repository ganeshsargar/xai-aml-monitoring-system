/**
 * FundTraceAI Configurable AML Scenario & Rule Engine.
 *
 * Architecture Justification:
 * Evaluated directly in the backend ingestion pipeline (Node.js) for sub-millisecond execution,
 * native access to the customer entity graph (cross-account customer structuring), and high availability
 * independent of ML service state. Fuses deterministic scenario rule hits with calibrated ML probabilities.
 *
 * Regulatory Compliance Note:
 * // verify against current rules (e.g. RBI Master Directions / FIU-IND Guidelines / PMLA 2002 / FATF Recommendations)
 */

const { models } = require('../config/db');
const {
  getCtrThreshold,
  getStructuringBounds,
  getHighRiskCountries,
  getHighRiskJurisdictions,
  getHighRiskPaymentMethods,
  getRiskConfig
} = require('../config/riskConfig');

// In-memory cache of active scenarios
let cachedScenarios = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10000; // 10 seconds

/**
 * Default Built-in Scenarios (Fallback if DB is empty or initializing)
 */
const BUILTIN_SCENARIOS = [
  {
    scenario_id: 'SCEN_STRUCTURING_MULTI_ACC',
    name: 'Structuring Across Customer Accounts',
    description: 'Detects multiple transactions across accounts owned by the same customer within rolling windows just below the CTR reporting threshold.',
    category: 'Structuring',
    severity: 'High',
    weight: 35,
    enabled: true,
    parameters: {
      window_days: 7,
      min_tx_count: 2,
      band_lower_pct: 80.0,
      band_upper_pct: 99.9,
      sum_threshold: 1000000.0
    },
    explanation_template: 'Customer {customer_id} transacted ₹{total_window_amount} across {account_count} linked account(s) within {window_days} days via {tx_count} transactions near CTR reporting threshold (₹{ctr_threshold}), indicating intentional structuring.'
  },
  {
    scenario_id: 'SCEN_RAPID_PASSTHROUGH',
    name: 'Rapid In-Out Pass-Through Flow',
    description: 'Identifies transit accounts where significant inbound funds are disbursed rapidly within hours.',
    category: 'FlowOfFunds',
    severity: 'High',
    weight: 30,
    enabled: true,
    parameters: {
      window_hours: 24,
      pass_through_ratio: 0.80,
      min_amount: 50000.0
    },
    explanation_template: 'Account {account_id} received ₹{inflow_amount} and subsequently disbursed ₹{outflow_amount} ({ratio_percent}% pass-through) within {time_diff_hours} hours, indicating transit/mule pass-through layering.'
  },
  {
    scenario_id: 'SCEN_ROUND_AMOUNTS',
    name: 'Repetitive Round-Amount Pattern',
    description: 'Flags transactions executed in exact, clean round amounts lacking economic commercial variance.',
    category: 'Behavioral',
    severity: 'Medium',
    weight: 20,
    enabled: true,
    parameters: {
      min_amount: 50000.0,
      modulus: 5000.0,
      min_consecutive_count: 2
    },
    explanation_template: 'Account {account_id} executed {round_count} consecutive round-amount transactions of ₹{amount} (divisible by ₹{modulus}), typical of informal hawala or pre-negotiated disbursements.'
  },
  {
    scenario_id: 'SCEN_DORMANT_REACTIVATION',
    name: 'Dormant Account Sudden Reactivation',
    description: 'Flags accounts dormant for extended periods that suddenly execute substantial transactions.',
    category: 'Behavioral',
    severity: 'High',
    weight: 30,
    enabled: true,
    parameters: {
      dormancy_days: 90,
      min_reactivation_amount: 50000.0
    },
    explanation_template: 'Account {account_id} was dormant for {dormant_days_actual} days (> {dormancy_days} threshold) and suddenly reactivated with an unexpected high-value transaction of ₹{amount}.'
  },
  {
    scenario_id: 'SCEN_CASH_INTENSITY',
    name: 'Cash Intensity Exceeding Behavioral Baseline',
    description: 'Monitors elevated cash deposit or withdrawal ratios relative to historical and peer baseline activity.',
    category: 'Behavioral',
    severity: 'High',
    weight: 25,
    enabled: true,
    parameters: {
      window_days: 30,
      min_cash_volume: 200000.0,
      cash_ratio_threshold: 0.50,
      baseline_multiplier: 2.0,
      cash_methods: ['Cash Deposit', 'Cash Withdrawal', 'ATM']
    },
    explanation_template: 'Account {account_id} transacted ₹{cash_volume} in cash ({cash_ratio_percent}% of volume) over 30 days, exceeding customer\'s typical baseline by {multiplier}x.'
  },
  {
    scenario_id: 'SCEN_HIGH_RISK_GEO',
    name: 'High-Risk Geography with Elevated Volume',
    description: 'Detects transactions involving FATF-monitored or sanctioned offshore tax havens exceeding thresholds.',
    category: 'Geographic',
    severity: 'Critical',
    weight: 40,
    enabled: true,
    parameters: {
      min_amount: 100000.0,
      jurisdictions: [] // dynamically resolved from risk_config.json via getHighRiskCountries()
    },
    explanation_template: 'Transaction of ₹{amount} routed to/from high-risk monitored jurisdiction {country} ({country_label}), exceeding regulatory threshold of ₹{min_amount}.'
  },
  {
    scenario_id: 'SCEN_MANY_TO_ONE_FUNNEL',
    name: 'Many-to-One Funnel Deposit Aggregation',
    description: 'Detects funnel beneficiary accounts collecting multiple deposits from disparate originators.',
    category: 'Network',
    severity: 'High',
    weight: 35,
    enabled: true,
    parameters: {
      window_hours: 48,
      min_distinct_senders: 3,
      min_total_inflow: 100000.0
    },
    explanation_template: 'Beneficiary account {account_id} received funds from {distinct_senders_count} distinct senders totaling ₹{total_inflow} within {window_hours} hours, characteristic of funnel account smurfing aggregation.'
  }
];

/**
 * Loads scenarios from DB or returns cached/builtin fallback.
 */
async function getActiveScenarios(forceReload = false) {
  const now = Date.now();
  if (!forceReload && cachedScenarios && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedScenarios;
  }

  try {
    if (models.Scenario && models.Scenario.find) {
      const dbScenarios = await models.Scenario.find({ enabled: true });
      if (dbScenarios && dbScenarios.length > 0) {
        cachedScenarios = dbScenarios;
        lastCacheTime = now;
        return cachedScenarios;
      }
    }
  } catch (err) {
    console.warn(`[ScenarioEngine Warning]: Could not fetch scenarios from DB: ${err.message}. Using built-in.`);
  }

  cachedScenarios = BUILTIN_SCENARIOS.filter(s => s.enabled);
  lastCacheTime = now;
  return cachedScenarios;
}

/**
 * Invalidates scenario cache. Call on CRUD operations.
 */
function refreshScenarios() {
  cachedScenarios = null;
  lastCacheTime = 0;
}

/**
 * Replaces placeholders in template string with variable values.
 */
function renderExplanation(template, variables) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INDIVIDUAL SCENARIO DETECTORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Structuring Over Rolling Windows Across Customer Accounts
 */
async function detectStructuringMultiAcc(tx, params, context = {}) {
  const windowDays = Number(params.window_days || 7);
  const minTxCount = Number(params.min_tx_count || 2);
  const bandLowerPct = Number(params.band_lower_pct || 80.0);
  const bandUpperPct = Number(params.band_upper_pct || 99.9);
  const ctrThreshold = getCtrThreshold();
  const sumThreshold = Number(params.sum_threshold || ctrThreshold);

  const lowerBound = (ctrThreshold * bandLowerPct) / 100.0;
  const upperBound = (ctrThreshold * bandUpperPct) / 100.0;

  const txTime = new Date(tx.timestamp || Date.now()).getTime();
  const windowStartTime = new Date(txTime - windowDays * 24 * 60 * 60 * 1000);

  // 1. Resolve customer ID & linked accounts
  let customerId = tx.customer_id;
  let linkedAccounts = [tx.sender_account];

  if (context.customerAccountsMap && context.customerAccountsMap[tx.sender_account]) {
    customerId = context.customerAccountsMap[tx.sender_account].customer_id;
    linkedAccounts = context.customerAccountsMap[tx.sender_account].accounts;
  } else if (models.Account && models.Account.findOne) {
    try {
      const acc = await models.Account.findOne({ account_id: tx.sender_account });
      if (acc && acc.customer_id) {
        customerId = acc.customer_id;
        const allAccs = await models.Account.find({ customer_id: customerId });
        linkedAccounts = allAccs.map(a => a.account_id);
      }
    } catch (_) {}
  }

  // 2. Fetch or filter historical transactions across customer accounts
  let historyTxs = [];
  if (context.history) {
    historyTxs = context.history.filter(t => 
      linkedAccounts.includes(t.sender_account) && 
      new Date(t.timestamp).getTime() >= windowStartTime.getTime() &&
      new Date(t.timestamp).getTime() <= txTime
    );
  } else if (models.Transaction && models.Transaction.find) {
    try {
      historyTxs = await models.Transaction.find({
        sender_account: { $in: linkedAccounts },
        timestamp: { $gte: windowStartTime.toISOString(), $lte: new Date(txTime).toISOString() }
      });
    } catch (_) {}
  }

  // Ensure current transaction is in window set
  if (!historyTxs.some(t => t.transaction_id === tx.transaction_id)) {
    historyTxs.push(tx);
  }

  // Condition A: Individual transactions in the structuring band
  const bandHits = historyTxs.filter(t => {
    const amt = parseFloat(t.amount || 0);
    return amt >= lowerBound && amt <= upperBound;
  });

  // Condition B: Aggregated sum across customer accounts >= sum_threshold with tx amounts < CTR
  const totalWindowAmount = historyTxs.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
  const allSubCtr = historyTxs.every(t => parseFloat(t.amount || 0) < ctrThreshold);

  const isStructuring = (bandHits.length >= minTxCount) || 
                        (historyTxs.length >= minTxCount && allSubCtr && totalWindowAmount >= sumThreshold);

  if (!isStructuring) return null;

  return {
    hit: true,
    variables: {
      customer_id: customerId || 'CUST_RESOLVED',
      total_window_amount: Math.round(totalWindowAmount).toLocaleString('en-IN'),
      account_count: linkedAccounts.length,
      window_days: windowDays,
      tx_count: historyTxs.length,
      ctr_threshold: Math.round(ctrThreshold).toLocaleString('en-IN')
    }
  };
}

/**
 * 2. Rapid In-Out Pass-Through Flow
 */
async function detectRapidPassthrough(tx, params, context = {}) {
  const windowHours = Number(params.window_hours || 24);
  const passThroughRatio = Number(params.pass_through_ratio || 0.80);
  const minAmount = Number(params.min_amount || 50000.0);

  const txAmount = parseFloat(tx.amount || 0);
  if (txAmount < minAmount) return null;

  const txTime = new Date(tx.timestamp || Date.now()).getTime();
  const windowStartTime = new Date(txTime - windowHours * 60 * 60 * 1000);

  // Check recent inflows to sender_account
  let inflows = [];
  if (context.history) {
    inflows = context.history.filter(t => 
      t.receiver_account === tx.sender_account &&
      new Date(t.timestamp).getTime() >= windowStartTime.getTime() &&
      new Date(t.timestamp).getTime() <= txTime
    );
  } else if (models.Transaction && models.Transaction.find) {
    try {
      inflows = await models.Transaction.find({
        receiver_account: tx.sender_account,
        timestamp: { $gte: windowStartTime.toISOString(), $lte: new Date(txTime).toISOString() }
      });
    } catch (_) {}
  }

  if (!inflows || inflows.length === 0) return null;

  // Total recent inflow
  const totalInflow = inflows.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
  if (totalInflow < minAmount) return null;

  const ratio = txAmount / totalInflow;
  if (ratio < passThroughRatio) return null;

  // Calculate time diff from nearest inflow
  const nearestInflowTime = Math.max(...inflows.map(t => new Date(t.timestamp).getTime()));
  const timeDiffHours = Math.max(0.1, (txTime - nearestInflowTime) / (3600 * 1000));

  return {
    hit: true,
    variables: {
      account_id: tx.sender_account,
      inflow_amount: Math.round(totalInflow).toLocaleString('en-IN'),
      outflow_amount: Math.round(txAmount).toLocaleString('en-IN'),
      ratio_percent: Math.round(ratio * 100),
      time_diff_hours: timeDiffHours.toFixed(1)
    }
  };
}

/**
 * 3. Repetitive Round-Amount Pattern
 */
async function detectRoundAmounts(tx, params, context = {}) {
  const minAmount = Number(params.min_amount || 50000.0);
  const modulus = Number(params.modulus || 5000.0);
  const minConsecutiveCount = Number(params.min_consecutive_count || 2);

  const txAmount = parseFloat(tx.amount || 0);
  if (txAmount < minAmount) return null;
  if (txAmount % modulus !== 0) return null;

  const txTime = new Date(tx.timestamp || Date.now()).getTime();
  const windowStartTime = new Date(txTime - 7 * 24 * 60 * 60 * 1000); // 7-day lookback

  let prevTxs = [];
  if (context.history) {
    prevTxs = context.history.filter(t => 
      t.sender_account === tx.sender_account &&
      new Date(t.timestamp).getTime() >= windowStartTime.getTime() &&
      new Date(t.timestamp).getTime() < txTime
    );
  } else if (models.Transaction && models.Transaction.find) {
    try {
      prevTxs = await models.Transaction.find({
        sender_account: tx.sender_account,
        timestamp: { $gte: windowStartTime.toISOString(), $lt: new Date(txTime).toISOString() }
      });
    } catch (_) {}
  }

  // Count prior round amounts
  const priorRoundCount = prevTxs.filter(t => {
    const amt = parseFloat(t.amount || 0);
    return amt >= minAmount && amt % modulus === 0;
  }).length;

  const totalRoundCount = priorRoundCount + 1;
  if (totalRoundCount < minConsecutiveCount) return null;

  return {
    hit: true,
    variables: {
      account_id: tx.sender_account,
      round_count: totalRoundCount,
      amount: Math.round(txAmount).toLocaleString('en-IN'),
      modulus: Math.round(modulus).toLocaleString('en-IN')
    }
  };
}

/**
 * 4. Dormant Account Sudden Reactivation
 */
async function detectDormantReactivation(tx, params, context = {}) {
  const dormancyDays = Number(params.dormancy_days || 90);
  const minReactivationAmount = Number(params.min_reactivation_amount || 50000.0);

  const txAmount = parseFloat(tx.amount || 0);
  if (txAmount < minReactivationAmount) return null;

  const txTime = new Date(tx.timestamp || Date.now()).getTime();

  let prevTx = null;
  if (context.history) {
    const sorted = context.history
      .filter(t => t.sender_account === tx.sender_account && new Date(t.timestamp).getTime() < txTime)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    prevTx = sorted[0];
  } else if (models.Transaction && models.Transaction.findOne) {
    try {
      const results = await models.Transaction.find({
        sender_account: tx.sender_account,
        timestamp: { $lt: new Date(txTime).toISOString() }
      });
      if (results && results.length > 0) {
        results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        prevTx = results[0];
      }
    } catch (_) {}
  }

  let dormantDaysActual = 0;
  if (prevTx) {
    const prevTime = new Date(prevTx.timestamp).getTime();
    dormantDaysActual = Math.floor((txTime - prevTime) / (86400 * 1000));
  } else {
    // If no prior transaction, check account open date or creation date
    let openDate = tx.sender_account_open_date;
    if (!openDate && context.accountOpenDates && context.accountOpenDates[tx.sender_account]) {
      openDate = context.accountOpenDates[tx.sender_account];
    }
    if (openDate) {
      dormantDaysActual = Math.floor((txTime - new Date(openDate).getTime()) / (86400 * 1000));
    }
  }

  if (dormantDaysActual < dormancyDays) return null;

  return {
    hit: true,
    variables: {
      account_id: tx.sender_account,
      dormant_days_actual: dormantDaysActual,
      dormancy_days: dormancyDays,
      amount: Math.round(txAmount).toLocaleString('en-IN')
    }
  };
}

/**
 * 5. Cash Intensity Over Baseline
 */
async function detectCashIntensity(tx, params, context = {}) {
  const windowDays = Number(params.window_days || 30);
  const minCashVolume = Number(params.min_cash_volume || 200000.0);
  const cashRatioThreshold = Number(params.cash_ratio_threshold || 0.50);
  const baselineMultiplier = Number(params.baseline_multiplier || 2.0);
  const cashMethods = params.cash_methods || ['Cash Deposit', 'Cash Withdrawal', 'ATM'];

  const method = tx.payment_method || 'UPI';
  const isCashTx = cashMethods.some(m => method.toLowerCase().includes(m.toLowerCase()));
  if (!isCashTx) return null;

  const txAmount = parseFloat(tx.amount || 0);
  const txTime = new Date(tx.timestamp || Date.now()).getTime();
  const windowStartTime = new Date(txTime - windowDays * 24 * 60 * 60 * 1000);

  let windowTxs = [];
  if (context.history) {
    windowTxs = context.history.filter(t => 
      t.sender_account === tx.sender_account &&
      new Date(t.timestamp).getTime() >= windowStartTime.getTime() &&
      new Date(t.timestamp).getTime() <= txTime
    );
  } else if (models.Transaction && models.Transaction.find) {
    try {
      windowTxs = await models.Transaction.find({
        sender_account: tx.sender_account,
        timestamp: { $gte: windowStartTime.toISOString(), $lte: new Date(txTime).toISOString() }
      });
    } catch (_) {}
  }

  if (!windowTxs.some(t => t.transaction_id === tx.transaction_id)) {
    windowTxs.push(tx);
  }

  const totalVolume = windowTxs.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
  const cashTxs = windowTxs.filter(t => 
    cashMethods.some(m => (t.payment_method || '').toLowerCase().includes(m.toLowerCase()))
  );
  const cashVolume = cashTxs.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  if (cashVolume < minCashVolume) return null;

  const cashRatio = cashVolume / (totalVolume || 1);
  if (cashRatio < cashRatioThreshold) return null;

  // Retrieve customer baseline or default
  const declaredIncome = parseFloat(tx.sender_declared_income || 75000);
  const expectedMonthlyCash = declaredIncome * 0.25; // 25% typical cash baseline
  const multiplier = cashVolume / (expectedMonthlyCash || 1);

  if (multiplier < baselineMultiplier && cashVolume < minCashVolume * 1.5) return null;

  return {
    hit: true,
    variables: {
      account_id: tx.sender_account,
      cash_volume: Math.round(cashVolume).toLocaleString('en-IN'),
      cash_ratio_percent: Math.round(cashRatio * 100),
      multiplier: multiplier.toFixed(1)
    }
  };
}

/**
 * 6. High-Risk Geography with Large Amounts
 */
async function detectHighRiskGeo(tx, params, context = {}) {
  const minAmount = Number(params.min_amount || 100000.0);
  const txAmount = parseFloat(tx.amount || 0);
  if (txAmount < minAmount) return null;

  const txCountry = (tx.country || '').trim().toUpperCase();
  if (!txCountry || txCountry === 'IN') return null;

  const jurisdictions = (Array.isArray(params.jurisdictions) && params.jurisdictions.length > 0)
    ? params.jurisdictions 
    : getHighRiskCountries();
  const isHighRisk = jurisdictions.some(j => j.toUpperCase() === txCountry);
  if (!isHighRisk) return null;

  const dict = getHighRiskJurisdictions();
  const label = dict[txCountry]?.label || dict[txCountry]?.name || 'Monitored Jurisdiction';

  return {
    hit: true,
    variables: {
      account_id: tx.sender_account,
      amount: Math.round(txAmount).toLocaleString('en-IN'),
      country: txCountry,
      country_label: label,
      min_amount: Math.round(minAmount).toLocaleString('en-IN')
    }
  };
}

/**
 * 7. Many-to-One Funnel Deposit Aggregation
 */
async function detectManyToOneFunnel(tx, params, context = {}) {
  const windowHours = Number(params.window_hours || 48);
  const minDistinctSenders = Number(params.min_distinct_senders || 3);
  const minTotalInflow = Number(params.min_total_inflow || 100000.0);

  const txTime = new Date(tx.timestamp || Date.now()).getTime();
  const windowStartTime = new Date(txTime - windowHours * 60 * 60 * 1000);
  const beneficiaryAccount = tx.receiver_account;

  if (!beneficiaryAccount) return null;

  let inflows = [];
  if (context.history) {
    inflows = context.history.filter(t => 
      t.receiver_account === beneficiaryAccount &&
      new Date(t.timestamp).getTime() >= windowStartTime.getTime() &&
      new Date(t.timestamp).getTime() <= txTime
    );
  } else if (models.Transaction && models.Transaction.find) {
    try {
      inflows = await models.Transaction.find({
        receiver_account: beneficiaryAccount,
        timestamp: { $gte: windowStartTime.toISOString(), $lte: new Date(txTime).toISOString() }
      });
    } catch (_) {}
  }

  if (!inflows.some(t => t.transaction_id === tx.transaction_id)) {
    inflows.push(tx);
  }

  const distinctSenders = new Set(inflows.map(t => t.sender_account).filter(s => s && s !== beneficiaryAccount));
  const totalInflow = inflows.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  if (distinctSenders.size < minDistinctSenders) return null;
  if (totalInflow < minTotalInflow) return null;

  return {
    hit: true,
    variables: {
      account_id: beneficiaryAccount,
      beneficiary: beneficiaryAccount,
      distinct_senders: distinctSenders.size,
      distinct_senders_count: distinctSenders.size,
      total_inflow: Math.round(totalInflow).toLocaleString('en-IN'),
      window_hours: windowHours
    }
  };
}

// Map scenario IDs to detector implementations
const DETECTOR_MAP = {
  SCEN_STRUCTURING_MULTI_ACC: detectStructuringMultiAcc,
  SCEN_RAPID_PASSTHROUGH: detectRapidPassthrough,
  SCEN_ROUND_AMOUNTS: detectRoundAmounts,
  SCEN_DORMANT_REACTIVATION: detectDormantReactivation,
  SCEN_CASH_INTENSITY: detectCashIntensity,
  SCEN_HIGH_RISK_GEO: detectHighRiskGeo,
  SCEN_MANY_TO_ONE_FUNNEL: detectManyToOneFunnel
};

// ─────────────────────────────────────────────────────────────────────────────
// EVALUATION PIPELINE & SCORE FUSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates a single transaction against all active scenarios.
 */
async function evaluateTransaction(tx, context = {}, mlScore = null, options = {}) {
  const scenarios = await getActiveScenarios();
  const ruleHits = [];
  const reasons = [];

  for (const scen of scenarios) {
    const detector = DETECTOR_MAP[scen.scenario_id];
    if (!detector) continue;

    try {
      const result = await detector(tx, scen.parameters || {}, context);
      if (result && result.hit) {
        const reasonText = renderExplanation(scen.explanation_template, result.variables || {});
        ruleHits.push({
          scenario_id: scen.scenario_id,
          name: scen.name,
          category: scen.category,
          severity: scen.severity,
          weight: Number(scen.weight || 25),
          reason: reasonText,
          variables: result.variables
        });
        reasons.push(reasonText);
      }
    } catch (err) {
      console.error(`[ScenarioEngine Error in ${scen.scenario_id}]: ${err.message}`);
    }
  }

  // Calculate raw rule score
  const severityWeights = { Critical: 40, High: 25, Medium: 15, Low: 8 };
  let rawRuleScore = 0;
  for (const hit of ruleHits) {
    rawRuleScore += hit.weight != null ? Number(hit.weight) : (severityWeights[hit.severity] || 15);
  }
  const ruleScore = Math.min(100, rawRuleScore);

  const res = {
    rule_hits: ruleHits,
    rule_score: ruleScore,
    reasons
  };

  if (mlScore != null) {
    const fusion = calculateFusedRiskScore(mlScore, ruleHits, options);
    res.fused_score = fusion.final_risk_score;
    res.final_risk_score = fusion.final_risk_score;
    res.ml_score = fusion.ml_score;
    res.score_breakdown = fusion.score_breakdown;
  }

  return res;
}

/**
 * Evaluates a batch of transactions (e.g. from CSV upload).
 * Preserves chronological order and builds shared history context.
 */
async function evaluateBatch(transactions, context = {}) {
  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const sharedHistory = context.history ? [...context.history] : [];
  const evaluatedTxs = [];

  for (const tx of sortedTxs) {
    const evalRes = await evaluateTransaction(tx, {
      ...context,
      history: sharedHistory
    });

    const enriched = {
      ...tx,
      rule_hits: evalRes.rule_hits,
      rule_score: evalRes.rule_score,
      rule_reasons: evalRes.reasons
    };

    evaluatedTxs.push(enriched);
    sharedHistory.push(tx);
  }

  return evaluatedTxs;
}

/**
 * Transparent Score Fusion Formula
 * Combines ML score (0-100) and Rule Score (0-100) with configurable weights.
 * Supports:
 * - calculateFusedRiskScore(mlScore, ruleHits, options)
 * - calculateFusedRiskScore(mlScore, ruleScore, ruleHits, options)
 */
function calculateFusedRiskScore(mlProbabilityOrScore, arg2 = [], arg3 = {}, arg4 = {}) {
  let mlScore = 0;
  if (typeof mlProbabilityOrScore === 'number' && !isNaN(mlProbabilityOrScore)) {
    mlScore = mlProbabilityOrScore <= 1.0 ? mlProbabilityOrScore * 100.0 : mlProbabilityOrScore;
  }
  mlScore = Math.min(100, Math.max(0, mlScore));

  let ruleHits = [];
  let ruleScore = 0;
  let options = {};
  let explicitRuleScore = null;

  if (typeof arg2 === 'number') {
    explicitRuleScore = arg2;
    ruleHits = Array.isArray(arg3) ? arg3 : [];
    options = (typeof arg3 === 'object' && !Array.isArray(arg3)) ? arg3 : (arg4 || {});
  } else if (Array.isArray(arg2)) {
    ruleHits = arg2;
    options = arg3 || {};
  } else if (typeof arg2 === 'object' && arg2 !== null) {
    options = arg2;
  }

  const severityDefaults = { Critical: 40, High: 25, Medium: 15, Low: 8 };
  let rawRuleScore = 0;
  let hasCriticalHit = false;

  for (const hit of ruleHits) {
    const w = hit.weight != null ? Number(hit.weight) : (severityDefaults[hit.severity] || 15);
    rawRuleScore += w;
    if (hit.severity === 'Critical') {
      hasCriticalHit = true;
    }
  }

  if (explicitRuleScore !== null) {
    ruleScore = Math.min(100, Math.max(0, explicitRuleScore));
  } else {
    ruleScore = Math.min(100, rawRuleScore);
  }

  // Load weights from options or risk configuration
  const riskCfg = getRiskConfig();
  const cfgWeights = riskCfg.scoring_weights || {};

  const mlWeight = options.ml_weight != null ? Number(options.ml_weight) : Number(cfgWeights.ml_weight ?? 0.50);
  const ruleWeight = options.rule_weight != null ? Number(options.rule_weight) : Number(cfgWeights.rule_weight ?? 0.50);
  const criticalFloor = options.critical_floor != null ? Number(options.critical_floor) : Number(cfgWeights.critical_rule_floor ?? 75.0);

  let fusedRaw = (mlWeight * mlScore) + (ruleWeight * ruleScore);
  let floorApplied = false;

  // Critical regulatory override
  if (hasCriticalHit && fusedRaw < criticalFloor) {
    fusedRaw = criticalFloor;
    floorApplied = true;
  }

  const finalScore = Math.min(99, Math.max(0, Math.round(fusedRaw)));
  const formula = `${mlWeight.toFixed(2)} * ML(${Math.round(mlScore)}) + ${ruleWeight.toFixed(2)} * Rules(${Math.round(ruleScore)}) = ${Math.round(fusedRaw)}`;

  const breakdown = {
    ml_score: Math.round(mlScore * 10) / 10,
    rule_score: Math.round(ruleScore * 10) / 10,
    ml_weight: mlWeight,
    rule_weight: ruleWeight,
    critical_override: floorApplied,
    critical_floor_applied: floorApplied,
    has_critical_hit: hasCriticalHit,
    formula: `Final = ${formula}`
  };

  return {
    final_risk_score: finalScore,
    fused_score: finalScore,
    ml_score: Math.round(mlScore * 10) / 10,
    rule_score: Math.round(ruleScore * 10) / 10,
    rule_hits_count: ruleHits.length,
    critical_override: floorApplied,
    formula: `Final = ${formula}`,
    score_breakdown: breakdown
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORICAL BACK-TESTING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a scenario over historical transactions with candidate parameter tuning.
 */
async function runBacktest(scenarioId, candidateParams = {}, options = {}) {
  const detector = DETECTOR_MAP[scenarioId];
  if (!detector) {
    throw new Error(`Unknown scenario detector identifier: ${scenarioId}`);
  }

  // 1. Fetch historical transactions
  const limit = Math.min(Number(options.limit || 5000), 20000);
  const query = {};

  if (options.date_range && options.date_range.start) {
    query.timestamp = { $gte: options.date_range.start };
    if (options.date_range.end) {
      query.timestamp.$lte = options.date_range.end;
    }
  }

  let txList = [];
  if (models.Transaction && models.Transaction.find) {
    txList = await models.Transaction.find(query);
  }

  if (!txList || txList.length === 0) {
    return {
      scenario_id: scenarioId,
      parameters_tested: candidateParams,
      total_evaluated: 0,
      hit_count: 0,
      hit_rate: 0.0,
      metrics: null,
      sample_hits: []
    };
  }

  // Sort chronological
  txList.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (txList.length > limit) {
    txList = txList.slice(0, limit);
  }

  // 2. Evaluate across historical set
  const history = [];
  let hitCount = 0;
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const sampleHits = [];

  const hasLabels = txList.some(t => t.is_laundering !== undefined && t.is_laundering !== null);

  for (const tx of txList) {
    const res = await detector(tx, candidateParams, { history });
    const isHit = Boolean(res && res.hit);
    const label = Number(tx.is_laundering || 0);

    if (isHit) {
      hitCount++;
      if (sampleHits.length < 10) {
        sampleHits.push({
          transaction_id: tx.transaction_id,
          amount: tx.amount,
          sender_account: tx.sender_account,
          receiver_account: tx.receiver_account,
          timestamp: tx.timestamp,
          is_laundering: label,
          variables: res.variables
        });
      }
      if (label === 1) tp++;
      else fp++;
    } else {
      if (label === 1) fn++;
      else tn++;
    }

    history.push(tx);
  }

  const hitRate = txList.length > 0 ? (hitCount / txList.length) : 0;
  let metrics = null;

  if (hasLabels) {
    const precision = (tp + fp) > 0 ? (tp / (tp + fp)) : 0.0;
    const recall = (tp + fn) > 0 ? (tp / (tp + fn)) : 0.0;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall / (precision + recall)) : 0.0;

    metrics = {
      true_positives: tp,
      false_positives: fp,
      false_negatives: fn,
      true_negatives: tn,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1_score: Math.round(f1 * 1000) / 1000
    };
  }

  return {
    scenario_id: scenarioId,
    parameters_tested: candidateParams,
    total_evaluated: txList.length,
    hit_count: hitCount,
    hit_rate: Math.round(hitRate * 10000) / 100, // percentage
    has_labels: hasLabels,
    metrics,
    sample_hits: sampleHits
  };
}

module.exports = {
  BUILTIN_SCENARIOS,
  getActiveScenarios,
  refreshScenarios,
  renderExplanation,
  evaluateTransaction,
  evaluateBatch,
  calculateFusedRiskScore,
  runBacktest,
  // Individual detector exports for direct testing
  detectors: {
    detectStructuringMultiAcc,
    detectRapidPassthrough,
    detectRoundAmounts,
    detectDormantReactivation,
    detectCashIntensity,
    detectHighRiskGeo,
    detectManyToOneFunnel
  }
};
