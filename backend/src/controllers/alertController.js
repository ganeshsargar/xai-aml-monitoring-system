const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');

const getAlerts = async (req, res) => {
  try {
    const { status, level, limit = 50, page = 1 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (level) filter.level = level;

    const total = await models.Alert.countDocuments(filter);
    const alertsList = await models.Alert.find(filter);
    
    // Sort descending by risk score, then date
    const sortedAlerts = alertsList.sort((a, b) => {
      if (b.risk_score !== a.risk_score) {
        return b.risk_score - a.risk_score;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const parsedLimit = parseInt(limit) || 50;
    const parsedPage = parseInt(page) || 1;
    const startIndex = (parsedPage - 1) * parsedLimit;
    const paginatedAlerts = sortedAlerts.slice(startIndex, startIndex + parsedLimit);

    // Manual join to attach transaction details (resilient for both DB modes)
    const enrichedAlerts = [];
    for (const alert of paginatedAlerts) {
      // Find matching transaction
      const transaction = await models.Transaction.findOne({ transaction_id: alert.transaction_id });
      const alertObj = typeof alert.toObject === 'function' ? alert.toObject() : alert;
      enrichedAlerts.push({
        ...alertObj,
        transaction: transaction || null
      });
    }

    return res.json({ 
      success: true, 
      count: enrichedAlerts.length,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit) || 1,
      data: enrichedAlerts 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateAlert = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // status: Investigating, Dismissed, Escalated

  if (!status) {
    return res.status(400).json({ success: false, error: 'Status is required.' });
  }

  try {
    let updated;
    if (typeof models.Alert.findOneAndUpdate === 'function') {
      updated = await models.Alert.findOneAndUpdate({ alert_id: id }, { status }, { new: true });
    } else {
      updated = await models.Alert.findByIdAndUpdate(id, { status });
    }
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Alert not found.' });
    }

    await logAction(
      req.user.username,
      req.user.role,
      'ALERT_STATUS_UPDATED',
      req.ip,
      `Updated status of alert ${id} to ${status}`
    );

    return res.json({ success: true, message: 'Alert updated successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getAlerts,
  updateAlert
};
