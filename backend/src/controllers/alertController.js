const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { 
  getAlertLevel,
  getAlertWorkflowConfig,
  getSlaHoursForLevel,
  getDueAtForLevel
} = require('../config/riskConfig');
const {
  generateAlertId,
  generateCaseId,
  calculatePriorityScore,
  processTransactionAlert
} = require('../services/alertService');
const feedbackService = require('../services/feedbackService');

/**
 * GET /api/alerts
 * Supports queue sorting, rich filtering, pagination, and multi-transaction enrichment.
 */
const getAlerts = async (req, res) => {
  try {
    const { 
      status, 
      level, 
      assignee, 
      entity_type, 
      overdue, 
      search, 
      sortBy = 'priority_score', 
      sortDir = 'desc',
      limit = 50, 
      page = 1 
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (level) filter.level = level;
    if (assignee) {
      if (assignee === 'unassigned') {
        filter.assignee = null;
      } else {
        filter.assignee = assignee;
      }
    }
    if (entity_type) filter.entity_type = entity_type;

    let alertsList = await models.Alert.find(filter);

    // Apply Search Filter (alert_id, entity_id, entity_name, transaction_id)
    if (search) {
      const q = search.trim().toLowerCase();
      alertsList = alertsList.filter(a => 
        (a.alert_id && a.alert_id.toLowerCase().includes(q)) ||
        (a.entity_id && a.entity_id.toLowerCase().includes(q)) ||
        (a.entity_name && a.entity_name.toLowerCase().includes(q)) ||
        (a.transaction_id && a.transaction_id.toLowerCase().includes(q)) ||
        (Array.isArray(a.transaction_ids) && a.transaction_ids.some(t => t.toLowerCase().includes(q)))
      );
    }

    // Apply Overdue Filter
    const now = Date.now();
    if (overdue === 'true' || overdue === '1') {
      alertsList = alertsList.filter(a => {
        if (a.status === 'Closed' || a.status === 'Dismissed') return false;
        if (!a.due_at) return false;
        return new Date(a.due_at).getTime() < now;
      });
    }

    // Dynamic Priority and Aging Enrichment + Queue Sorting
    const enrichedList = alertsList.map(a => {
      const alertObj = typeof a.toObject === 'function' ? a.toObject() : { ...a };
      const createdTime = new Date(alertObj.createdAt || alertObj.created_at || now).getTime();
      const dueTime = alertObj.due_at ? new Date(alertObj.due_at).getTime() : (createdTime + 48 * 3600000);
      
      const agingHours = Math.max(0, Math.round((now - createdTime) / 3600000));
      const hoursUntilDue = Math.round((dueTime - now) / 3600000);
      const isOverdue = alertObj.status !== 'Closed' && alertObj.status !== 'Dismissed' && hoursUntilDue < 0;

      // Recalculate dynamic priority score
      const priorityScore = alertObj.priority_score || calculatePriorityScore({
        risk_score: alertObj.risk_score,
        level: alertObj.level,
        transaction_count: alertObj.transaction_count || 1,
        total_volume: alertObj.total_volume || 0,
        due_at: alertObj.due_at
      });

      return {
        ...alertObj,
        priority_score: priorityScore,
        aging_hours: agingHours,
        hours_until_due: hoursUntilDue,
        is_overdue: isOverdue
      };
    });

    // Queue Sorting
    enrichedList.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'priority_score') {
        comparison = (b.priority_score || 0) - (a.priority_score || 0);
      } else if (sortBy === 'due_at') {
        const timeA = a.due_at ? new Date(a.due_at).getTime() : 0;
        const timeB = b.due_at ? new Date(b.due_at).getTime() : 0;
        comparison = timeA - timeB; // Urgent earliest first
      } else if (sortBy === 'risk_score') {
        comparison = (b.risk_score || 0) - (a.risk_score || 0);
      } else if (sortBy === 'createdAt') {
        comparison = new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      } else if (sortBy === 'aging') {
        comparison = (b.aging_hours || 0) - (a.aging_hours || 0);
      }

      return sortDir === 'asc' ? -comparison : comparison;
    });

    const total = enrichedList.length;
    const parsedLimit = parseInt(limit) || 50;
    const parsedPage = parseInt(page) || 1;
    const startIndex = (parsedPage - 1) * parsedLimit;
    const paginatedAlerts = enrichedList.slice(startIndex, startIndex + parsedLimit);

    // Batched single-query Transaction lookup for all paginated alerts (prevents N+1 database queries)
    const allTxIds = new Set();
    paginatedAlerts.forEach(a => {
      if (a.transaction_id) allTxIds.add(a.transaction_id);
      if (Array.isArray(a.transaction_ids)) {
        a.transaction_ids.slice(0, 10).forEach(id => {
          if (id) allTxIds.add(id);
        });
      }
    });

    const txDocs = allTxIds.size > 0 
      ? await models.Transaction.find({ transaction_id: { $in: Array.from(allTxIds) } })
      : [];

    const txMap = new Map();
    txDocs.forEach(t => {
      const obj = typeof t.toObject === 'function' ? t.toObject() : t;
      txMap.set(obj.transaction_id, obj);
    });

    const finalAlerts = paginatedAlerts.map(alert => {
      const transaction = txMap.get(alert.transaction_id) || null;
      let childTransactions = [];
      if (Array.isArray(alert.transaction_ids) && alert.transaction_ids.length > 1) {
        childTransactions = alert.transaction_ids
          .slice(0, 10)
          .map(id => txMap.get(id))
          .filter(Boolean);
      } else if (transaction) {
        childTransactions = [transaction];
      }

      return {
        ...alert,
        transaction,
        child_transactions: childTransactions
      };
    });

    return res.json({ 
      success: true, 
      count: finalAlerts.length,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit) || 1,
      data: finalAlerts 
    });
  } catch (error) {
    console.error('[GetAlerts Error]:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/alerts/:id
 * General status and assignee updates
 */
const updateAlert = async (req, res) => {
  const { id } = req.params;
  const { status, assignee, priority_score } = req.body;

  try {
    const alertObj = await models.Alert.findOne({ alert_id: id });
    if (!alertObj) {
      return res.status(404).json({ success: false, error: 'Alert not found.' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (status) updates.status = status;
    if (assignee !== undefined) updates.assignee = assignee;
    if (priority_score !== undefined) updates.priority_score = priority_score;

    let updated;
    if (typeof models.Alert.findOneAndUpdate === 'function') {
      updated = await models.Alert.findOneAndUpdate({ alert_id: id }, updates, { new: true });
    } else {
      updated = await models.Alert.findByIdAndUpdate(id, updates);
    }

    await logAction(
      req.user ? req.user.username : 'API',
      req.user ? req.user.role : 'Guest',
      'ALERT_UPDATED',
      req.ip,
      `Updated alert ${id} - Status: ${status || alertObj.status}, Assignee: ${assignee || alertObj.assignee}`
    );

    return res.json({ success: true, message: 'Alert updated successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/alerts/:id/disposition
 * Closes an alert with mandatory disposition code and rationale, enforcing Four-Eyes validation.
 */
const dispositionAlert = async (req, res) => {
  const { id } = req.params;
  const { disposition_code, rationale, action = 'close' } = req.body;
  const currentUser = req.user ? req.user.username : 'investigator';
  const currentRole = req.user ? req.user.role : 'Investigator';

  const validCodes = [
    'False Positive',
    'True Positive - STR Filed',
    'True Positive - No Filing',
    'Insufficient Information'
  ];

  if (!disposition_code || !validCodes.includes(disposition_code)) {
    return res.status(400).json({ 
      success: false, 
      error: `Valid disposition_code is required: ${validCodes.join(', ')}` 
    });
  }

  if (!rationale || typeof rationale !== 'string' || rationale.trim().length < 5) {
    return res.status(400).json({ 
      success: false, 
      error: 'A substantive closure rationale (minimum 5 characters) is mandatory.' 
    });
  }

  try {
    const alertObj = await models.Alert.findOne({ alert_id: id });
    if (!alertObj) {
      return res.status(404).json({ success: false, error: 'Alert not found.' });
    }

    const isTruePositive = disposition_code.startsWith('True Positive');

    // Four-Eyes Principle Enforcement:
    // Closing as True Positive / STR or approving an existing proposal requires 2 different reviewers.
    if (isTruePositive) {
      if (action === 'approve') {
        // Approving an existing proposal
        if (!alertObj.proposed_by) {
          return res.status(400).json({ 
            success: false, 
            error: 'Cannot approve an alert that has not been proposed for True Positive disposition.' 
          });
        }
        if (alertObj.proposed_by === currentUser) {
          return res.status(403).json({ 
            success: false, 
            error: 'Four-eyes principle violation: Approval requires a different investigator/compliance officer than the proposer.' 
          });
        }

        // Approved by secondary reviewer: Finalize closure
        const updatePayload = {
          status: 'Closed',
          disposition_code,
          closure_reason: `[Four-Eyes Approved by ${currentUser}]: ${rationale}. (Originally proposed by ${alertObj.proposed_by}: ${alertObj.proposed_rationale || ''})`,
          closed_by: currentUser,
          closed_at: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        let updated;
        if (typeof models.Alert.findOneAndUpdate === 'function') {
          updated = await models.Alert.findOneAndUpdate({ alert_id: id }, updatePayload, { new: true });
        } else {
          updated = await models.Alert.findByIdAndUpdate(id, updatePayload);
        }

        // Record analyst disposition label for active learning retraining
        try {
          await feedbackService.recordLabelsForAlert(
            updated || alertObj,
            disposition_code,
            rationale,
            currentUser,
            'alert_closure'
          );
        } catch (labelErr) {
          console.warn(`[Feedback Logging Warning]: ${labelErr.message}`);
        }

        await logAction(
          currentUser,
          currentRole,
          'ALERT_FOUR_EYES_APPROVED',
          req.ip,
          `Approved and closed alert ${id} as "${disposition_code}" (Proposer: ${alertObj.proposed_by}, Approver: ${currentUser})`
        );

        return res.json({ 
          success: true, 
          message: `Alert ${id} approved and closed as ${disposition_code}.`, 
          data: updated 
        });
      } else {
        // First reviewer proposing True Positive / STR disposition
        const updatePayload = {
          status: 'Escalated L2',
          proposed_disposition: disposition_code,
          proposed_by: currentUser,
          proposed_rationale: rationale,
          proposed_at: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        let updated;
        if (typeof models.Alert.findOneAndUpdate === 'function') {
          updated = await models.Alert.findOneAndUpdate({ alert_id: id }, updatePayload, { new: true });
        } else {
          updated = await models.Alert.findByIdAndUpdate(id, updatePayload);
        }

        await logAction(
          currentUser,
          currentRole,
          'ALERT_DISPOSITION_PROPOSED',
          req.ip,
          `Proposed True Positive disposition for alert ${id} as "${disposition_code}". Awaiting secondary Four-Eyes approval.`
        );

        return res.json({ 
          success: true, 
          pending_approval: true,
          message: `Disposition "${disposition_code}" proposed. Under Four-Eyes compliance rules, secondary approval by another compliance officer is required to finalize.`, 
          data: updated 
        });
      }
    }

    // Standard Direct Closure for False Positive / Insufficient Information
    const updatePayload = {
      status: 'Closed',
      disposition_code,
      closure_reason: rationale,
      closed_by: currentUser,
      closed_at: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    let updated;
    if (typeof models.Alert.findOneAndUpdate === 'function') {
      updated = await models.Alert.findOneAndUpdate({ alert_id: id }, updatePayload, { new: true });
    } else {
      updated = await models.Alert.findByIdAndUpdate(id, updatePayload);
    }

    // Record analyst disposition label for active learning retraining
    try {
      await feedbackService.recordLabelsForAlert(
        updated || alertObj,
        disposition_code,
        rationale,
        currentUser,
        'alert_closure'
      );
    } catch (labelErr) {
      console.warn(`[Feedback Logging Warning]: ${labelErr.message}`);
    }

    await logAction(
      currentUser,
      currentRole,
      'ALERT_DISPOSITIONED',
      req.ip,
      `Closed alert ${id} as "${disposition_code}". Rationale: ${rationale}`
    );

    return res.json({ 
      success: true, 
      message: `Alert ${id} closed with disposition ${disposition_code}.`, 
      data: updated 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/alerts/bulk-assign
 * Assigns multiple selected alerts to a designated investigator
 */
const bulkAssignAlerts = async (req, res) => {
  const { alert_ids, assignee } = req.body;
  const currentUser = req.user ? req.user.username : 'admin';
  const currentRole = req.user ? req.user.role : 'Admin';

  if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'Array of alert_ids is required.' });
  }

  if (!assignee) {
    return res.status(400).json({ success: false, error: 'Assignee username is required.' });
  }

  try {
    let updatedCount = 0;
    const now = new Date().toISOString();

    for (const id of alert_ids) {
      if (typeof models.Alert.findOneAndUpdate === 'function') {
        await models.Alert.findOneAndUpdate(
          { alert_id: id },
          { assignee, status: 'In Review L1', updatedAt: now }
        );
      } else {
        await models.Alert.findByIdAndUpdate(id, { assignee, status: 'In Review L1', updatedAt: now });
      }
      updatedCount++;
    }

    await logAction(
      currentUser,
      currentRole,
      'ALERTS_BULK_ASSIGNED',
      req.ip,
      `Bulk assigned ${updatedCount} alerts to investigator ${assignee}`
    );

    return res.json({ 
      success: true, 
      message: `Successfully assigned ${updatedCount} alerts to ${assignee}.`,
      count: updatedCount
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/alerts/bulk-dismiss
 * Closes multiple alerts in bulk with a required disposition code and rationale
 */
const bulkDismissAlerts = async (req, res) => {
  const { alert_ids, disposition_code = 'False Positive', rationale } = req.body;
  const currentUser = req.user ? req.user.username : 'investigator';
  const currentRole = req.user ? req.user.role : 'Investigator';

  if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'Array of alert_ids is required.' });
  }

  if (!rationale || typeof rationale !== 'string' || rationale.trim().length < 5) {
    return res.status(400).json({ 
      success: false, 
      error: 'A substantive dismissal rationale (minimum 5 characters) is required for bulk dismissal.' 
    });
  }

  try {
    let closedCount = 0;
    const now = new Date().toISOString();

    for (const id of alert_ids) {
      const updatePayload = {
        status: 'Closed',
        disposition_code,
        closure_reason: `[Bulk Dismissal]: ${rationale}`,
        closed_by: currentUser,
        closed_at: now,
        updatedAt: now
      };

      if (typeof models.Alert.findOneAndUpdate === 'function') {
        await models.Alert.findOneAndUpdate({ alert_id: id }, updatePayload);
      } else {
        await models.Alert.findByIdAndUpdate(id, updatePayload);
      }

      // Record feedback label
      try {
        const aObj = await models.Alert.findOne({ alert_id: id });
        if (aObj) {
          await feedbackService.recordLabelsForAlert(aObj, disposition_code, rationale, currentUser, 'alert_closure');
        }
      } catch (_) {}

      closedCount++;
    }

    await logAction(
      currentUser,
      currentRole,
      'ALERTS_BULK_DISMISSED',
      req.ip,
      `Bulk dismissed ${closedCount} alerts with disposition "${disposition_code}". Rationale: ${rationale}`
    );

    return res.json({ 
      success: true, 
      message: `Successfully dismissed ${closedCount} alerts.`,
      count: closedCount 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/alerts/active-learning
 * Returns open, unlabeled alerts prioritized by model uncertainty (calibrated probability near decision threshold).
 */
const getActiveLearningAlerts = async (req, res) => {
  try {
    const { limit = 50, threshold, bandWidth } = req.query;
    const queue = await feedbackService.getActiveLearningQueue({ limit, threshold, bandWidth });
    return res.json({
      success: true,
      count: queue.length,
      data: queue
    });
  } catch (error) {
    console.error('[ActiveLearning Queue Error]:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getAlerts,
  updateAlert,
  dispositionAlert,
  bulkAssignAlerts,
  bulkDismissAlerts,
  getActiveLearningAlerts
};
