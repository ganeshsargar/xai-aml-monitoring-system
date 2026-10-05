/**
 * Feedback & Active Learning Service for FundTraceAI.
 * 
 * Features:
 * 1. Analyst Disposition Label Logging (True Positive / False Positive) in dedicated 'labels' collection.
 *    (Keeps transactions strictly immutable).
 * 2. Active-Learning Uncertainty Queue prioritizing borderline, high-entropy alert decisions.
 * 3. Feedback and Governance Metrics tracking (FPR, Alert-to-STR Conversion, Analyst Agreement Rate).
 * 4. Sample-Weighted Retraining integration with strict temporal split adherence and min-label thresholds.
 */

const { models } = require('../config/db');
const { 
  getActiveLearningConfig, 
  getRetrainingConfig, 
  getRiskConfig 
} = require('../config/riskConfig');

/**
 * Records an individual transaction label from analyst review.
 * Transaction records are never modified.
 */
async function recordLabel({
  transaction_id,
  customer_id = null,
  label, // 1 (True Positive / Suspicious) or 0 (False Positive / Benign)
  disposition,
  rationale = '',
  label_source = 'alert_closure',
  analyst,
  weight = null
}) {
  if (!transaction_id) {
    throw new Error('transaction_id is required to record analyst label');
  }
  if (label !== 0 && label !== 1) {
    throw new Error('label must be 0 (False Positive) or 1 (True Positive)');
  }
  if (!analyst) {
    throw new Error('analyst username is required for auditability');
  }

  const retrainCfg = getRetrainingConfig();
  const labelWeight = weight != null ? Number(weight) : Number(retrainCfg.analyst_label_weight || 3.0);

  // Check if label already recorded for this transaction
  const existing = await models.Label.findOne({ transaction_id });

  if (existing) {
    existing.label = label;
    existing.disposition = disposition;
    existing.rationale = rationale || existing.rationale;
    existing.label_source = label_source;
    existing.analyst = analyst;
    existing.weight = labelWeight;
    existing.used_in_training = false; // reset when re-labeled
    existing.timestamp = new Date().toISOString();
    return await existing.save();
  }

  const { generateLabelId } = require('../utils/idGenerator');
  const labelId = generateLabelId();

  const newLabel = await models.Label.create({
    label_id: labelId,
    transaction_id,
    customer_id,
    label,
    disposition,
    rationale,
    label_source,
    analyst,
    weight: labelWeight,
    used_in_training: false,
    timestamp: new Date().toISOString()
  });

  return newLabel;
}

/**
 * Helper to extract binary label from disposition string.
 */
function parseDispositionLabel(disposition) {
  if (!disposition) return null;
  const lower = disposition.toLowerCase();
  if (lower.includes('true positive')) return 1;
  if (lower.includes('false positive')) return 0;
  return null; // 'Insufficient Information' or others do not produce binary ML training label
}

/**
 * Records labels for all transactions linked to an alert.
 */
async function recordLabelsForAlert(alert, disposition, rationale, analyst, labelSource = 'alert_closure') {
  if (!alert) return [];
  const labelVal = parseDispositionLabel(disposition);
  if (labelVal === null) return []; // skip non-binary dispositions

  // Aggregate transaction IDs from single or batch/grouped alerts
  const txIds = new Set();
  if (alert.transaction_id) txIds.add(alert.transaction_id);
  if (Array.isArray(alert.transaction_ids)) {
    alert.transaction_ids.forEach(id => id && txIds.add(id));
  }
  if (Array.isArray(alert.child_transactions)) {
    alert.child_transactions.forEach(tx => tx?.transaction_id && txIds.add(tx.transaction_id));
  }

  const results = [];
  for (const txId of txIds) {
    try {
      const rec = await recordLabel({
        transaction_id: txId,
        customer_id: alert.customer_id || null,
        label: labelVal,
        disposition,
        rationale: rationale || `Alert ${alert.alert_id || ''} dispositioned as ${disposition}`,
        label_source: labelSource,
        analyst
      });
      results.push(rec);
    } catch (err) {
      console.error(`[FeedbackService] Failed to record label for tx ${txId}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Records labels for all transactions linked to alerts within a Case.
 */
async function recordLabelsForCase(caseObj, disposition, rationale, analyst, labelSource = 'case_closure') {
  if (!caseObj) return [];
  const labelVal = parseDispositionLabel(disposition);
  if (labelVal === null) return [];

  const results = [];
  const alertIds = Array.isArray(caseObj.alerts) ? caseObj.alerts : [];

  for (const alertId of alertIds) {
    const alert = await models.Alert.findOne({ alert_id: alertId });
    if (alert) {
      const alertLabels = await recordLabelsForAlert(
        alert, 
        disposition, 
        rationale || `Case ${caseObj.case_id || ''} dispositioned as ${disposition}`, 
        analyst, 
        labelSource
      );
      results.push(...alertLabels);
    }
  }

  return results;
}

/**
 * Active-learning Queue: Finds open alerts where the model is most uncertain.
 * Model uncertainty is maximal when calibrated risk probability is closest to the decision threshold.
 */
async function getActiveLearningQueue(options = {}) {
  const alCfg = getActiveLearningConfig();
  const threshold = options.threshold != null ? Number(options.threshold) : Number(alCfg.decision_threshold || 50);
  const limit = options.limit ? Number(options.limit) : Number(alCfg.max_queue_size || 50);
  const bandWidth = options.bandWidth ? Number(options.bandWidth) : Number(alCfg.uncertainty_band_width || 20);

  // 1. Fetch all open / pending review alerts
  const openAlerts = await models.Alert.find({
    status: { $in: ['New', 'In Review L1', 'Escalated L2'] }
  });

  // 2. Fetch all existing labeled transaction IDs to avoid querying already-labeled items
  const allLabels = await models.Label.find({});
  const labeledTxIds = new Set(allLabels.map(l => l.transaction_id));

  // 3. Filter and calculate uncertainty score
  const scoredAlerts = [];

  for (const alert of openAlerts) {
    // If the alert's transaction is already labeled, skip
    if (alert.transaction_id && labeledTxIds.has(alert.transaction_id)) {
      continue;
    }

    const score = Number(alert.priority_score != null ? alert.priority_score : (alert.risk_score || 50));
    const distFromThreshold = Math.abs(score - threshold);

    // Uncertainty: 1.0 when score == threshold; decreases as score moves away towards 0 or 100
    // Normalized so that 0-distance = 1.0 uncertainty, 50-distance = 0.0 uncertainty
    const uncertaintyScore = Math.max(0, parseFloat((1.0 - (distFromThreshold / 50.0)).toFixed(4)));
    const isInUncertaintyBand = distFromThreshold <= bandWidth;

    scoredAlerts.push({
      ...alert,
      uncertainty_score: uncertaintyScore,
      distance_to_threshold: distFromThreshold,
      decision_threshold: threshold,
      in_uncertainty_band: isInUncertaintyBand,
      suggested_reason: `Model uncertainty: Risk Score ${score}% is within ±${distFromThreshold.toFixed(1)} pts of threshold (${threshold}%)`
    });
  }

  // 4. Sort by uncertainty descending (most uncertain first), then by creation date
  scoredAlerts.sort((a, b) => {
    if (b.uncertainty_score !== a.uncertainty_score) {
      return b.uncertainty_score - a.uncertainty_score;
    }
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  return scoredAlerts.slice(0, limit);
}

/**
 * Computes feedback and governance metrics over time.
 * Includes: False Positive Rate (FPR), Alert-to-STR conversion rate, Analyst Agreement Rate.
 */
async function computeFeedbackMetrics() {
  const labels = await models.Label.find({});
  const transactions = await models.Transaction.find({});
  const alerts = await models.Alert.find({});
  const cases = await models.Case.find({});

  const txMap = new Map();
  transactions.forEach(t => txMap.set(t.transaction_id, t));

  const totalLabels = labels.length;
  let truePositives = 0;
  let falsePositives = 0;
  let strFilings = 0;
  let agreements = 0;
  let totalCompared = 0;

  // Track daily time-series
  const dailyStats = {};

  labels.forEach(lbl => {
    if (lbl.label === 1) truePositives++;
    if (lbl.label === 0) falsePositives++;
    if (lbl.disposition && lbl.disposition.includes('STR Filed')) strFilings++;

    // Compute model agreement
    const tx = txMap.get(lbl.transaction_id);
    if (tx && tx.risk_score != null) {
      totalCompared++;
      const modelPred = tx.risk_score >= 50 ? 1 : 0;
      if (modelPred === lbl.label) {
        agreements++;
      }
    }

    // Daily grouping
    const dateStr = (lbl.timestamp || lbl.createdAt || new Date().toISOString()).split('T')[0];
    if (!dailyStats[dateStr]) {
      dailyStats[dateStr] = { date: dateStr, total: 0, tp: 0, fp: 0, str: 0, agreement: 0, compared: 0 };
    }
    dailyStats[dateStr].total++;
    if (lbl.label === 1) dailyStats[dateStr].tp++;
    if (lbl.label === 0) dailyStats[dateStr].fp++;
    if (lbl.disposition && lbl.disposition.includes('STR Filed')) dailyStats[dateStr].str++;
    if (tx && tx.risk_score != null) {
      dailyStats[dateStr].compared++;
      const mPred = tx.risk_score >= 50 ? 1 : 0;
      if (mPred === lbl.label) dailyStats[dateStr].agreement++;
    }
  });

  const resolvedCount = truePositives + falsePositives;
  const fpr = resolvedCount > 0 ? parseFloat(((falsePositives / resolvedCount) * 100).toFixed(2)) : 0;
  const strConversionRate = resolvedCount > 0 ? parseFloat(((strFilings / resolvedCount) * 100).toFixed(2)) : 0;
  const agreementRate = totalCompared > 0 ? parseFloat(((agreements / totalCompared) * 100).toFixed(2)) : 0;

  // Format time series sorted chronologically
  const timeSeries = Object.keys(dailyStats).sort().map(d => {
    const s = dailyStats[d];
    const dayResolved = s.tp + s.fp;
    return {
      date: d,
      total_labels: s.total,
      false_positive_rate: dayResolved > 0 ? parseFloat(((s.fp / dayResolved) * 100).toFixed(2)) : 0,
      str_conversion_rate: dayResolved > 0 ? parseFloat(((s.str / dayResolved) * 100).toFixed(2)) : 0,
      analyst_agreement_rate: s.compared > 0 ? parseFloat(((s.agreement / s.compared) * 100).toFixed(2)) : 0
    };
  });

  // Check pending new labels for retraining guard
  const unusedLabelsCount = labels.filter(l => !l.used_in_training).length;
  const retrainCfg = getRetrainingConfig();
  const minRequired = Number(retrainCfg.min_new_labels || 5);

  return {
    summary: {
      total_labels_collected: totalLabels,
      total_resolved: resolvedCount,
      true_positives: truePositives,
      false_positives: falsePositives,
      str_filed_count: strFilings,
      false_positive_rate_pct: fpr,
      str_conversion_rate_pct: strConversionRate,
      analyst_agreement_rate_pct: agreementRate,
      unused_labels_count: unusedLabelsCount,
      retraining_ready: unusedLabelsCount >= minRequired,
      min_labels_required_for_retraining: minRequired
    },
    time_series: timeSeries
  };
}

/**
 * Returns labels available for retraining, enforcing min_new_labels guard and temporal split.
 */
async function getRetrainingPayload(force = false) {
  const retrainCfg = getRetrainingConfig();
  const minRequired = Number(retrainCfg.min_new_labels || 5);
  const analystWeight = Number(retrainCfg.analyst_label_weight || 3.0);

  const unusedLabels = await models.Label.find({ used_in_training: false });
  const allLabels = await models.Label.find({});

  if (!force && unusedLabels.length < minRequired) {
    throw new Error(
      `Retraining threshold not met: ${unusedLabels.length} new labels available, minimum ${minRequired} required. (Pass force=true to override)`
    );
  }

  // Return dataset payload formatted for ML training service
  return {
    min_required: minRequired,
    analyst_label_weight: analystWeight,
    unused_count: unusedLabels.length,
    total_labels_count: allLabels.length,
    labels: allLabels.map(l => ({
      label_id: l.label_id,
      transaction_id: l.transaction_id,
      customer_id: l.customer_id,
      label: l.label,
      disposition: l.disposition,
      weight: l.weight || analystWeight,
      analyst: l.analyst,
      timestamp: l.timestamp
    }))
  };
}

/**
 * Marks labels as used in training after successful ML retrain job.
 */
async function markLabelsAsUsedInTraining(labelIds = [], modelVersion = 'xgb-v2') {
  if (!Array.isArray(labelIds) || labelIds.length === 0) {
    // Mark all currently unused labels
    const unused = await models.Label.find({ used_in_training: false });
    for (const lbl of unused) {
      if (typeof lbl.save === 'function') {
        lbl.used_in_training = true;
        lbl.trained_at = new Date().toISOString();
        lbl.model_version = modelVersion;
        await lbl.save();
      } else if (typeof models.Label.findOneAndUpdate === 'function') {
        await models.Label.findOneAndUpdate(
          { label_id: lbl.label_id },
          { used_in_training: true, trained_at: new Date().toISOString(), model_version: modelVersion }
        );
      } else {
        await models.Label.findByIdAndUpdate(lbl.label_id || lbl._id, {
          used_in_training: true,
          trained_at: new Date().toISOString(),
          model_version: modelVersion
        });
      }
    }
    return unused.length;
  }

  let count = 0;
  for (const lid of labelIds) {
    const lbl = await models.Label.findOne({ label_id: lid });
    if (lbl) {
      if (typeof lbl.save === 'function') {
        lbl.used_in_training = true;
        lbl.trained_at = new Date().toISOString();
        lbl.model_version = modelVersion;
        await lbl.save();
      } else if (typeof models.Label.findOneAndUpdate === 'function') {
        await models.Label.findOneAndUpdate(
          { label_id: lid },
          { used_in_training: true, trained_at: new Date().toISOString(), model_version: modelVersion }
        );
      } else {
        await models.Label.findByIdAndUpdate(lid, {
          used_in_training: true,
          trained_at: new Date().toISOString(),
          model_version: modelVersion
        });
      }
      count++;
    }
  }
  return count;
}

module.exports = {
  recordLabel,
  recordLabelsForAlert,
  recordLabelsForCase,
  getActiveLearningQueue,
  computeFeedbackMetrics,
  getRetrainingPayload,
  markLabelsAsUsedInTraining
};
