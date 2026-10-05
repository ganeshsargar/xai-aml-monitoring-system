const axios = require('axios');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { generateCasePDF } = require('../config/reportGenerator');
const { getAlertLevel } = require('../config/riskConfig');
const { generateCaseId, generateAlertId } = require('../services/alertService');

/**
 * Helper to record a timeline event on a Case
 */
async function appendTimelineEvent(caseId, event) {
  const timelineItem = {
    event_type: event.event_type || 'system',
    user: event.user || 'System',
    role: event.role || 'Investigator',
    action: event.action,
    details: event.details || '',
    timestamp: new Date().toISOString()
  };

  if (typeof models.Case.findOneAndUpdate === 'function') {
    await models.Case.findOneAndUpdate(
      { case_id: caseId },
      { 
        $push: { timeline: timelineItem },
        updatedAt: new Date().toISOString()
      }
    );
  } else {
    const caseObj = await models.Case.findById(caseId);
    if (caseObj) {
      const existingTimeline = Array.isArray(caseObj.timeline) ? caseObj.timeline : [];
      existingTimeline.push(timelineItem);
      await models.Case.findByIdAndUpdate(caseId, { 
        timeline: existingTimeline,
        updatedAt: new Date().toISOString()
      });
    }
  }
}

/**
 * GET /api/cases
 * Returns all cases sorted by latest updated with timeline entries.
 */
const getCases = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status) filter.status = status;

    let list = await models.Case.find(filter);

    if (search) {
      const q = search.trim().toLowerCase();
      list = list.filter(c => 
        (c.case_id && c.case_id.toLowerCase().includes(q)) ||
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.assigned_to && c.assigned_to.toLowerCase().includes(q))
      );
    }

    // Sort by latest updated
    const sorted = list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return res.json({ success: true, count: sorted.length, data: sorted });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/cases/:id
 * Get single case details including linked alerts, child transactions, and timeline
 */
const getCaseById = async (req, res) => {
  const { id } = req.params;
  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    // Batched single-query lookup of linked alerts and transactions (prevents N+1 loops)
    const alertIds = Array.isArray(caseObj.alerts) ? caseObj.alerts : [];
    const alertDocs = alertIds.length > 0 
      ? await models.Alert.find({ alert_id: { $in: alertIds } })
      : [];

    const txIds = alertDocs.map(a => a.transaction_id).filter(Boolean);
    const txDocs = txIds.length > 0
      ? await models.Transaction.find({ transaction_id: { $in: txIds } })
      : [];

    const txMap = new Map();
    txDocs.forEach(t => {
      const obj = typeof t.toObject === 'function' ? t.toObject() : t;
      txMap.set(obj.transaction_id, obj);
    });

    const alertsData = alertDocs.map(alertDoc => {
      const alertObj = typeof alertDoc.toObject === 'function' ? alertDoc.toObject() : alertDoc;
      return {
        ...alertObj,
        transaction: txMap.get(alertObj.transaction_id) || null
      };
    });

    return res.json({
      success: true,
      data: {
        ...(typeof caseObj.toObject === 'function' ? caseObj.toObject() : caseObj),
        linked_alerts_data: alertsData
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/cases
 * Creates a case linking one or more alerts / transactions with collision-safe IDs
 */
const createCase = async (req, res) => {
  const { title, alerts = [], transaction_id } = req.body;
  const currentUser = req.user ? req.user.username : 'investigator';
  const currentRole = req.user ? req.user.role : 'Investigator';

  if (!title) {
    return res.status(400).json({ success: false, error: 'Case title is required.' });
  }

  const linkedAlerts = Array.isArray(alerts) ? [...alerts] : [];

  try {
    // If a transaction_id was supplied directly (e.g. escalating from transaction table)
    if (transaction_id) {
      let existingAlert = await models.Alert.findOne({ 
        $or: [{ transaction_id }, { transaction_ids: transaction_id }]
      });

      if (!existingAlert) {
        const tx = await models.Transaction.findOne({ transaction_id });
        const alertId = generateAlertId();
        const txRisk = tx ? tx.risk_score : 50;
        existingAlert = await models.Alert.create({
          alert_id: alertId,
          transaction_id,
          transaction_ids: [transaction_id],
          risk_score: txRisk,
          level: getAlertLevel(txRisk) || 'Medium',
          status: 'In Review L1',
          assignee: currentUser,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      if (!linkedAlerts.includes(existingAlert.alert_id)) {
        linkedAlerts.push(existingAlert.alert_id);
      }
    }

    if (linkedAlerts.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one alert or transaction must be linked to create a case.' });
    }

    // Generate Collision-Safe Case ID
    const caseId = generateCaseId();
    const now = new Date().toISOString();

    const initialTimeline = [
      {
        event_type: 'creation',
        user: currentUser,
        role: currentRole,
        action: 'Case Created',
        details: `Created investigation case linking ${linkedAlerts.length} alert(s): ${linkedAlerts.join(', ')}`,
        timestamp: now
      }
    ];

    const newCase = await models.Case.create({
      case_id: caseId,
      title,
      alerts: linkedAlerts,
      notes: [],
      timeline: initialTimeline,
      evidence: [],
      status: 'Open',
      assigned_to: currentUser,
      createdAt: now,
      updatedAt: now
    });

    // Update linked alerts status to In Review L1
    for (const alertId of linkedAlerts) {
      if (typeof models.Alert.findOneAndUpdate === 'function') {
        await models.Alert.findOneAndUpdate(
          { alert_id: alertId }, 
          { status: 'In Review L1', assignee: currentUser, updatedAt: now }
        );
      } else {
        await models.Alert.findByIdAndUpdate(alertId, { 
          status: 'In Review L1', 
          assignee: currentUser, 
          updatedAt: now 
        });
      }
    }

    await logAction(
      currentUser,
      currentRole,
      'CASE_CREATED',
      req.ip,
      `Created investigation case ${caseId} linking ${linkedAlerts.length} alerts`
    );

    return res.status(201).json({ success: true, message: 'Case created successfully.', data: newCase });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/cases/:id/assign
 */
const assignCase = async (req, res) => {
  const { id } = req.params;
  const { investigator } = req.body;
  const currentUser = req.user ? req.user.username : 'admin';
  const currentRole = req.user ? req.user.role : 'Admin';

  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    let updated;
    const now = new Date().toISOString();
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, { 
        assigned_to: investigator,
        updatedAt: now
      }, { new: true });
    } else {
      updated = await models.Case.findByIdAndUpdate(id, { 
        assigned_to: investigator,
        updatedAt: now
      });
    }

    await appendTimelineEvent(id, {
      event_type: 'assignment',
      user: currentUser,
      role: currentRole,
      action: 'Investigator Assigned',
      details: `Case assigned to investigator "${investigator}" by ${currentUser}`
    });

    await logAction(
      currentUser,
      currentRole,
      'CASE_ASSIGNED',
      req.ip,
      `Assigned case ${id} to ${investigator}`
    );

    return res.json({ success: true, message: 'Case investigator assigned successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/cases/:id/notes
 */
const addNote = async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  const currentUser = req.user ? req.user.username : 'investigator';
  const currentRole = req.user ? req.user.role : 'Investigator';

  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: 'Note text cannot be empty.' });
  }

  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    const note = {
      investigator: currentUser,
      text: text.trim(),
      timestamp: new Date().toISOString()
    };

    let updated;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, {
        $push: { notes: note },
        updatedAt: new Date().toISOString()
      }, { new: true });
    } else {
      const existingNotes = Array.isArray(caseObj.notes) ? caseObj.notes : [];
      existingNotes.push(note);
      updated = await models.Case.findByIdAndUpdate(id, {
        notes: existingNotes,
        updatedAt: new Date().toISOString()
      });
    }

    await appendTimelineEvent(id, {
      event_type: 'note',
      user: currentUser,
      role: currentRole,
      action: 'Note Added',
      details: text.trim()
    });

    await logAction(
      currentUser,
      currentRole,
      'CASE_NOTE_ADDED',
      req.ip,
      `Added note to case ${id}`
    );

    return res.json({ success: true, message: 'Note added successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/cases/:id/evidence
 */
const uploadEvidence = async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user ? req.user.username : 'investigator';
  const currentRole = req.user ? req.user.role : 'Investigator';

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    const crypto = require('crypto');
    const fs = require('fs');
    const { generatePrefixedId } = require('../utils/idGenerator');

    // Compute SHA-256 cryptographic checksum of the uploaded evidence file
    let checksum = null;
    if (req.file.path && fs.existsSync(req.file.path)) {
      const fileBuffer = fs.readFileSync(req.file.path);
      checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } else if (req.file.buffer) {
      checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    }

    const fileData = {
      evidence_id: generatePrefixedId('EVD'),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mime_type: req.file.mimetype || 'application/octet-stream',
      size_bytes: req.file.size || 0,
      checksum_sha256: checksum,
      uploadedBy: currentUser,
      uploadedAt: new Date().toISOString()
    };

    let updated;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, {
        $push: { evidence: fileData },
        updatedAt: new Date().toISOString()
      }, { new: true });
    } else {
      const existingEvidence = Array.isArray(caseObj.evidence) ? caseObj.evidence : [];
      existingEvidence.push(fileData);
      updated = await models.Case.findByIdAndUpdate(id, {
        evidence: existingEvidence,
        updatedAt: new Date().toISOString()
      });
    }

    await appendTimelineEvent(id, {
      event_type: 'evidence',
      user: currentUser,
      role: currentRole,
      action: 'Evidence Document Uploaded',
      details: `Uploaded compliance artifact "${req.file.originalname}" (SHA-256: ${checksum ? checksum.substring(0, 16) + '...' : 'N/A'})`
    });

    await logAction(
      currentUser,
      currentRole,
      'CASE_EVIDENCE_UPLOADED',
      req.ip,
      `Uploaded evidence ${req.file.originalname} (SHA-256: ${checksum}) to case ${id}`
    );

    return res.json({ success: true, message: 'Evidence uploaded successfully.', file: fileData });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/cases/:id/status
 * Updates case status across ['Open', 'Under Review', 'Pending STR', 'Closed'].
 * 
 * FIX BUG: Closing a case must NEVER force linked alerts into "Escalated".
 * Each alert preserves its own individual status and disposition.
 */
const updateCaseStatus = async (req, res) => {
  const { id } = req.params;
  const { status, disposition_code, rationale } = req.body;
  const currentUser = req.user ? req.user.username : 'investigator';
  const currentRole = req.user ? req.user.role : 'Investigator';

  const validStatuses = ['Open', 'Under Review', 'Pending STR', 'Closed'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ 
      success: false, 
      error: `Status must be one of: ${validStatuses.join(', ')}` 
    });
  }

  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    const previousStatus = caseObj.status;
    const now = new Date().toISOString();

    const updatePayload = {
      status,
      updatedAt: now
    };

    if (status === 'Closed') {
      updatePayload.closed_by = currentUser;
      updatePayload.closed_at = now;
      if (disposition_code) updatePayload.disposition_code = disposition_code;
      if (rationale) updatePayload.closure_reason = rationale;
    }

    let updated;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, updatePayload, { new: true });
    } else {
      updated = await models.Case.findByIdAndUpdate(id, updatePayload);
    }

    if (status === 'Closed' && disposition_code) {
      try {
        const feedbackService = require('../services/feedbackService');
        await feedbackService.recordLabelsForCase(caseObj, disposition_code, rationale, currentUser, 'case_closure');
      } catch (lblErr) {
        console.warn(`[Feedback Logging Warning on Case Close]: ${lblErr.message}`);
      }
    }

    await appendTimelineEvent(id, {
      event_type: 'status_change',
      user: currentUser,
      role: currentRole,
      action: 'Status Transition',
      details: `Case status changed from "${previousStatus}" to "${status}"${rationale ? `. Rationale: ${rationale}` : ''}`
    });

    await logAction(
      currentUser,
      currentRole,
      'CASE_STATUS_UPDATED',
      req.ip,
      `Updated case ${id} status to ${status}`
    );

    return res.json({ success: true, message: 'Case status updated successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/cases/:id/merge
 * Merges a source case into this target case.
 * Transits alerts, evidence, notes and marks source case as merged & closed.
 */
const mergeCase = async (req, res) => {
  const { id } = req.params;
  const { source_case_id, rationale } = req.body;
  const currentUser = req.user ? req.user.username : 'investigator';
  const currentRole = req.user ? req.user.role : 'Investigator';

  if (!source_case_id || source_case_id === id) {
    return res.status(400).json({ success: false, error: 'Valid distinct source_case_id is required.' });
  }

  try {
    const targetCase = await models.Case.findOne({ case_id: id });
    const sourceCase = await models.Case.findOne({ case_id: source_case_id });

    if (!targetCase) return res.status(404).json({ success: false, error: 'Target case not found.' });
    if (!sourceCase) return res.status(404).json({ success: false, error: 'Source case not found.' });

    if (sourceCase.status === 'Closed' && sourceCase.merged_into_case_id) {
      return res.status(400).json({ 
        success: false, 
        error: `Source case ${source_case_id} has already been merged into ${sourceCase.merged_into_case_id}.` 
      });
    }

    const now = new Date().toISOString();

    // 1. Union alerts
    const targetAlerts = Array.isArray(targetCase.alerts) ? targetCase.alerts : [];
    const sourceAlerts = Array.isArray(sourceCase.alerts) ? sourceCase.alerts : [];
    const combinedAlerts = [...new Set([...targetAlerts, ...sourceAlerts])];

    // 2. Union evidence
    const targetEvidence = Array.isArray(targetCase.evidence) ? targetCase.evidence : [];
    const sourceEvidence = Array.isArray(sourceCase.evidence) ? sourceCase.evidence : [];
    const combinedEvidence = [...targetEvidence, ...sourceEvidence];

    // 3. Union merged case references
    const targetMerged = Array.isArray(targetCase.merged_cases) ? targetCase.merged_cases : [];
    if (!targetMerged.includes(source_case_id)) targetMerged.push(source_case_id);

    // 4. Update target case
    const targetUpdate = {
      alerts: combinedAlerts,
      evidence: combinedEvidence,
      merged_cases: targetMerged,
      updatedAt: now
    };

    let updatedTarget;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updatedTarget = await models.Case.findOneAndUpdate({ case_id: id }, targetUpdate, { new: true });
    } else {
      updatedTarget = await models.Case.findByIdAndUpdate(id, targetUpdate);
    }

    // 5. Add timeline entries
    await appendTimelineEvent(id, {
      event_type: 'case_merged',
      user: currentUser,
      role: currentRole,
      action: 'Case Merged',
      details: `Merged case ${source_case_id} ("${sourceCase.title}") into this investigation. Added ${sourceAlerts.length} alert(s) and ${sourceEvidence.length} evidence file(s). ${rationale ? `Rationale: ${rationale}` : ''}`
    });

    // 6. Close source case and link to target
    const sourceUpdate = {
      status: 'Closed',
      merged_into_case_id: id,
      closure_reason: `Merged into parent case ${id} by ${currentUser}. ${rationale || ''}`,
      closed_by: currentUser,
      closed_at: now,
      updatedAt: now
    };

    if (typeof models.Case.findOneAndUpdate === 'function') {
      await models.Case.findOneAndUpdate({ case_id: source_case_id }, sourceUpdate);
    } else {
      await models.Case.findByIdAndUpdate(source_case_id, sourceUpdate);
    }

    await appendTimelineEvent(source_case_id, {
      event_type: 'case_merged',
      user: currentUser,
      role: currentRole,
      action: 'Case Closed & Merged',
      details: `This case was merged into target case ${id} ("${targetCase.title}").`
    });

    await logAction(
      currentUser,
      currentRole,
      'CASE_MERGED',
      req.ip,
      `Merged case ${source_case_id} into ${id}`
    );

    return res.json({ 
      success: true, 
      message: `Successfully merged case ${source_case_id} into ${id}.`,
      data: updatedTarget 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/cases/:id/report
 */
const downloadReport = async (req, res) => {
  const { id } = req.params;
  
  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    // Gather transaction details for all alerts in the case
    const transactions = [];
    for (const alertId of (caseObj.alerts || [])) {
      const alert = await models.Alert.findOne({ alert_id: alertId });
      if (alert) {
        const tx = await models.Transaction.findOne({ transaction_id: alert.transaction_id });
        if (tx) transactions.push(tx);
      }
    }

    // Call Python service to get graph analytics for the report
    let graphSummary = null;
    try {
      const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000';
      const graphRes = await axios.post(`${mlServiceUrl}/graph-analysis`, {
        transactions: transactions
      }, { timeout: 2000 });

      if (graphRes.data && graphRes.data.success) {
        graphSummary = graphRes.data.data.summary;
      }
    } catch (e) {
      console.warn(`[Report Graph Fallback]: Could not fetch graph details from Python: ${e.message}`);
    }

    // Set HTTP Response Headers for PDF Download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=case_${id}_report.pdf`);

    // Generate PDF directly piped into Express response stream
    generateCasePDF(caseObj, transactions, graphSummary, res);

    await logAction(
      req.user ? req.user.username : 'API',
      req.user ? req.user.role : 'Guest',
      'CASE_REPORT_DOWNLOADED',
      req.ip,
      `Downloaded PDF report for case ${id}`
    );
  } catch (error) {
    if (res.headersSent) return;
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/cases/:id/graph
 */
const getCaseGraph = async (req, res) => {
  const { id } = req.params;
  
  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    const MAX_GRAPH_TRANSACTIONS = 60;
    const MAX_SEED_ACCOUNTS = 20;

    // 1. Gather base transaction details for all alerts in the case via batched lookup
    const alertIds = Array.isArray(caseObj.alerts) ? caseObj.alerts : [];
    const alertDocs = alertIds.length > 0 
      ? await models.Alert.find({ alert_id: { $in: alertIds } })
      : [];

    const baseTxIds = alertDocs.map(a => a.transaction_id).filter(Boolean);
    const baseTxDocs = baseTxIds.length > 0
      ? await models.Transaction.find({ transaction_id: { $in: baseTxIds } })
      : [];

    const baseTxMap = new Map();
    baseTxDocs.forEach(tx => {
      const obj = typeof tx.toObject === 'function' ? tx.toObject() : tx;
      baseTxMap.set(obj.transaction_id, obj);
    });

    if (baseTxMap.size === 0) {
      return res.json({
        success: true,
        data: {
          elements: [],
          summary: { num_nodes: 0, num_edges: 0, cycles_count: 0, num_communities: 0 },
          transactions: []
        }
      });
    }

    // 2. Multi-Hop Graph Expansion: Trace connected counterparties with bounded bounds
    const graphTxMap = new Map(baseTxMap);
    const seedAccounts = new Set();
    for (const tx of baseTxMap.values()) {
      if (tx.sender_account) seedAccounts.add(tx.sender_account);
      if (tx.receiver_account) seedAccounts.add(tx.receiver_account);
      if (seedAccounts.size >= MAX_SEED_ACCOUNTS) break;
    }

    const seedArr = Array.from(seedAccounts);

    // Hop 1 (batched query)
    const hop1Txs = await models.Transaction.find({
      $or: [
        { sender_account: { $in: seedArr } },
        { receiver_account: { $in: seedArr } }
      ]
    }).limit(40);

    const hop1Accounts = new Set();
    for (const tx of hop1Txs) {
      if (graphTxMap.size >= MAX_GRAPH_TRANSACTIONS - 15) break;
      if (!graphTxMap.has(tx.transaction_id)) {
        graphTxMap.set(tx.transaction_id, tx);
      }
      if (tx.sender_account && !seedAccounts.has(tx.sender_account)) {
        hop1Accounts.add(tx.sender_account);
      }
      if (tx.receiver_account && !seedAccounts.has(tx.receiver_account)) {
        hop1Accounts.add(tx.receiver_account);
      }
    }

    // Hop 2 (bounded counterparty expansion)
    if (hop1Accounts.size > 0 && graphTxMap.size < MAX_GRAPH_TRANSACTIONS - 10) {
      const hop1Arr = Array.from(hop1Accounts).slice(0, 15);
      const hop2Txs = await models.Transaction.find({
        $or: [
          { sender_account: { $in: hop1Arr } },
          { receiver_account: { $in: hop1Arr } }
        ]
      }).limit(25);

      for (const tx of hop2Txs) {
        if (graphTxMap.size >= MAX_GRAPH_TRANSACTIONS) break;
        if (!graphTxMap.has(tx.transaction_id)) {
          graphTxMap.set(tx.transaction_id, tx);
        }
      }
    }

    const transactions = Array.from(graphTxMap.values());

    // Try calling Python ML service for NetworkX graph analytics
    let graphData = null;
    try {
      const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000';
      const graphRes = await axios.post(`${mlServiceUrl}/graph-analysis`, {
        transactions: transactions
      }, { timeout: 4000 });

      if (graphRes.data && graphRes.data.success) {
        graphData = graphRes.data.data;
      }
    } catch (mlErr) {
      console.warn(`[Case Graph]: ML service call failed (${mlErr.message}), constructing local network visualizer...`);
    }

    // Local Cytoscape visualizer fallback
    if (!graphData || !graphData.elements || graphData.elements.length === 0) {
      const nodeMap = new Map();
      const edgeList = [];

      transactions.forEach((tx, idx) => {
        const sender = tx.sender_account || 'Unknown_Sender';
        const receiver = tx.receiver_account || 'Unknown_Receiver';
        const amount = tx.amount || 0;
        const isLaundering = tx.is_laundering || 0;
        const riskLevel = getAlertLevel(tx.risk_score) || 'Low';

        if (!nodeMap.has(sender)) {
          nodeMap.set(sender, {
            data: {
              id: sender,
              label: `${tx.sender_name || 'Account'}\n(${sender})`,
              account_number: sender,
              holder_name: tx.sender_name || 'Account Holder',
              risk_level: riskLevel,
              pagerank: 0.6,
              community: 1,
              type: 'node',
              total_volume: amount,
              transaction_count: 1
            }
          });
        } else {
          const n = nodeMap.get(sender);
          n.data.total_volume += amount;
          n.data.transaction_count += 1;
        }

        if (!nodeMap.has(receiver)) {
          nodeMap.set(receiver, {
            data: {
              id: receiver,
              label: `${tx.receiver_name || 'Account'}\n(${receiver})`,
              account_number: receiver,
              holder_name: tx.receiver_name || 'Account Holder',
              risk_level: riskLevel,
              pagerank: 0.4,
              community: 1,
              type: 'node',
              total_volume: amount,
              transaction_count: 1
            }
          });
        } else {
          const n = nodeMap.get(receiver);
          n.data.total_volume += amount;
          n.data.transaction_count += 1;
        }

        edgeList.push({
          data: {
            id: `edge_${tx.transaction_id || idx}`,
            source: sender,
            target: receiver,
            amount: amount,
            is_laundering: isLaundering,
            type: 'edge'
          }
        });
      });

      graphData = {
        elements: [...nodeMap.values(), ...edgeList],
        summary: {
          num_nodes: nodeMap.size,
          num_edges: edgeList.length,
          cycles_count: 0,
          num_communities: 1
        }
      };
    }

    return res.json({
      success: true,
      data: {
        elements: graphData.elements,
        summary: graphData.summary,
        transactions
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getCases,
  getCaseById,
  createCase,
  assignCase,
  addNote,
  uploadEvidence,
  updateCaseStatus,
  mergeCase,
  downloadReport,
  getCaseGraph
};
