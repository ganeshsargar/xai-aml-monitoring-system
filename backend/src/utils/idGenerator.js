const crypto = require('crypto');

/**
 * High-entropy, collision-safe identifier generators.
 * Replaces all non-deterministic Math.random() ID generations with cryptographic primitives.
 */

const generateUUID = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return [
    crypto.randomBytes(4).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(6).toString('hex')
  ].join('-');
};

const generatePrefixedId = (prefix) => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${randomHex}`;
};

const generateTxId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TX-${timestamp}-${randomHex}`;
};

const generateAdjustmentId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `ADJ-${timestamp}-${randomHex}`;
};

const generateAlertId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `ALT-${timestamp}-${randomHex}`;
};

const generateCaseId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `CASE-${timestamp}-${randomHex}`;
};

const generateDecisionId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `DEC-${timestamp}-${randomHex}`;
};

const generateLabelId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `LBL-${timestamp}-${randomHex}`;
};

const generateUploadId = () => {
  const timestamp = Date.now().toString(36);
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `upl_${timestamp}_${randomHex}`;
};

const generateTemplateId = () => {
  const timestamp = Date.now().toString(36);
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `tmpl_${timestamp}_${randomHex}`;
};

module.exports = {
  generateUUID,
  generatePrefixedId,
  generateTxId,
  generateAdjustmentId,
  generateAlertId,
  generateCaseId,
  generateDecisionId,
  generateLabelId,
  generateUploadId,
  generateTemplateId
};
