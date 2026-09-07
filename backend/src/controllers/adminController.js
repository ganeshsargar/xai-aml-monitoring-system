const fs = require('fs');
const path = require('path');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');

const getUsers = async (req, res) => {
  try {
    const usersList = await models.User.find({});
    // Strip passwords before returning
    const safeList = usersList.map(u => ({
      _id: u._id,
      username: u.username,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt
    }));
    return res.json({ success: true, count: safeList.length, data: safeList });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const deleteUser = async (req, res) => {
  const { username } = req.params;
  try {
    if (username === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete primary administrator account.' });
    }

    const result = await models.User.deleteOne({ username });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    await logAction(
      req.user.username,
      req.user.role,
      'USER_DELETED',
      req.ip,
      `Deleted user account: ${username}`
    );

    return res.json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const logs = await models.AuditLog.find({});
    // Sort descending by timestamp
    const sorted = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return res.json({ success: true, count: sorted.length, data: sorted });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getSystemStats = async (req, res) => {
  try {
    // Load ML Metrics
    let mlMetrics = null;
    const metricsPath = path.join(__dirname, '..', '..', '..', 'ml-service', 'models', 'metrics.json');
    if (fs.existsSync(metricsPath)) {
      try {
        const fileContent = fs.readFileSync(metricsPath, 'utf8');
        mlMetrics = JSON.parse(fileContent);
      } catch (err) {
        console.warn(`Error reading ML metrics file: ${err.message}`);
      }
    }

    // Counts
    const userCount = await models.User.countDocuments({});
    const transactionCount = await models.Transaction.countDocuments({});
    const alertCount = await models.Alert.countDocuments({});
    const openCaseCount = await models.Case.countDocuments({ status: 'Open' });
    
    // Fallback status
    const dbFallback = require('../config/db').isFallback();

    return res.json({
      success: true,
      data: {
        database: {
          mode: dbFallback ? 'Fallback (Local JSON Files)' : 'MongoDB Server',
          status: 'Connected'
        },
        counts: {
          users: userCount,
          transactions: transactionCount,
          alerts: alertCount,
          openCases: openCaseCount
        },
        ml_model: mlMetrics || {
          status: 'No model metrics loaded. Please run the model training.'
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getUsers,
  deleteUser,
  getAuditLogs,
  getSystemStats
};
