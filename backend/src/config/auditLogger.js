const { models } = require('./db');

const logAction = async (username, role, action, ipAddress, details) => {
  try {
    await models.AuditLog.create({
      username,
      role,
      action,
      ip_address: ipAddress || '127.0.0.1',
      details: details || '',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[Audit Log Failed]: ${error.message}`);
  }
};

module.exports = { logAction };
