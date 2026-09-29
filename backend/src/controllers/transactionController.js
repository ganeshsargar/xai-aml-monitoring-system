const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');

// Helper: Predict transaction risk (calls Flask ML service, falls back to heuristic if down)
const predictTransactionRisk = async (tx, senderHistory = [], receiverHistory = []) => {
  const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000';
  
  try {
    const response = await axios.post(`${mlServiceUrl}/predict`, {
      transaction: tx,
      sender_history: senderHistory,
      receiver_history: receiverHistory
    }, { timeout: 8000 }); // 8s timeout - generous now that /predict no longer rebuilds SHAP per-request

    if (response.data && response.data.success) {
      return {
        risk_score: response.data.risk_score,
        is_laundering: response.data.prediction,
        reasons: response.data.reasons || [],
        shap_explanation: response.data.shap_explanations || []
      };
    }
  } catch (error) {
    console.warn(`[ML Service Predict Fallback]: Python server unreachable or error: ${error.message}`);
  }

  // Heuristic Fallback Risk Engine (Runs instantly when ML service is offline)
  let score = 5;
  const reasons = [];
  const shap = [];

  const amount = parseFloat(tx.amount || 0);
  const country = tx.country || 'IN';
  const payMethod = tx.payment_method || 'UPI';
  const category = tx.category || 'Transfer';
  const hour = new Date(tx.timestamp || Date.now()).getHours();

  const COUNTRY_NAMES = {
    KY: 'Cayman Islands (offshore tax haven)',
    PA: 'Panama (FATF grey-listed jurisdiction)',
    AE: 'UAE / Dubai (high cash-intensity hub)',
    RU: 'Russia (sanctions-listed jurisdiction)',
    BS: 'Bahamas (offshore financial centre)',
    LU: 'Luxembourg (opaque holding jurisdiction)',
  };

  // 1. Amount structuring near India CTR threshold (₹10,00,000)
  if (amount >= 820000 && amount <= 999000) {
    score += 40;
    reasons.push(`₹${amount.toLocaleString('en-IN')} structured in the 82–99% band of India's ₹10,00,000 CTR threshold — textbook smurfing/structuring pattern to evade RBI reporting obligations`);
    shap.push({ feature: 'amount_near_threshold', shap_value: 0.40, actual_value: 1 });
  } else if (amount >= 5000000) {
    score += 40;
    reasons.push(`Exceptionally large single transfer of ₹${amount.toLocaleString('en-IN')} — exceeds ₹50L retail baseline; highly consistent with integration stage of money laundering`);
    shap.push({ feature: 'is_large_amount', shap_value: 0.40, actual_value: 1 });
  } else if (amount >= 1000000) {
    score += 30;
    reasons.push(`High-value transfer of ₹${amount.toLocaleString('en-IN')} exceeds ₹10L threshold — triggers mandatory Suspicious Transaction Report (STR) review under PMLA 2002`);
    shap.push({ feature: 'is_large_amount', shap_value: 0.30, actual_value: 1 });
  } else if (amount >= 500000) {
    score += 18;
    reasons.push(`Elevated transfer of ₹${amount.toLocaleString('en-IN')} — statistically above 95th percentile for retail accounts; warrants enhanced due diligence`);
    shap.push({ feature: 'is_large_amount', shap_value: 0.18, actual_value: 1 });
  } else {
    shap.push({ feature: 'amount_near_threshold', shap_value: -0.05, actual_value: 0 });
    shap.push({ feature: 'is_large_amount', shap_value: -0.05, actual_value: 0 });
  }
  shap.push({ feature: 'amount', shap_value: amount > 250000 ? 0.1 : -0.1, actual_value: amount });

  // 2. High-risk jurisdictions / FATF-listed countries
  const highRiskCountries = ['KY', 'PA', 'AE', 'RU', 'BS', 'LU'];
  if (highRiskCountries.includes(country)) {
    score += 30;
    const jurisdictionName = COUNTRY_NAMES[country] || country;
    reasons.push(`Transaction routed through ${jurisdictionName} — FATF-flagged jurisdiction with high ML/TF exposure; cross-border flows require Enhanced Due Diligence (EDD) per FEMA & PMLA`);
    shap.push({ feature: 'is_high_risk_country', shap_value: 0.30, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_high_risk_country', shap_value: -0.1, actual_value: 0 });
  }

  // 3. High-risk anonymous payment channels
  if (['Crypto Transfer', 'Cash Deposit', 'RTGS'].includes(payMethod)) {
    score += 20;
    if (payMethod === 'Crypto Transfer') {
      reasons.push(`Cryptocurrency transfer channel — bypasses traditional AML controls, KYC verification, and SWIFT monitoring; heavily exploited in layering phase`);
    } else if (payMethod === 'Cash Deposit') {
      reasons.push(`Large cash deposit — anonymous placement method; consistent with first stage of money laundering; triggers mandatory currency transaction reporting`);
    } else {
      reasons.push(`RTGS high-value channel — typically used in high-velocity layering schemes to move large sums rapidly across accounts before detection`);
    }
    shap.push({ feature: 'is_wire_or_crypto', shap_value: 0.20, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_wire_or_crypto', shap_value: -0.05, actual_value: 0 });
  }

  // 4. Off-hours timing
  if (hour >= 23 || hour <= 4) {
    score += 10;
    reasons.push(`Transaction executed at ${String(hour).padStart(2,'0')}:xx hours — off-hours activity outside business windows is a recognized suspicious indicator in RBI's STR guidelines`);
    shap.push({ feature: 'is_night', shap_value: 0.10, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_night', shap_value: -0.05, actual_value: 0 });
  }

  // 5. Unclassified capital transfer to high-risk channel/country
  if (category === 'Transfer' && (highRiskCountries.includes(country) || ['Crypto Transfer', 'Cash Deposit', 'RTGS'].includes(payMethod))) {
    score += 10;
    reasons.push(`Direct capital transfer with no commercial or retail purpose — unclassified fund movements combined with high-risk channel are hallmarks of placement and layering phases of ML`);
    shap.push({ feature: 'is_transfer', shap_value: 0.10, actual_value: 1 });
  } else {
    shap.push({ feature: 'is_transfer', shap_value: -0.05, actual_value: 0 });
  }

  // Velocity defaults in fallback
  shap.push({ feature: 'sender_time_diff', shap_value: 0.0, actual_value: 9999 });
  shap.push({ feature: 'receiver_time_diff', shap_value: 0.0, actual_value: 9999 });
  shap.push({ feature: 'sender_velocity_2h', shap_value: 0.0, actual_value: 0 });
  shap.push({ feature: 'receiver_velocity_2h', shap_value: 0.0, actual_value: 0 });

  score = Math.min(score, 99);
  const isLaundering = score >= 60 ? 1 : 0;

  return {
    risk_score: score,
    is_laundering: isLaundering,
    reasons: reasons.slice(0, 3),
    shap_explanation: shap
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

    const total = await models.Transaction.countDocuments(filter);
    const list = await models.Transaction.find(filter);

    // Manual Pagination & Sort (resilient for both Mongo & file mode)
    // Sort descending by timestamp
    const sortedList = list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const paginatedList = sortedList.slice(startIndex, startIndex + parseInt(limit));

    return res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
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

    // Generate Transaction ID if not provided
    if (!txData.transaction_id) {
      txData.transaction_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    }
    
    txData.timestamp = txData.timestamp || new Date().toISOString();
    txData.status = txData.status || 'Approved';

    // Fetch sender and receiver history to calculate velocities
    const senderHistory = await models.Transaction.find({ sender_account: txData.sender_account });
    const receiverHistory = await models.Transaction.find({ receiver_account: txData.receiver_account });

    // Call ML Predictor
    const predictionResult = await predictTransactionRisk(txData, senderHistory, receiverHistory);

    txData.risk_score = predictionResult.risk_score;
    txData.is_laundering = predictionResult.is_laundering;
    txData.reasons = predictionResult.reasons;
    txData.shap_explanation = predictionResult.shap_explanation;

    const savedTx = await models.Transaction.create(txData);

    // Generate Alert Automatically if Risk Score warrants investigative review
    let alertLevel = null;
    if (savedTx.risk_score >= 80) {
      alertLevel = 'Critical';
    } else if (savedTx.risk_score >= 60) {
      alertLevel = 'High';
    } else if (savedTx.risk_score >= 35) {
      alertLevel = 'Medium';
    } else if (savedTx.risk_score >= 20) {
      alertLevel = 'Low';
    }

    if (alertLevel) {
      const alertId = 'ALT' + Math.floor(100000 + Math.random() * 900000);
      await models.Alert.create({
        alert_id: alertId,
        transaction_id: savedTx.transaction_id,
        risk_score: savedTx.risk_score,
        level: alertLevel,
        status: 'New'
      });
      console.log(`[Alert Generated] Flagged transaction: ${savedTx.transaction_id} (${alertLevel} - Risk ${savedTx.risk_score}%)`);
    }

    await logAction(
      req.user ? req.user.username : 'API',
      req.user ? req.user.role : 'Guest',
      'TRANSACTION_CREATED',
      req.ip,
      `Created transaction ${savedTx.transaction_id} - Risk: ${savedTx.risk_score}%`
    );

    return res.status(201).json({ success: true, data: savedTx });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateTransaction = async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await models.Transaction.findByIdAndUpdate(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }
    
    await logAction(req.user.username, req.user.role, 'TRANSACTION_UPDATED', req.ip, `Updated transaction status for ${id}`);
    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const deleteTransaction = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await models.Transaction.deleteOne({ transaction_id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }
    
    await logAction(req.user.username, req.user.role, 'TRANSACTION_DELETED', req.ip, `Deleted transaction ${id}`);
    return res.json({ success: true, message: 'Transaction deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const importCSV = async (req, res) => {
  const uploadController = require('./uploadController');
  // Enforce pipeline gate: legacy unmapped immediate parse is removed.
  // Files must undergo header detection, signature matching, and confirmed mapping.
  return uploadController.detectHeaders(req, res);
};

module.exports = {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  importCSV
};
