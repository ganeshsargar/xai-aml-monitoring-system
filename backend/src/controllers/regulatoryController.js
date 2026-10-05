/**
 * FundTraceAI - Regulatory Reporting Controller
 * Handles STR drafting, Four-Eyes approval, XML/JSON/PDF exports, and CTR cash aggregation
 */

const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const {
  getRegulatorySchema,
  generateSTRFromCase,
  generateCTRReport,
  exportReportXML
} = require('../services/regulatoryService');
const { generateSTRPDF, generateCTRPDF } = require('../config/reportGenerator');

/**
 * GET /api/reports/str
 * List all STR records with overdue calculation
 */
async function getSTRs(req, res) {
  try {
    const { status, case_id, overdue } = req.query;
    let query = {};
    if (status) query.status = status;
    if (case_id) query.case_id = case_id;

    const strs = await models.STRReport.find(query).sort({ createdAt: -1 });
    const now = new Date();

    const formatted = strs.map(s => {
      const doc = s.toObject ? s.toObject() : s;
      const isOverdue = doc.due_date && new Date(doc.due_date) < now && doc.status !== 'Filed';
      return {
        ...doc,
        is_overdue: isOverdue
      };
    });

    if (overdue === 'true') {
      return res.json(formatted.filter(s => s.is_overdue));
    }

    return res.json(formatted);
  } catch (err) {
    console.error('[regulatoryController] Error in getSTRs:', err);
    return res.status(500).json({ error: 'Failed to fetch STR records', message: err.message });
  }
}

/**
 * GET /api/reports/str/:id
 * Retrieve a single STR by ID (str_id or Mongo _id)
 */
async function getSTRById(req, res) {
  try {
    const { id } = req.params;
    let str = await models.STRReport.findOne({ str_id: id });
    if (!str && id.match(/^[0-9a-fA-F]{24}$/)) {
      str = await models.STRReport.findById(id);
    }
    if (!str) {
      return res.status(404).json({ error: 'STR not found' });
    }
    const doc = str.toObject ? str.toObject() : str;
    const isOverdue = doc.due_date && new Date(doc.due_date) < new Date() && doc.status !== 'Filed';
    return res.json({ ...doc, is_overdue: isOverdue });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch STR', message: err.message });
  }
}

/**
 * POST /api/reports/str/generate
 * Drafts an STR from a Case record
 */
async function generateSTR(req, res) {
  try {
    const { case_id } = req.body;
    if (!case_id) {
      return res.status(400).json({ error: 'case_id is required' });
    }

    const strDoc = await generateSTRFromCase(case_id, req.user);
    return res.status(201).json({
      message: 'STR draft generated successfully',
      str: strDoc
    });
  } catch (err) {
    console.error('[regulatoryController] Error generating STR:', err);
    return res.status(500).json({ error: 'Failed to generate STR draft', message: err.message });
  }
}

/**
 * PUT /api/reports/str/:id
 * Update narrative, suspicion code, or subject details in draft STR
 */
async function updateSTR(req, res) {
  try {
    const { id } = req.params;
    const { narrative, ground_for_suspicion_code, subject, status } = req.body;

    let str = await models.STRReport.findOne({ str_id: id });
    if (!str && id.match(/^[0-9a-fA-F]{24}$/)) {
      str = await models.STRReport.findById(id);
    }
    if (!str) {
      return res.status(404).json({ error: 'STR record not found' });
    }

    if (str.status === 'Filed') {
      return res.status(400).json({ error: 'Cannot modify an STR that has already been filed' });
    }

    if (narrative !== undefined) str.narrative = narrative;
    if (ground_for_suspicion_code) str.ground_for_suspicion_code = ground_for_suspicion_code;
    if (subject) str.subject = { ...str.subject, ...subject };
    if (status && ['Draft', 'Pending Approval'].includes(status)) {
      str.status = status;
    }

    await str.save();

    await logAction({
      action: 'STR_UPDATED',
      entity_type: 'STRReport',
      entity_id: str.str_id,
      user: req.user ? req.user.username : 'system',
      details: { updated_fields: Object.keys(req.body) },
      ip_address: req.ip
    });

    return res.json({ message: 'STR updated successfully', str });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update STR', message: err.message });
  }
}

/**
 * POST /api/reports/str/:id/approve
 * Four-Eyes Approval: Approver MUST differ from Preparer
 */
async function approveSTR(req, res) {
  try {
    const { id } = req.params;
    const approverName = req.user ? req.user.username : 'compliance_officer';

    let str = await models.STRReport.findOne({ str_id: id });
    if (!str && id.match(/^[0-9a-fA-F]{24}$/)) {
      str = await models.STRReport.findById(id);
    }
    if (!str) {
      return res.status(404).json({ error: 'STR not found' });
    }

    // Four-Eyes Rule validation
    if (str.prepared_by && str.prepared_by.toLowerCase() === approverName.toLowerCase()) {
      return res.status(403).json({
        error: 'Four-Eyes Principle Violation: Approver cannot be the same user who prepared the STR draft.'
      });
    }

    str.status = 'Pending Approval'; // Approved by compliance, awaiting final dispatch / ready for filing
    str.approved_by = approverName;
    await str.save();

    await logAction({
      action: 'STR_APPROVED',
      entity_type: 'STRReport',
      entity_id: str.str_id,
      user: approverName,
      details: {
        prepared_by: str.prepared_by,
        approved_by: approverName
      },
      ip_address: req.ip
    });

    return res.json({ message: 'STR approved successfully under Four-Eyes validation', str });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to approve STR', message: err.message });
  }
}

/**
 * POST /api/reports/str/:id/file
 * Mark STR as filed with FIU-IND and record Ack Ref
 */
async function fileSTR(req, res) {
  try {
    const { id } = req.params;
    const { acknowledgement_reference } = req.body;

    let str = await models.STRReport.findOne({ str_id: id });
    if (!str && id.match(/^[0-9a-fA-F]{24}$/)) {
      str = await models.STRReport.findById(id);
    }
    if (!str) {
      return res.status(404).json({ error: 'STR not found' });
    }

    str.status = 'Filed';
    str.filing_date = new Date();
    str.acknowledgement_reference = acknowledgement_reference || `FIU-ACK-${Date.now().toString(36).toUpperCase()}`;
    await str.save();

    // Also update linked case if present
    if (str.case_id) {
      const caseDoc = await models.Case.findOne({ case_id: str.case_id });
      if (caseDoc) {
        caseDoc.status = 'Closed';
        caseDoc.closure_disposition = 'True Positive - STR Filed';
        caseDoc.closure_rationale = `STR filed with FIU-IND (Ack: ${str.acknowledgement_reference}).`;
        caseDoc.closed_at = new Date();
        caseDoc.closed_by = req.user ? req.user.username : 'compliance_officer';
        await caseDoc.save();
      }
    }

    await logAction({
      action: 'STR_FILED',
      entity_type: 'STRReport',
      entity_id: str.str_id,
      user: req.user ? req.user.username : 'compliance_officer',
      details: {
        acknowledgement_reference: str.acknowledgement_reference,
        filing_date: str.filing_date
      },
      ip_address: req.ip
    });

    return res.json({ message: 'STR marked as Filed successfully', str });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to file STR', message: err.message });
  }
}

/**
 * POST /api/reports/str/:id/reject
 * Reject an STR with a rationale
 */
async function rejectSTR(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    let str = await models.STRReport.findOne({ str_id: id });
    if (!str && id.match(/^[0-9a-fA-F]{24}$/)) {
      str = await models.STRReport.findById(id);
    }
    if (!str) {
      return res.status(404).json({ error: 'STR not found' });
    }

    str.status = 'Rejected';
    await str.save();

    await logAction({
      action: 'STR_REJECTED',
      entity_type: 'STRReport',
      entity_id: str.str_id,
      user: req.user ? req.user.username : 'compliance_officer',
      details: { rejection_reason: reason || 'Not warranted' },
      ip_address: req.ip
    });

    return res.json({ message: 'STR rejected', str });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reject STR', message: err.message });
  }
}

/**
 * GET /api/reports/str/:id/export?format=xml|json
 * Structured Export of STR
 */
async function exportSTR(req, res) {
  try {
    const { id } = req.params;
    const format = (req.query.format || 'xml').toLowerCase();

    let str = await models.STRReport.findOne({ str_id: id });
    if (!str && id.match(/^[0-9a-fA-F]{24}$/)) {
      str = await models.STRReport.findById(id);
    }
    if (!str) {
      return res.status(404).json({ error: 'STR not found' });
    }

    const doc = str.toObject ? str.toObject() : str;

    await logAction({
      action: 'STR_EXPORTED',
      entity_type: 'STRReport',
      entity_id: str.str_id,
      user: req.user ? req.user.username : 'analyst',
      details: { format },
      ip_address: req.ip
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${str.str_id}.json"`);
      return res.json({
        _regulatory_notice: 'verify against regulator current schema (FIU-IND XML schema v2.0 / FINnet 2.0 / PMLA Rules 2005)',
        schema_version: 'FIU-IND-STR-v2.0',
        report_data: doc
      });
    }

    const xml = exportReportXML(doc, 'STR');
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${str.str_id}.xml"`);
    return res.send(xml);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to export STR', message: err.message });
  }
}

/**
 * GET /api/reports/str/:id/pdf
 * Stream PDF export of STR
 */
async function exportSTRPDF(req, res) {
  try {
    const { id } = req.params;
    let str = await models.STRReport.findOne({ str_id: id });
    if (!str && id.match(/^[0-9a-fA-F]{24}$/)) {
      str = await models.STRReport.findById(id);
    }
    if (!str) {
      return res.status(404).json({ error: 'STR not found' });
    }

    const doc = str.toObject ? str.toObject() : str;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${str.str_id}.pdf"`);

    await logAction({
      action: 'STR_PDF_DOWNLOADED',
      entity_type: 'STRReport',
      entity_id: str.str_id,
      user: req.user ? req.user.username : 'analyst',
      ip_address: req.ip
    });

    generateSTRPDF(doc, res);
  } catch (err) {
    console.error('[regulatoryController] Error in exportSTRPDF:', err);
    return res.status(500).json({ error: 'Failed to generate STR PDF', message: err.message });
  }
}

/**
 * GET /api/reports/ctr
 * List all CTR records with overdue calculation
 */
async function getCTRs(req, res) {
  try {
    const { period, status, overdue } = req.query;
    let query = {};
    if (period) query.period = period;
    if (status) query.status = status;

    const ctrs = await models.CTRReport.find(query).sort({ createdAt: -1 });
    const now = new Date();

    const formatted = ctrs.map(c => {
      const doc = c.toObject ? c.toObject() : c;
      const isOverdue = doc.due_date && new Date(doc.due_date) < now && doc.status !== 'Filed';
      return {
        ...doc,
        is_overdue: isOverdue
      };
    });

    if (overdue === 'true') {
      return res.json(formatted.filter(c => c.is_overdue));
    }

    return res.json(formatted);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch CTR records', message: err.message });
  }
}

/**
 * POST /api/reports/ctr/generate
 * Trigger batch / monthly CTR aggregation job
 */
async function generateCTR(req, res) {
  try {
    const { period, threshold_inr, customer_id } = req.body;
    const results = await generateCTRReport({ period, threshold_inr, customer_id });

    return res.status(201).json({
      message: `Generated ${results.length} CTR record(s) above threshold`,
      count: results.length,
      ctrs: results
    });
  } catch (err) {
    console.error('[regulatoryController] Error generating CTR:', err);
    return res.status(500).json({ error: 'Failed to run CTR aggregation', message: err.message });
  }
}

/**
 * GET /api/reports/ctr/:id/export?format=xml|json
 */
async function exportCTR(req, res) {
  try {
    const { id } = req.params;
    const format = (req.query.format || 'xml').toLowerCase();

    let ctr = await models.CTRReport.findOne({ ctr_id: id });
    if (!ctr && id.match(/^[0-9a-fA-F]{24}$/)) {
      ctr = await models.CTRReport.findById(id);
    }
    if (!ctr) {
      return res.status(404).json({ error: 'CTR not found' });
    }

    const doc = ctr.toObject ? ctr.toObject() : ctr;

    await logAction({
      action: 'CTR_EXPORTED',
      entity_type: 'CTRReport',
      entity_id: ctr.ctr_id,
      user: req.user ? req.user.username : 'analyst',
      details: { format },
      ip_address: req.ip
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${ctr.ctr_id}.json"`);
      return res.json({
        _regulatory_notice: 'verify against regulator current schema (FIU-IND XML schema v2.0 / FINnet 2.0 / PMLA Rules 2005)',
        schema_version: 'FIU-IND-CTR-v2.0',
        report_data: doc
      });
    }

    const xml = exportReportXML(doc, 'CTR');
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${ctr.ctr_id}.xml"`);
    return res.send(xml);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to export CTR', message: err.message });
  }
}

/**
 * GET /api/reports/ctr/:id/pdf
 */
async function exportCTRPDF(req, res) {
  try {
    const { id } = req.params;
    let ctr = await models.CTRReport.findOne({ ctr_id: id });
    if (!ctr && id.match(/^[0-9a-fA-F]{24}$/)) {
      ctr = await models.CTRReport.findById(id);
    }
    if (!ctr) {
      return res.status(404).json({ error: 'CTR not found' });
    }

    const doc = ctr.toObject ? ctr.toObject() : ctr;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ctr.ctr_id}.pdf"`);

    await logAction({
      action: 'CTR_PDF_DOWNLOADED',
      entity_type: 'CTRReport',
      entity_id: ctr.ctr_id,
      user: req.user ? req.user.username : 'analyst',
      ip_address: req.ip
    });

    generateCTRPDF(doc, res);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate CTR PDF', message: err.message });
  }
}

module.exports = {
  getSTRs,
  getSTRById,
  generateSTR,
  updateSTR,
  approveSTR,
  fileSTR,
  rejectSTR,
  exportSTR,
  exportSTRPDF,
  getCTRs,
  generateCTR,
  exportCTR,
  exportCTRPDF
};
