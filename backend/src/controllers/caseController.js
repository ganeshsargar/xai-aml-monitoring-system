const axios = require('axios');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { generateCasePDF } = require('../config/reportGenerator');

const getCases = async (req, res) => {
  try {
    const list = await models.Case.find({});
    // Sort by latest updated
    const sorted = list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return res.json({ success: true, count: sorted.length, data: sorted });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const createCase = async (req, res) => {
  const { title, alerts = [], transaction_id } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, error: 'Case title is required.' });
  }

  const linkedAlerts = Array.isArray(alerts) ? [...alerts] : [];

  try {
    // If a transaction_id was supplied directly (e.g. escalating from transaction table)
    if (transaction_id) {
      let existingAlert = await models.Alert.findOne({ transaction_id });
      if (!existingAlert) {
        const tx = await models.Transaction.findOne({ transaction_id });
        const alertId = 'ALT' + Math.floor(100000 + Math.random() * 900000);
        existingAlert = await models.Alert.create({
          alert_id: alertId,
          transaction_id,
          risk_score: tx ? tx.risk_score : 50,
          level: (tx && tx.risk_score >= 80) ? 'Critical' : (tx && tx.risk_score >= 60) ? 'High' : 'Medium',
          status: 'Investigating'
        });
      }
      if (!linkedAlerts.includes(existingAlert.alert_id)) {
        linkedAlerts.push(existingAlert.alert_id);
      }
    }

    if (linkedAlerts.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one alert or transaction must be linked to create a case.' });
    }

    const caseId = 'CASE' + Math.floor(100000 + Math.random() * 900000);
    
    const newCase = await models.Case.create({
      case_id: caseId,
      title,
      alerts: linkedAlerts,
      notes: [],
      evidence: [],
      status: 'Open',
      assigned_to: req.user.username // Auto-assign to creator
    });

    // Update linked alerts status to Investigating
    for (const alertId of linkedAlerts) {
      if (typeof models.Alert.findOneAndUpdate === 'function') {
        await models.Alert.findOneAndUpdate({ alert_id: alertId }, { status: 'Investigating' });
      } else {
        await models.Alert.findByIdAndUpdate(alertId, { status: 'Investigating' });
      }
    }

    await logAction(
      req.user.username,
      req.user.role,
      'CASE_CREATED',
      req.ip,
      `Created investigation case ${caseId} linking ${alerts.length} alerts`
    );

    return res.status(201).json({ success: true, message: 'Case created successfully.', data: newCase });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const assignCase = async (req, res) => {
  const { id } = req.params;
  const { investigator } = req.body;

  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    // Verify target user is an Investigator or Admin
    const user = await models.User.findOne({ username: investigator });
    if (!user || !['Investigator', 'Admin'].includes(user.role)) {
      return res.status(400).json({ success: false, error: 'Target user must be a registered Investigator or Admin.' });
    }

    let updated;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, { 
        assigned_to: investigator,
        updatedAt: new Date().toISOString()
      }, { new: true });
    } else {
      updated = await models.Case.findByIdAndUpdate(id, { 
        assigned_to: investigator,
        updatedAt: new Date().toISOString()
      });
    }

    await logAction(
      req.user.username,
      req.user.role,
      'CASE_ASSIGNED',
      req.ip,
      `Assigned case ${id} to ${investigator}`
    );

    return res.json({ success: true, message: 'Case investigator assigned successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const addNote = async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ success: false, error: 'Note text cannot be empty.' });
  }

  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    const note = {
      investigator: req.user.username,
      text,
      timestamp: new Date().toISOString()
    };

    let updated;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, {
        $push: { notes: note },
        updatedAt: new Date().toISOString()
      }, { new: true });
    } else {
      updated = await models.Case.findByIdAndUpdate(id, {
        $push: { notes: note },
        updatedAt: new Date().toISOString()
      });
    }

    await logAction(
      req.user.username,
      req.user.role,
      'CASE_NOTE_ADDED',
      req.ip,
      `Added note to case ${id}`
    );

    return res.json({ success: true, message: 'Note added successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const uploadEvidence = async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    const fileData = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      uploadedAt: new Date().toISOString()
    };

    let updated;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, {
        $push: { evidence: fileData },
        updatedAt: new Date().toISOString()
      }, { new: true });
    } else {
      updated = await models.Case.findByIdAndUpdate(id, {
        $push: { evidence: fileData },
        updatedAt: new Date().toISOString()
      });
    }

    await logAction(
      req.user.username,
      req.user.role,
      'CASE_EVIDENCE_UPLOADED',
      req.ip,
      `Uploaded evidence ${req.file.originalname} to case ${id}`
    );

    return res.json({ success: true, message: 'Evidence uploaded successfully.', file: fileData });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateCaseStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // status: Open, Under Review, Closed

  if (!status) {
    return res.status(400).json({ success: false, error: 'Status is required.' });
  }

  try {
    let updated;
    if (typeof models.Case.findOneAndUpdate === 'function') {
      updated = await models.Case.findOneAndUpdate({ case_id: id }, {
        status,
        updatedAt: new Date().toISOString()
      }, { new: true });
    } else {
      updated = await models.Case.findByIdAndUpdate(id, {
        status,
        updatedAt: new Date().toISOString()
      });
    }
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    // If case is closed, update status of linked alerts to Escalated/Dismissed or matching
    if (status === 'Closed') {
      for (const alertId of updated.alerts) {
        if (typeof models.Alert.findOneAndUpdate === 'function') {
          await models.Alert.findOneAndUpdate({ alert_id: alertId }, { status: 'Escalated' });
        } else {
          await models.Alert.findByIdAndUpdate(alertId, { status: 'Escalated' });
        }
      }
    }

    await logAction(
      req.user.username,
      req.user.role,
      'CASE_STATUS_UPDATED',
      req.ip,
      `Updated case ${id} status to ${status}`
    );

    return res.json({ success: true, message: 'Case status updated successfully.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const downloadReport = async (req, res) => {
  const { id } = req.params;
  
  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    // Gather transaction details for all alerts in the case
    const transactions = [];
    for (const alertId of caseObj.alerts) {
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
      req.user.username,
      req.user.role,
      'CASE_REPORT_DOWNLOADED',
      req.ip,
      `Downloaded PDF report for case ${id}`
    );
  } catch (error) {
    // If headers already set, we cannot modify response
    if (res.headersSent) {
      return;
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getCaseGraph = async (req, res) => {
  const { id } = req.params;
  
  try {
    const caseObj = await models.Case.findOne({ case_id: id });
    if (!caseObj) {
      return res.status(404).json({ success: false, error: 'Case not found.' });
    }

    // 1. Gather base transaction details for all alerts in the case
    const baseTxMap = new Map();
    for (const alertId of caseObj.alerts) {
      const alert = await models.Alert.findOne({ alert_id: alertId });
      if (alert) {
        const tx = await models.Transaction.findOne({ transaction_id: alert.transaction_id });
        if (tx && !baseTxMap.has(tx.transaction_id)) {
          baseTxMap.set(tx.transaction_id, tx);
        }
      }
    }

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

    // 2. Multi-Hop Graph Expansion: Trace connected counterparties to uncover rings & chains
    const graphTxMap = new Map(baseTxMap);
    const seedAccounts = new Set();
    for (const tx of baseTxMap.values()) {
      if (tx.sender_account) seedAccounts.add(tx.sender_account);
      if (tx.receiver_account) seedAccounts.add(tx.receiver_account);
    }

    const seedArr = Array.from(seedAccounts);

    // Hop 1: Find transfers directly involving the seed accounts (where B forwarded or who sent to A)
    const hop1Txs = await models.Transaction.find({
      $or: [
        { sender_account: { $in: seedArr } },
        { receiver_account: { $in: seedArr } }
      ]
    });

    const hop1Accounts = new Set();
    for (const tx of hop1Txs) {
      if (graphTxMap.size >= 45) break;
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

    // Hop 2: For discovered counterparties, find transfers that interconnect or loop back to seed accounts
    if (hop1Accounts.size > 0 && graphTxMap.size < 50) {
      const hop1Arr = Array.from(hop1Accounts).slice(0, 20);
      const hop2Txs = await models.Transaction.find({
        $or: [
          { sender_account: { $in: hop1Arr } },
          { receiver_account: { $in: hop1Arr } }
        ]
      });

      for (const tx of hop2Txs) {
        if (graphTxMap.size >= 55) break;
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

    // If Python service didn't return, build Cytoscape elements locally from actual transaction data
    if (!graphData || !graphData.elements || graphData.elements.length === 0) {
      const nodeMap = new Map();
      const edgeList = [];

      transactions.forEach((tx, idx) => {
        const sender = tx.sender_account || 'Unknown_Sender';
        const receiver = tx.receiver_account || 'Unknown_Receiver';
        const amount = tx.amount || 0;
        const isLaundering = tx.is_laundering || 0;
        const riskLevel = tx.risk_score >= 80 ? 'Critical' : tx.risk_score >= 60 ? 'High' : tx.risk_score >= 35 ? 'Medium' : 'Low';

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
  createCase,
  assignCase,
  addNote,
  uploadEvidence,
  updateCaseStatus,
  downloadReport,
  getCaseGraph
};
