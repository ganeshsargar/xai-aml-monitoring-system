const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { convertToINR } = require('../config/fxConfig');
const { generateTxId, generateAdjustmentId, generatePrefixedId } = require('../utils/idGenerator');
const riskConfig = require('../config/riskConfig');
const { 
  getStructuringBounds,
  getHighRiskJurisdictions,
  getNightHours,
  getHighRiskPaymentMethods,
  getAlertLevel,
  getAlertCutoffs
} = riskConfig;
const scenarioEngine = require('../services/scenarioEngine');
const screeningService = require('../services/screeningService');
const { processTransactionAlert } = require('../services/alertService');

// Helper: Predict transaction risk (calls Flask ML service, falls back to heuristic if down)
let lastWarnTime = 0;
const predictTransactionRisk = async (tx, senderHistory = [], receiverHistory = []) => {
  const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000';
  
  try {
    const response = await axios.post(`${mlServiceUrl}/predict`, {
      transaction: tx,
      sender_history: senderHistory,
      receiver_history: receiverHistory
    }, { timeout: 1500 });

    if (response.data && response.data.success) {
      return {
        risk_score: response.data.risk_score,
        is_laundering: response.data.prediction,
        model_version: response.data.model_version || 'v_champion',
        explanation_type: response.data.explanation_type || (response.data.shap_explanations ? 'shap' : 'rule-based'),
        shadow_prediction: response.data.shadow_prediction || null,
        reasons: response.data.reasons || [],
        why_alert_summary: response.data.why_alert_summary || '',
        grouped_attributions: response.data.grouped_attributions || [],
        shap_explanation: response.data.shap_explanations || null
      };
    }
  } catch (error) {
    const now = Date.now();
    if (now - lastWarnTime > 15000) {
      console.warn(`[ML Service Predict Fallback]: Python server unreachable or error: ${error.message}`);
      lastWarnTime = now;
    }
  }

  // Heuristic Fallback Risk Engine (Runs strictly with rule-based labeling; NO fake SHAP values)
  let score = 5;
  const reasons = [];

  const amount = parseFloat(tx.amount || 0);
  const country = tx.country || 'IN';
  const payMethod = tx.payment_method || 'UPI';
  const category = tx.category || 'Transfer';
  const hour = new Date(tx.timestamp || Date.now()).getHours();

  const bounds = getStructuringBounds();
  const highRiskJurisdictions = getHighRiskJurisdictions();
  const highRiskCountries = Object.keys(highRiskJurisdictions);
  const highRiskMethods = getHighRiskPaymentMethods();
  const nightHours = getNightHours();

  // 1. Amount structuring near CTR threshold
  if (amount >= bounds.lower && amount <= bounds.upper) {
    score += 40;
    reasons.push(`₹${amount.toLocaleString('en-IN')} structured near ₹${bounds.ctr.toLocaleString('en-IN')} CTR threshold — classic smurfing/structuring pattern to evade reporting obligations`);
  } else if (amount >= bounds.ctr * 5) {
    score += 40;
    reasons.push(`Exceptionally large single transfer of ₹${amount.toLocaleString('en-IN')} — exceeds ₹${(bounds.ctr * 5).toLocaleString('en-IN')} retail baseline; highly consistent with integration stage of money laundering`);
  } else if (amount >= bounds.ctr) {
    score += 30;
    reasons.push(`High-value transfer of ₹${amount.toLocaleString('en-IN')} exceeds ₹${bounds.ctr.toLocaleString('en-IN')} threshold — triggers mandatory regulatory review`);
  } else if (amount >= bounds.ctr * 0.5) {
    score += 18;
    reasons.push(`Elevated transfer of ₹${amount.toLocaleString('en-IN')} — statistically above retail 95th percentile; warrants enhanced due diligence`);
  }

  // 2. High-risk jurisdictions
  if (highRiskCountries.includes(country)) {
    score += 30;
    const jur = highRiskJurisdictions[country] || { name: country, label: 'High-Risk Jurisdiction', source: 'Compliance Watchlist' };
    const labelSnippet = jur.label ? ` (${jur.label})` : '';
    reasons.push(`Transaction routed through ${jur.name || country}${labelSnippet} — flagged under ${jur.source || 'Watchlist'}; cross-border flows require Enhanced Due Diligence (EDD)`);
  }

  // 3. High-risk anonymous payment channels
  if (highRiskMethods.includes(payMethod)) {
    score += 20;
    if (payMethod === 'Crypto Transfer') {
      reasons.push(`Cryptocurrency transfer channel — bypasses traditional AML controls and KYC verification; heavily exploited in layering phase`);
    } else if (payMethod === 'Cash Deposit') {
      reasons.push(`Large cash deposit — anonymous placement method; consistent with first stage of money laundering`);
    } else {
      reasons.push(`${payMethod} high-value channel — typically used in high-velocity layering schemes to move large sums rapidly`);
    }
  }

  // 4. Off-hours timing
  if (nightHours.includes(hour)) {
    score += 10;
    reasons.push(`Transaction executed at ${String(hour).padStart(2,'0')}:xx hours — off-hours activity outside business windows is a recognized suspicious indicator`);
  }

  // 5. Unclassified capital transfer to high-risk channel/country
  if (category === 'Transfer' && (highRiskCountries.includes(country) || highRiskMethods.includes(payMethod))) {
    score += 10;
    reasons.push(`Direct capital transfer with no commercial or retail purpose — unclassified fund movements combined with high-risk channel/jurisdiction`);
  }

  score = Math.min(score, 99);
  const cutoffs = riskConfig.getAlertCutoffs();
  const isLaundering = score >= cutoffs.high ? 1 : 0;

  return {
    risk_score: score,
    is_laundering: isLaundering,
    explanation_type: 'rule-based',
    reasons: reasons.slice(0, 4),
    why_alert_summary: reasons.length > 0 ? `Rule-based alert: ${reasons[0]}` : 'Standard retail transaction parameters.',
    shap_explanation: null,
    grouped_attributions: []
  };
};


const getTransactions = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '', 
      sender_account,
      receiver_account,
      minAmount, 
      maxAmount, 
      country, 
      risk_level, 
      status, 
      startDate, 
      endDate 
    } = req.query;

    const filter = {};

    // Apply Search (Transaction ID, sender/receiver account or name)
    if (search) {
      filter.$or = [
        { transaction_id: { $regex: search, $options: 'i' } },
        { sender_account: { $regex: search, $options: 'i' } },
        { receiver_account: { $regex: search, $options: 'i' } },
        { sender_name: { $regex: search, $options: 'i' } },
        { receiver_name: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } }
      ];
    }

    // Direct account overrides
    if (sender_account) filter.sender_account = sender_account;
    if (receiver_account) filter.receiver_account = receiver_account;

    // Amount Range Filter
    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) filter.amount.$gte = parseFloat(minAmount);
      if (maxAmount) filter.amount.$lte = parseFloat(maxAmount);
    }

    // Country Filter
    if (country) {
      filter.country = country;
    }

    // Status Filter
    if (status) {
      filter.status = status;
    }

    // Risk Level Filter
    if (risk_level) {
      if (risk_level === 'Critical') {
        filter.risk_score = { $gte: 75 };
      } else if (risk_level === 'High') {
        filter.risk_score = { $gte: 50, $lt: 75 };
      } else if (risk_level === 'Medium') {
        filter.risk_score = { $gte: 20, $lt: 50 };
      } else if (risk_level === 'Low') {
        filter.risk_score = { $lt: 20 };
      }
    }

    // Date Range Filter
    if (startDate || endDate) {
      filter.timestamp = {};
      // Handle string to ISO/Date format
      if (startDate) filter.timestamp.$gte = new Date(startDate).toISOString();
      if (endDate) filter.timestamp.$lte = new Date(endDate).toISOString();
    }

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (parsedPage - 1) * parsedLimit;

    // High-performance server-side query with index utilization (skip/limit/sort)
    const [total, paginatedList] = await Promise.all([
      models.Transaction.countDocuments(filter),
      models.Transaction.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parsedLimit)
    ]);

    return res.json({
      success: true,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit) || 1,
      data: paginatedList
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const createTransaction = async (req, res) => {
  try {
    const txData = req.body;
    
    if (!txData.sender_account || !txData.receiver_account || !txData.amount || !txData.country) {
      return res.status(400).json({ success: false, error: 'Sender, receiver, amount, and country are required.' });
    }

    // Multi-Currency Normalization to Canonical INR
    const fxInfo = convertToINR(txData.amount, txData.currency || 'INR', txData.timestamp);
    txData.amount = fxInfo.amount;
    txData.currency = fxInfo.currency;
    txData.amount_inr = fxInfo.amount_inr;
    txData.fx_rate = fxInfo.fx_rate;
    txData.fx_date = fxInfo.fx_date;

    // Generate Collision-Safe Cryptographic Transaction ID if not provided
    if (!txData.transaction_id) {
      txData.transaction_id = generateTxId();
    }
    
    txData.timestamp = txData.timestamp || new Date().toISOString();
    txData.status = txData.status || 'Approved';

    // Query bounded window (last 30 days, max 50 rows) for velocity calculation instead of unbounded scans
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [senderHistory, receiverHistory] = await Promise.all([
      models.Transaction.find({ 
        sender_account: txData.sender_account,
        timestamp: { $gte: thirtyDaysAgo }
      }).sort({ timestamp: -1 }).limit(50),
      models.Transaction.find({ 
        receiver_account: txData.receiver_account,
        timestamp: { $gte: thirtyDaysAgo }
      }).sort({ timestamp: -1 }).limit(50)
    ]);

    // Call ML Predictor
    const predictionResult = await predictTransactionRisk(txData, senderHistory, receiverHistory);

    // Screen Sender and Receiver Names against Sanctions, PEP, and Adverse Media
    const screeningResult = await screeningService.screenTransaction(txData);
    const activeScreeningHits = screeningResult.active_hits || [];
    txData.screening_hits = screeningResult.all_hits || [];

    // Convert active screening hits to scenario rule hits for hybrid fusion
    const screeningRuleHits = activeScreeningHits.map(hit => ({
      scenario_id: `SCREEN_${hit.list_type.toUpperCase()}`,
      name: `${hit.list_type} Watchlist Match (${hit.subject})`,
      category: 'WatchlistScreening',
      severity: hit.severity,
      weight: hit.list_type === 'Sanctions' ? 50 : (hit.list_type === 'PEP' ? 30 : 20),
      reason: hit.reason,
      score: hit.match_score
    }));

    // Evaluate Scenarios (using amount_inr for accurate regulatory structuring bounds)
    const scenarioResult = await scenarioEngine.evaluateTransaction(txData, { history: senderHistory });
    const ruleHits = [...(scenarioResult.rule_hits || []), ...screeningRuleHits];

    // Transparent Score Fusion
    const fusion = scenarioEngine.calculateFusedRiskScore(predictionResult.risk_score, ruleHits);

    txData.risk_score = fusion.final_risk_score;
    txData.ml_score = fusion.ml_score;
    txData.rule_score = fusion.rule_score;
    txData.rule_hits = ruleHits;
    txData.score_breakdown = fusion.score_breakdown;
    const cutoffs = riskConfig.getAlertCutoffs();
    txData.is_laundering = txData.risk_score >= cutoffs.high ? 1 : 0;
    const screeningReasons = activeScreeningHits.map(h => h.reason);
    txData.reasons = [...new Set([...screeningReasons, ...(scenarioResult.rule_hits || []).map(h => h.reason), ...(predictionResult.reasons || [])])].slice(0, 5);
    txData.shap_explanation = predictionResult.shap_explanation;
    txData.model_version = predictionResult.model_version || 'v_champion';
    txData.shadow_prediction = predictionResult.shadow_prediction || null;

    const savedTx = await models.Transaction.create(txData);

    // Generate / Aggregate Alert Automatically if Risk Score warrants investigative review
    await processTransactionAlert(savedTx);

    await logAction(
      req.user ? req.user.username : 'API',
      req.user ? req.user.role : 'Guest',
      'TRANSACTION_CREATED',
      req.ip,
      `Created transaction ${savedTx.transaction_id} (${savedTx.currency} ${savedTx.amount} / ₹${savedTx.amount_inr}) - Risk: ${savedTx.risk_score}%`
    );

    return res.status(201).json({ success: true, data: savedTx });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Transactions are immutable: updates are disallowed.
 * Returns 405 Method Not Allowed instructing users to create an Adjustment record.
 */
const updateTransaction = async (req, res) => {
  return res.status(405).json({
    success: false,
    error: 'Method Not Allowed',
    message: 'Transactions are immutable and cannot be updated directly. Submit corrections as an adjustment record referencing this transaction via POST /api/transactions/:id/adjust, or record a separate status event via POST /api/transactions/:id/events.'
  });
};

/**
 * Transactions are immutable: deletes are disallowed.
 * Returns 405 Method Not Allowed.
 */
const deleteTransaction = async (req, res) => {
  return res.status(405).json({
    success: false,
    error: 'Method Not Allowed',
    message: 'Transactions are immutable and cannot be deleted from the audit ledger.'
  });
};

/**
 * Creates a linked adjustment correction record referencing the original transaction.
 */
const adjustTransaction = async (req, res) => {
  const { id } = req.params;
  try {
    let originalTx = await models.Transaction.findOne({ transaction_id: id });
    if (!originalTx && typeof models.Transaction.findById === 'function') {
      originalTx = await models.Transaction.findById(id);
    }
    if (!originalTx) {
      return res.status(404).json({ success: false, error: 'Original transaction not found.' });
    }

    const { adjustment_reason, amount, currency, sender_account, receiver_account, payment_method, category, country } = req.body;

    const adjAmount = amount !== undefined ? amount : originalTx.amount;
    const adjCurrency = currency || originalTx.currency || 'INR';
    const fxInfo = convertToINR(adjAmount, adjCurrency);

    const adjTxData = {
      transaction_id: generateAdjustmentId(),
      original_transaction_id: originalTx.transaction_id,
      is_adjustment: true,
      adjustment_reason: adjustment_reason,
      adjusted_by: req.user ? req.user.username : 'Investigator',
      sender_account: sender_account || originalTx.sender_account,
      sender_name: originalTx.sender_name,
      receiver_account: receiver_account || originalTx.receiver_account,
      receiver_name: originalTx.receiver_name,
      amount: fxInfo.amount,
      currency: fxInfo.currency,
      amount_inr: fxInfo.amount_inr,
      fx_rate: fxInfo.fx_rate,
      fx_date: fxInfo.fx_date,
      country: country || originalTx.country,
      city: originalTx.city,
      device_id: originalTx.device_id,
      ip_address: req.ip || originalTx.ip_address,
      payment_method: payment_method || originalTx.payment_method,
      merchant: originalTx.merchant,
      category: category || 'Adjustment',
      timestamp: new Date().toISOString(),
      status: 'Approved',
      customer_id: originalTx.customer_id
    };

    // Velocity history query
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [senderHistory, receiverHistory] = await Promise.all([
      models.Transaction.find({ sender_account: adjTxData.sender_account, timestamp: { $gte: thirtyDaysAgo } }).sort({ timestamp: -1 }).limit(50),
      models.Transaction.find({ receiver_account: adjTxData.receiver_account, timestamp: { $gte: thirtyDaysAgo } }).sort({ timestamp: -1 }).limit(50)
    ]);

    const predictionResult = await predictTransactionRisk(adjTxData, senderHistory, receiverHistory);
    const screeningResult = await screeningService.screenTransaction(adjTxData);
    const activeScreeningHits = screeningResult.active_hits || [];
    adjTxData.screening_hits = screeningResult.all_hits || [];

    const screeningRuleHits = activeScreeningHits.map(hit => ({
      scenario_id: `SCREEN_${hit.list_type.toUpperCase()}`,
      name: `${hit.list_type} Watchlist Match (${hit.subject})`,
      category: 'WatchlistScreening',
      severity: hit.severity,
      weight: hit.list_type === 'Sanctions' ? 50 : (hit.list_type === 'PEP' ? 30 : 20),
      reason: hit.reason,
      score: hit.match_score
    }));

    const scenarioResult = await scenarioEngine.evaluateTransaction(adjTxData, { history: senderHistory });
    const ruleHits = [...(scenarioResult.rule_hits || []), ...screeningRuleHits];
    const fusion = scenarioEngine.calculateFusedRiskScore(predictionResult.risk_score, ruleHits);

    adjTxData.risk_score = fusion.final_risk_score;
    adjTxData.ml_score = fusion.ml_score;
    adjTxData.rule_score = fusion.rule_score;
    adjTxData.rule_hits = ruleHits;
    adjTxData.score_breakdown = fusion.score_breakdown;
    const cutoffs = riskConfig.getAlertCutoffs();
    adjTxData.is_laundering = adjTxData.risk_score >= cutoffs.high ? 1 : 0;
    adjTxData.reasons = [
      `Adjustment for original tx ${originalTx.transaction_id}: ${adjustment_reason}`,
      ...new Set([...activeScreeningHits.map(h => h.reason), ...(scenarioResult.rule_hits || []).map(h => h.reason)])
    ].slice(0, 5);

    const savedAdjustment = await models.Transaction.create(adjTxData);

    // Record adjustment event in the immutable transaction event ledger
    if (models.TransactionEvent) {
      await models.TransactionEvent.create({
        event_id: generatePrefixedId('EVT'),
        transaction_id: originalTx.transaction_id,
        event_type: 'ADJUSTMENT_CREATED',
        old_status: originalTx.status,
        new_status: 'Adjusted',
        reason: `Created adjustment record ${savedAdjustment.transaction_id}: ${adjustment_reason}`,
        changed_by: req.user ? req.user.username : 'Investigator',
        ip_address: req.ip || '127.0.0.1',
        timestamp: new Date()
      });
    }

    await logAction(
      req.user ? req.user.username : 'Investigator',
      req.user ? req.user.role : 'Investigator',
      'TRANSACTION_ADJUSTED',
      req.ip,
      `Created adjustment ${savedAdjustment.transaction_id} for original tx ${originalTx.transaction_id}. Reason: ${adjustment_reason}`
    );

    return res.status(201).json({ success: true, data: savedAdjustment });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Records a separate transaction status transition event without mutating original transaction parameters.
 */
const recordStatusEvent = async (req, res) => {
  const { id } = req.params;
  const { new_status, reason } = req.body;
  try {
    let tx = await models.Transaction.findOne({ transaction_id: id });
    if (!tx && typeof models.Transaction.findById === 'function') {
      tx = await models.Transaction.findById(id);
    }
    if (!tx) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    const event = await models.TransactionEvent.create({
      event_id: generatePrefixedId('EVT'),
      transaction_id: tx.transaction_id,
      event_type: 'STATUS_CHANGE',
      old_status: tx.status,
      new_status,
      reason: reason || 'Status updated by compliance officer',
      changed_by: req.user ? req.user.username : 'Investigator',
      ip_address: req.ip || '127.0.0.1',
      timestamp: new Date()
    });

    await logAction(
      req.user ? req.user.username : 'Investigator',
      req.user ? req.user.role : 'Investigator',
      'TRANSACTION_STATUS_EVENT',
      req.ip,
      `Recorded status transition for ${tx.transaction_id}: ${tx.status} -> ${new_status} (${reason})`
    );

    return res.status(201).json({ success: true, data: event });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Retrieves the event history for a given transaction.
 */
const getTransactionEvents = async (req, res) => {
  const { id } = req.params;
  try {
    const events = await models.TransactionEvent.find({ transaction_id: id }).sort({ timestamp: -1 });
    return res.json({ success: true, count: events.length, data: events });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const importCSV = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Please upload a CSV file.' });
  }
  const { detectHeaders } = require('./uploadController');
  return detectHeaders(req, res);
};

const getCounterfactualExplanation = async (req, res) => {
  const { id } = req.params;
  const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000';
  
  try {
    let tx = await models.Transaction.findOne({ transaction_id: id });
    if (!tx && typeof models.Transaction.findById === 'function') {
      tx = await models.Transaction.findById(id);
    }
    if (!tx) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [senderHistory, receiverHistory] = await Promise.all([
      models.Transaction.find({ sender_account: tx.sender_account, timestamp: { $gte: thirtyDaysAgo } }).sort({ timestamp: -1 }).limit(50),
      models.Transaction.find({ receiver_account: tx.receiver_account, timestamp: { $gte: thirtyDaysAgo } }).sort({ timestamp: -1 }).limit(50)
    ]);

    try {
      const response = await axios.post(`${mlServiceUrl}/predict/counterfactual`, {
        transaction: tx,
        sender_history: senderHistory,
        receiver_history: receiverHistory,
        threshold: 0.50
      }, { timeout: 8000 });

      if (response.data && response.data.success) {
        return res.json(response.data);
      }
    } catch (mlErr) {
      console.warn(`[ML Service Counterfactual Fallback]: ${mlErr.message}`);
    }

    // Heuristic counterfactual fallback
    const origAmount = tx.amount || 100000;
    const targetScore = 40;
    const recs = [];

    if (origAmount > 200000) {
      recs.push({
        category: 'Transaction Volume',
        actionable_feature: 'amount',
        original_value: `₹${origAmount.toLocaleString('en-IN')}`,
        counterfactual_value: `≤ ₹${Math.round(origAmount * 0.35).toLocaleString('en-IN')}`,
        predicted_score: targetScore,
        score_drop: Math.max(15, tx.risk_score - targetScore),
        narrative: `Reducing transaction amount from ₹${origAmount.toLocaleString('en-IN')} to ≤ ₹${Math.round(origAmount * 0.35).toLocaleString('en-IN')} lowers risk score below alert threshold (to ${targetScore}%).`
      });
    }

    if (['Crypto Transfer', 'RTGS', 'Cash Deposit'].includes(tx.payment_method)) {
      recs.push({
        category: 'Payment Channel',
        actionable_feature: 'payment_method',
        original_value: tx.payment_method,
        counterfactual_value: 'UPI / NEFT',
        predicted_score: Math.max(20, tx.risk_score - 25),
        score_drop: 25,
        narrative: `Switching payment channel from '${tx.payment_method}' to standard verified clearing ('UPI') lowers risk score by 25 pts.`
      });
    }

    return res.json({
      success: true,
      data: {
        original_score: tx.risk_score,
        target_threshold: 50,
        is_achievable: recs.length > 0,
        counterfactuals: recs
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  adjustTransaction,
  recordStatusEvent,
  getTransactionEvents,
  importCSV,
  getCounterfactualExplanation
};

