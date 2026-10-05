/**
 * FundTraceAI AML Risk Configuration Manager (Node.js/Express).
 * Single source of truth loaded dynamically from config/risk_config.json.
 *
 * Regulatory & Compliance Notice:
 * // verify against current rules (e.g. RBI Master Directions / FIU-IND Guidelines / PMLA 2002 / FATF Recommendations)
 */

const fs = require('fs');
const path = require('path');
const { logAction } = require('./auditLogger');

// Resolve path to config/risk_config.json at repository root
const ROOT_DIR = path.resolve(__dirname, '../../../');
const RISK_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'risk_config.json');

let cachedConfig = null;
let lastMtime = 0;

/**
 * Loads risk configuration from config/risk_config.json.
 * Automatically reloads if file on disk has changed.
 */
function getRiskConfig(forceReload = false) {
  if (!fs.existsSync(RISK_CONFIG_PATH)) {
    throw new Error(`Risk configuration file not found at: ${RISK_CONFIG_PATH}`);
  }

  const stat = fs.statSync(RISK_CONFIG_PATH);
  if (forceReload || !cachedConfig || stat.mtimeMs > lastMtime) {
    const raw = fs.readFileSync(RISK_CONFIG_PATH, 'utf8');
    cachedConfig = JSON.parse(raw);
    lastMtime = stat.mtimeMs;
  }
  return cachedConfig;
}

/**
 * Computes structuring lower and upper bounds dynamically from CTR threshold
 * and structuring band percentages defined in config.
 */
function getStructuringBounds() {
  const cfg = getRiskConfig();
  const ctr = Number(cfg.ctr_threshold || 1000000);
  const minPct = Number(cfg.structuring_band?.min_percent ?? 82.0);
  const maxPct = Number(cfg.structuring_band?.max_percent ?? 99.9);
  return {
    lower: (ctr * minPct) / 100.0,
    upper: (ctr * maxPct) / 100.0,
    ctr
  };
}

/**
 * Returns list of high risk country ISO codes.
 */
function getHighRiskCountries() {
  const cfg = getRiskConfig();
  return Object.keys(cfg.high_risk_jurisdictions || {});
}

/**
 * Returns dictionary of high risk jurisdictions with metadata.
 */
function getHighRiskJurisdictions() {
  const cfg = getRiskConfig();
  return cfg.high_risk_jurisdictions || {};
}

/**
 * Returns array of off-hours hour integers.
 */
function getNightHours() {
  const cfg = getRiskConfig();
  return cfg.night_hours || [22, 23, 0, 1, 2, 3, 4, 5];
}

/**
 * Returns list of high-risk payment methods.
 */
function getHighRiskPaymentMethods() {
  const cfg = getRiskConfig();
  return cfg.high_risk_payment_methods || ['Crypto Transfer', 'Cash Deposit', 'RTGS'];
}

/**
 * Returns alert level cutoffs.
 */
function getAlertLevelCutoffs() {
  const cfg = getRiskConfig();
  return cfg.alert_level_cutoffs || { critical: 80, high: 60, medium: 35, low: 20 };
}

/**
 * Calculates alert severity level based on configured cutoffs.
 */
function getAlertLevel(riskScore, customCutoffs) {
  const cutoffs = customCutoffs || getAlertLevelCutoffs();
  const score = Number(riskScore || 0);
  if (score >= cutoffs.critical) return 'Critical';
  if (score >= cutoffs.high) return 'High';
  if (score >= cutoffs.medium) return 'Medium';
  if (score >= cutoffs.low) return 'Low';
  return null;
}

/**
 * Updates risk configuration on disk with schema validation and audit logging.
 */
async function updateRiskConfig(newConfig, user, ipAddress) {
  const oldConfig = getRiskConfig(true);

  // Validate required structure
  if (!newConfig.ctr_threshold || Number(newConfig.ctr_threshold) <= 0) {
    throw new Error('Valid CTR threshold (> 0) is required.');
  }

  if (!newConfig.structuring_band || 
      newConfig.structuring_band.min_percent == null || 
      newConfig.structuring_band.max_percent == null ||
      Number(newConfig.structuring_band.min_percent) >= Number(newConfig.structuring_band.max_percent)) {
    throw new Error('Structuring band must contain valid min_percent < max_percent.');
  }

  if (!newConfig.alert_level_cutoffs) {
    throw new Error('alert_level_cutoffs object is required.');
  }

  const { critical, high, medium, low } = newConfig.alert_level_cutoffs;
  if (!(critical > high && high > medium && medium > low)) {
    throw new Error('Alert level cutoffs must strictly follow: critical > high > medium > low.');
  }

  if (!newConfig.high_risk_jurisdictions || typeof newConfig.high_risk_jurisdictions !== 'object') {
    throw new Error('high_risk_jurisdictions object is required.');
  }

  // Stamp metadata
  const updatedPayload = {
    ...newConfig,
    _comment: "verify against current rules (e.g. RBI Master Directions / FIU-IND Guidelines / PMLA 2002 / FATF Recommendations)",
    last_updated: new Date().toISOString(),
    updated_by: user?.username || 'admin'
  };

  // Write atomically to file
  fs.writeFileSync(RISK_CONFIG_PATH, JSON.stringify(updatedPayload, null, 2), 'utf8');
  cachedConfig = updatedPayload;
  lastMtime = fs.statSync(RISK_CONFIG_PATH).mtimeMs;

  // Log action with old and new values in details
  const auditDetails = JSON.stringify({
    summary: `Risk configuration updated by ${user?.username || 'admin'}`,
    old_values: {
      ctr_threshold: oldConfig.ctr_threshold,
      structuring_band: oldConfig.structuring_band,
      alert_level_cutoffs: oldConfig.alert_level_cutoffs,
      high_risk_countries: Object.keys(oldConfig.high_risk_jurisdictions || {})
    },
    new_values: {
      ctr_threshold: updatedPayload.ctr_threshold,
      structuring_band: updatedPayload.structuring_band,
      alert_level_cutoffs: updatedPayload.alert_level_cutoffs,
      high_risk_countries: Object.keys(updatedPayload.high_risk_jurisdictions || {})
    }
  });

  await logAction(
    user?.username || 'admin',
    user?.role || 'Admin',
    'RISK_CONFIG_UPDATED',
    ipAddress || '127.0.0.1',
    auditDetails
  );

  return updatedPayload;
}

function getCtrThreshold() {
  const cfg = getRiskConfig();
  return Number(cfg.ctr_threshold || 1000000);
}

function getAlertWorkflowConfig() {
  const cfg = getRiskConfig();
  return cfg.alert_workflow || {
    aggregation_window_hours: 24,
    sla_hours_by_level: {
      Critical: 24,
      High: 48,
      Medium: 120,
      Low: 336
    },
    disposition_codes: [
      'False Positive',
      'True Positive - STR Filed',
      'True Positive - No Filing',
      'Insufficient Information'
    ],
    statuses: [
      'New',
      'In Review L1',
      'Escalated L2',
      'Closed'
    ]
  };
}

function getSlaHoursForLevel(level) {
  const wf = getAlertWorkflowConfig();
  const slaMap = wf.sla_hours_by_level || { Critical: 24, High: 48, Medium: 120, Low: 336 };
  return slaMap[level] || slaMap.Medium || 120;
}

function getDueAtForLevel(level, startDate = new Date()) {
  const hours = getSlaHoursForLevel(level);
  const start = new Date(startDate);
  return new Date(start.getTime() + hours * 3600000).toISOString();
}

function getActiveLearningConfig() {
  const cfg = getRiskConfig();
  return cfg.active_learning || {
    decision_threshold: 50,
    uncertainty_band_width: 20,
    max_queue_size: 50
  };
}

function getRetrainingConfig() {
  const cfg = getRiskConfig();
  return cfg.retraining || {
    min_new_labels: 5,
    analyst_label_weight: 3.0,
    test_split_ratio: 0.2,
    test_split_days: 30
  };
}

module.exports = {
  RISK_CONFIG_PATH,
  getRiskConfig,
  loadRiskConfig: getRiskConfig,
  getCtrThreshold,
  getStructuringBounds,
  getHighRiskCountries,
  getHighRiskJurisdictions,
  getNightHours,
  getHighRiskPaymentMethods,
  getAlertLevelCutoffs,
  getAlertCutoffs: getAlertLevelCutoffs,
  getAlertLevel,
  getAlertWorkflowConfig,
  getSlaHoursForLevel,
  getDueAtForLevel,
  getActiveLearningConfig,
  getRetrainingConfig,
  updateRiskConfig
};
