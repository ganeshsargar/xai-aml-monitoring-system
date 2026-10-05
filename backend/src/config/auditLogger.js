const crypto = require('crypto');
const { models } = require('./db');
const { generateUUID } = require('../utils/idGenerator');

const GENESIS_HASH = '0'.repeat(64);

/**
 * Computes the deterministic SHA-256 hash of an audit log entry.
 */
const computeLogHash = ({ sequence, previous_hash, timestamp, username, role, action, ip_address, details }) => {
  const normTimestamp = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  const payload = `${sequence}|${previous_hash}|${normTimestamp}|${username}|${role}|${action}|${ip_address || '127.0.0.1'}|${details || ''}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
};

/**
 * Appends a tamper-evident audit log with cryptographic hash-chaining.
 */
const logAction = async (username, role, action, ipAddress, details) => {
  try {
    const timestamp = new Date();
    
    // Find the latest audit log entry to link the hash chain
    let lastLog = null;
    try {
      const logs = await models.AuditLog.find().sort({ sequence: -1 }).limit(1);
      if (Array.isArray(logs) && logs.length > 0) {
        lastLog = logs[0];
      }
    } catch (findErr) {
      if (typeof models.AuditLog.find === 'function') {
        const all = await models.AuditLog.find();
        if (Array.isArray(all) && all.length > 0) {
          lastLog = all.sort((a, b) => (b.sequence || 0) - (a.sequence || 0))[0];
        }
      }
    }

    const sequence = (lastLog && typeof lastLog.sequence === 'number') ? lastLog.sequence + 1 : 1;
    const previous_hash = (lastLog && lastLog.hash) ? lastLog.hash : GENESIS_HASH;

    const hash = computeLogHash({
      sequence,
      previous_hash,
      timestamp,
      username: username || 'System',
      role: role || 'System',
      action: action || 'UNKNOWN_ACTION',
      ip_address: ipAddress || '127.0.0.1',
      details: details || ''
    });

    const entry = {
      log_id: generateUUID(),
      sequence,
      previous_hash,
      hash,
      username: username || 'System',
      role: role || 'System',
      action: action || 'UNKNOWN_ACTION',
      ip_address: ipAddress || '127.0.0.1',
      details: details || '',
      timestamp
    };

    return await models.AuditLog.create(entry);
  } catch (error) {
    console.error(`[Audit Log Failed]: ${error.message}`);
    return null;
  }
};

/**
 * Validates the cryptographic integrity of the entire audit log hash chain from Genesis to Head.
 */
const verifyAuditLogChain = async () => {
  try {
    let allLogs = [];
    if (typeof models.AuditLog.find === 'function') {
      allLogs = await models.AuditLog.find().sort({ sequence: 1, timestamp: 1 });
    }

    // Filter to audit entries with cryptographic hash tracking
    const logs = (Array.isArray(allLogs) ? allLogs : []).filter(l => l && (l.hash || l.sequence));

    if (logs.length === 0) {
      return {
        verified: true,
        total_entries: 0,
        message: 'Audit log chain is empty. Genesis state intact.',
        genesis_hash: GENESIS_HASH,
        latest_hash: GENESIS_HASH,
        verified_at: new Date().toISOString()
      };
    }

    // Ensure sorted by sequence
    logs.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    for (let i = 0; i < logs.length; i++) {
      const current = logs[i];
      const expectedPrevHash = (i === 0) ? GENESIS_HASH : logs[i - 1].hash;

      // 1. Check previous hash linkage
      if (current.previous_hash !== expectedPrevHash) {
        return {
          verified: false,
          total_entries: logs.length,
          corrupted_at: i,
          corrupted_sequence: current.sequence,
          corrupted_log_id: current.log_id || current._id,
          message: `Chain linkage mismatch at entry #${current.sequence || i + 1}. Expected previous hash ${expectedPrevHash ? expectedPrevHash.substring(0, 16) : 'null'}..., found ${String(current.previous_hash).substring(0, 16)}...`,
          verified_at: new Date().toISOString()
        };
      }

      // 2. Recompute and verify content hash
      const expectedHash = computeLogHash({
        sequence: current.sequence || (i + 1),
        previous_hash: current.previous_hash || expectedPrevHash,
        timestamp: current.timestamp,
        username: current.username,
        role: current.role,
        action: current.action,
        ip_address: current.ip_address,
        details: current.details
      });

      if (current.hash !== expectedHash) {
        return {
          verified: false,
          total_entries: logs.length,
          corrupted_at: i,
          corrupted_sequence: current.sequence,
          corrupted_log_id: current.log_id || current._id,
          message: `Content hash tampering detected at entry #${current.sequence || i + 1} (${current.action} by ${current.username}). Expected hash ${expectedHash.substring(0, 16)}..., stored ${String(current.hash).substring(0, 16)}...`,
          verified_at: new Date().toISOString()
        };
      }
    }

    const latest = logs[logs.length - 1];
    return {
      verified: true,
      total_entries: logs.length,
      message: `Audit log cryptographic chain fully verified across ${logs.length} entries. Zero tampering detected.`,
      genesis_hash: GENESIS_HASH,
      latest_hash: latest.hash || GENESIS_HASH,
      verified_at: new Date().toISOString()
    };
  } catch (error) {
    return {
      verified: false,
      error: error.message,
      message: `Verification error: ${error.message}`,
      verified_at: new Date().toISOString()
    };
  }
};

module.exports = {
  GENESIS_HASH,
  computeLogHash,
  logAction,
  verifyAuditLogChain
};
