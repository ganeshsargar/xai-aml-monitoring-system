const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { CANONICAL_SCHEMA, REQUIRED_FIELDS } = require('../config/canonicalSchema');
const {
  computeSourceSignature,
  suggestMapping
} = require('../services/columnMappingService');

// Staging directory for pending uploads
const stagingDir = path.join(__dirname, '..', '..', 'uploads', 'staging');
if (!fs.existsSync(stagingDir)) {
  fs.mkdirSync(stagingDir, { recursive: true });
}

/**
 * Helper: Run ML batch scoring or fallback to rule-based risk calculation
 */
async function scoreTransactionsBatch(transactions) {
  const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000';
  const scoredMap = {};

  try {
    const batchPayload = transactions.map(t => ({
      transaction_id: t.transaction_id,
      amount: t.amount,
      country: t.country,
      payment_method: t.payment_method,
      category: t.category,
      timestamp: t.timestamp
    }));

    const response = await axios.post(
      `${mlServiceUrl}/batch-predict`,
      { transactions: batchPayload },
      { timeout: 60000 }
    );

    if (response.data && response.data.success) {
      for (const r of response.data.results) {
        scoredMap[r.transaction_id] = {
          risk_score: r.risk_score,
          is_laundering: r.is_laundering,
          reasons: r.reasons || [],
          shap_explanation: r.shap_explanations || []
        };
      }
      return scoredMap;
    }
  } catch (mlErr) {
    console.warn(`[Column Mapping Pipeline] ML batch-predict unavailable (${mlErr.message}). Using heuristic fallback.`);
  }

  // Fallback Heuristics
  const COUNTRY_NAMES = {
    KY: 'Cayman Islands (offshore tax haven)',
    PA: 'Panama (FATF grey-listed jurisdiction)',
    AE: 'UAE / Dubai (high cash-intensity hub)',
    RU: 'Russia (sanctions-listed jurisdiction)',
    BS: 'Bahamas (offshore financial centre)',
    LU: 'Luxembourg (opaque holding jurisdiction)'
  };

  for (const t of transactions) {
    let score = 5;
    const reasons = [];
    const shap = [];
    const amount = parseFloat(t.amount || 0);
    const country = t.country || 'IN';
    const payMethod = t.payment_method || 'UPI';

    if (amount >= 820000 && amount <= 999000) {
      score += 40;
      reasons.push(`₹${amount.toLocaleString('en-IN')} structured near ₹10L CTR threshold`);
      shap.push({ feature: 'amount_near_threshold', shap_value: 0.40, actual_value: 1 });
    } else if (amount >= 1000000) {
      score += 30;
      reasons.push(`High-value transfer of ₹${amount.toLocaleString('en-IN')} exceeds ₹10L threshold`);
      shap.push({ feature: 'is_large_amount', shap_value: 0.30, actual_value: 1 });
    }

    if (['KY', 'PA', 'AE', 'RU', 'BS', 'LU'].includes(country)) {
      score += 30;
      reasons.push(`Routed through ${COUNTRY_NAMES[country] || country}`);
      shap.push({ feature: 'is_high_risk_country', shap_value: 0.30, actual_value: 1 });
    }

    if (['Crypto Transfer', 'Cash Deposit', 'RTGS'].includes(payMethod)) {
      score += 20;
      reasons.push(`High-risk payment channel: ${payMethod}`);
      shap.push({ feature: 'is_wire_or_crypto', shap_value: 0.20, actual_value: 1 });
    }

    if (t.is_laundering === 1) {
      score = Math.max(score, 75);
      if (reasons.length === 0) reasons.push('Flagged by laundering indicator');
    }

    scoredMap[t.transaction_id] = {
      risk_score: Math.min(score, 99),
      is_laundering: t.is_laundering || 0,
      reasons: reasons.slice(0, 3),
      shap_explanation: shap
    };
  }

  return scoredMap;
}

/**
 * 2. POST /api/uploads/detect-headers
 * Staging file upload and streaming read of header + first 5 rows.
 * Computes source_signature, checks for template match, and returns preview.
 */
const detectHeaders = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Please upload a CSV file.' });
  }

  const tempPath = req.file.path;
  const uploadId = 'upl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const stagingPath = path.join(stagingDir, `${uploadId}.csv`);

  try {
    // Move uploaded file to staging directory with job-scoped id
    fs.renameSync(tempPath, stagingPath);
    const fileStat = fs.statSync(stagingPath);

    // Read ONLY headers and first 5 rows using streaming parser
    const previewRows = [];
    let detectedHeaders = [];

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(stagingPath)
        .pipe(csv())
        .on('headers', (headers) => {
          detectedHeaders = headers.map(h => String(h || '').trim()).filter(Boolean);
        })
        .on('data', (row) => {
          if (previewRows.length < 5) {
            previewRows.push(row);
          } else {
            // Once 5 rows are read, destroy stream to avoid full in-memory buffering
            stream.destroy();
            resolve();
          }
        })
        .on('end', () => resolve())
        .on('close', () => resolve())
        .on('error', (err) => reject(err));
    });

    if (detectedHeaders.length === 0 && previewRows.length > 0) {
      detectedHeaders = Object.keys(previewRows[0]);
    }

    if (detectedHeaders.length === 0) {
      if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
      return res.status(400).json({
        success: false,
        error: 'Could not detect any column headers in the uploaded CSV file.'
      });
    }

    // Estimate row count based on file size and preview sample byte size
    let rowCountEstimate = previewRows.length;
    if (previewRows.length > 0) {
      const sampleBytes = JSON.stringify(previewRows).length;
      const avgBytesPerRow = Math.max(20, sampleBytes / previewRows.length);
      rowCountEstimate = Math.max(previewRows.length, Math.round(fileStat.size / avgBytesPerRow));
    }

    // Compute deterministic source_signature
    const sourceSignature = computeSourceSignature(detectedHeaders);

    // Check for exact matching saved template
    const matchedTemplate = await models.UploadMappingTemplate.findOne({
      source_signature: sourceSignature
    });

    let autoAppliedTemplate = null;
    let initialStatus = 'pending_mapping';
    let confirmedMapping = null;

    if (matchedTemplate) {
      autoAppliedTemplate = {
        template_id: matchedTemplate.template_id,
        template_name: matchedTemplate.template_name,
        mapping: matchedTemplate.mapping
      };
      initialStatus = 'mapping_confirmed';
      confirmedMapping = matchedTemplate.mapping;
    }

    // Create Ingestion Job Record
    await models.UploadJob.create({
      upload_id: uploadId,
      file_path: stagingPath,
      original_filename: req.file.originalname,
      headers: detectedHeaders,
      source_signature: sourceSignature,
      row_count_estimate: rowCountEstimate,
      status: initialStatus,
      mapping: confirmedMapping,
      auto_applied: Boolean(autoAppliedTemplate),
      auto_applied_template_id: autoAppliedTemplate ? autoAppliedTemplate.template_id : null,
      auto_applied_template_name: autoAppliedTemplate ? autoAppliedTemplate.template_name : null,
      created_by: req.user ? req.user.username : 'System',
      created_at: new Date()
    });

    return res.json({
      success: true,
      upload_id: uploadId,
      headers: detectedHeaders,
      preview_rows: previewRows,
      row_count_estimate: rowCountEstimate,
      source_signature: sourceSignature,
      auto_applied_template: autoAppliedTemplate
    });

  } catch (error) {
    if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
    return res.status(500).json({
      success: false,
      error: 'Failed to process uploaded CSV: ' + error.message
    });
  }
};

/**
 * 3. GET /api/uploads/:upload_id/suggested-mapping
 * Returns auto-suggestions for mapping canonical fields to the uploaded headers,
 * clearly flagging any missing REQUIRED fields.
 */
const getSuggestedMapping = async (req, res) => {
  const { upload_id } = req.params;

  try {
    const job = await models.UploadJob.findOne({ upload_id });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Upload job not found.' });
    }

    const { suggestions, missing_required, unmapped_raw } = suggestMapping(job.headers);

    return res.json({
      success: true,
      upload_id,
      source_signature: job.source_signature,
      raw_headers: job.headers,
      suggestions,
      missing_required,
      unmapped_raw
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 4. POST /api/uploads/:upload_id/mapping
 * Validates confirmed mapping, optionally saves as template, and initiates
 * full streaming parse + AML scoring + DB ingestion.
 */
const confirmMapping = async (req, res) => {
  const { upload_id } = req.params;
  const { mapping, save_as_template, template_name } = req.body;

  try {
    const job = await models.UploadJob.findOne({ upload_id });
    if (!job) {
      return res.status(404).json({ success: false, error: 'Upload job not found.' });
    }

    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid mapping payload. Expected an object with canonical field mappings.'
      });
    }

    // 1. Validation: Every REQUIRED field must be mapped to an existing raw header
    const missingRequired = [];
    for (const reqField of REQUIRED_FIELDS) {
      const rawHeader = mapping[reqField];
      if (!rawHeader || typeof rawHeader !== 'string' || !rawHeader.trim()) {
        missingRequired.push(reqField);
      } else if (!job.headers.includes(rawHeader.trim())) {
        missingRequired.push(`${reqField} (header "${rawHeader}" not found in file)`);
      }
    }

    if (missingRequired.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Required canonical fields must be mapped to valid headers: ${missingRequired.join(', ')}`,
        missing_required: missingRequired
      });
    }

    // 2. Validation: No two canonical fields may be mapped to the same raw header
    const usedRawHeaders = new Map(); // rawHeader -> canonicalField
    const conflictingMappings = [];

    for (const [canonicalField, rawHeaderVal] of Object.entries(mapping)) {
      if (rawHeaderVal && typeof rawHeaderVal === 'string' && rawHeaderVal.trim()) {
        const trimmedHeader = rawHeaderVal.trim();
        if (usedRawHeaders.has(trimmedHeader)) {
          conflictingMappings.push({
            raw_header: trimmedHeader,
            fields: [usedRawHeaders.get(trimmedHeader), canonicalField]
          });
        } else {
          usedRawHeaders.set(trimmedHeader, canonicalField);
        }
      }
    }

    if (conflictingMappings.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Duplicate column assignment: multiple canonical fields cannot map to the same raw column (${conflictingMappings.map(c => `"${c.raw_header}" used by [${c.fields.join(', ')}]`).join('; ')})`,
        conflicts: conflictingMappings
      });
    }

    // Cleaned mapping (trimmed strings or null)
    const cleanedMapping = {};
    for (const [field, raw] of Object.entries(mapping)) {
      if (raw && typeof raw === 'string' && raw.trim()) {
        cleanedMapping[field] = raw.trim();
      } else {
        cleanedMapping[field] = null;
      }
    }

    // 3. Upsert Mapping Template if requested
    let savedTemplate = null;
    if (save_as_template) {
      const templateName = (template_name && template_name.trim()) 
        ? template_name.trim() 
        : `Template (${job.original_filename || 'AML Data'})`;

      const existingTemplate = await models.UploadMappingTemplate.findOne({
        source_signature: job.source_signature
      });

      if (existingTemplate) {
        savedTemplate = await models.UploadMappingTemplate.findByIdAndUpdate(
          existingTemplate._id || existingTemplate.template_id,
          {
            template_name: templateName,
            mapping: cleanedMapping,
            headers: job.headers,
            last_used_at: new Date(),
            $set: { usage_count: (existingTemplate.usage_count || 1) + 1 }
          },
          { new: true }
        );
      } else {
        const templateId = 'tmpl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        savedTemplate = await models.UploadMappingTemplate.create({
          template_id: templateId,
          template_name: templateName,
          source_signature: job.source_signature,
          headers: job.headers,
          mapping: cleanedMapping,
          created_by: req.user ? req.user.username : 'System',
          created_at: new Date(),
          last_used_at: new Date(),
          usage_count: 1
        });
      }
    }

    // 4. Update Job Status & Mapping
    await models.UploadJob.findByIdAndUpdate(
      job.upload_id,
      {
        mapping: cleanedMapping,
        status: 'processing'
      }
    );

    // 5. Full Streaming Parse using Confirmed Mapping
    if (!fs.existsSync(job.file_path)) {
      return res.status(404).json({
        success: false,
        error: 'Staged file was removed or is inaccessible. Please upload again.'
      });
    }

    const startTime = Date.now();
    const parsedTransactions = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(job.file_path)
        .pipe(csv())
        .on('data', (rawRow) => {
          // Translate raw row headers to canonical fields
          const canonicalRow = {};
          for (const [canonField, rawHeader] of Object.entries(cleanedMapping)) {
            if (rawHeader && rawRow[rawHeader] !== undefined) {
              canonicalRow[canonField] = rawRow[rawHeader];
            }
          }

          // Build standardized transaction object
          parsedTransactions.push({
            transaction_id:   canonicalRow.transaction_id || ('TX' + Math.floor(200000 + Math.random() * 800000)),
            sender_account:   canonicalRow.sender_account || `ACC${Math.floor(20000 + Math.random() * 80000)}`,
            sender_name:      canonicalRow.sender_name    || `Customer ${Math.floor(10000 + Math.random() * 90000)}`,
            receiver_account: canonicalRow.receiver_account || `ACC${Math.floor(20000 + Math.random() * 80000)}`,
            receiver_name:    canonicalRow.receiver_name  || `Customer ${Math.floor(10000 + Math.random() * 90000)}`,
            amount:           parseFloat(canonicalRow.amount || 0),
            currency:         canonicalRow.currency       || 'INR',
            timestamp:        canonicalRow.timestamp      || new Date().toISOString(),
            country:          canonicalRow.country        || 'IN',
            city:             canonicalRow.city           || 'Mumbai',
            device_id:        canonicalRow.device_id      || null,
            ip_address:       canonicalRow.ip_address     || null,
            payment_method:   canonicalRow.payment_method || 'UPI',
            category:         canonicalRow.category       || 'Transfer',
            merchant:         canonicalRow.merchant       || 'General',
            status:           canonicalRow.status         || 'Approved',
            is_laundering:    parseInt(canonicalRow.is_laundering || 0)
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Deduplicate against existing transactions in DB
    const allIds = parsedTransactions.map(t => t.transaction_id);
    const existingDocs = await models.Transaction.find({ transaction_id: { $in: allIds } });
    const existingSet = new Set(existingDocs.map(d => d.transaction_id));
    const newTxs = parsedTransactions.filter(t => !existingSet.has(t.transaction_id));

    if (newTxs.length === 0) {
      if (fs.existsSync(job.file_path)) fs.unlinkSync(job.file_path);
      await models.UploadJob.findByIdAndUpdate(job._id || job.upload_id, {
        status: 'completed',
        processed_count: 0,
        flagged_count: 0,
        completed_at: new Date()
      });

      return res.json({
        success: true,
        message: 'All transactions in this file already exist in the database.',
        processed: 0,
        flagged: 0,
        mapping: cleanedMapping
      });
    }

    // 6. Batch Score & Insert
    const BATCH_SIZE = 1000;
    let totalProcessed = 0;
    let totalAlerts = 0;

    for (let i = 0; i < newTxs.length; i += BATCH_SIZE) {
      const chunk = newTxs.slice(i, i + BATCH_SIZE);
      const scoredMap = await scoreTransactionsBatch(chunk);

      const txDocs = [];
      const alertDocs = [];

      for (const t of chunk) {
        const scored = scoredMap[t.transaction_id] || {
          risk_score: 5,
          is_laundering: 0,
          reasons: [],
          shap_explanation: []
        };

        let riskScore = scored.risk_score;
        if (t.is_laundering === 1 && riskScore < 65) {
          riskScore = 65 + Math.floor(Math.random() * 25);
        }

        txDocs.push({
          ...t,
          risk_score: riskScore,
          reasons: scored.reasons,
          shap_explanation: scored.shap_explanation
        });

        let alertLevel = null;
        if (riskScore >= 80) alertLevel = 'Critical';
        else if (riskScore >= 60) alertLevel = 'High';
        else if (riskScore >= 35) alertLevel = 'Medium';
        else if (riskScore >= 20) alertLevel = 'Low';

        if (alertLevel) {
          alertDocs.push({
            alert_id: 'ALT' + Math.floor(100000 + Math.random() * 900000),
            transaction_id: t.transaction_id,
            risk_score: riskScore,
            level: alertLevel,
            status: 'New',
            createdAt: t.timestamp
          });
        }
      }

      if (models.Transaction.insertMany) {
        await models.Transaction.insertMany(txDocs, { ordered: false });
        if (alertDocs.length > 0) {
          await models.Alert.insertMany(alertDocs, { ordered: false });
        }
      } else {
        for (const doc of txDocs) await models.Transaction.create(doc);
        for (const doc of alertDocs) await models.Alert.create(doc);
      }

      totalProcessed += txDocs.length;
      totalAlerts += alertDocs.length;
    }

    // Clean up staging file
    if (fs.existsSync(job.file_path)) {
      fs.unlinkSync(job.file_path);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Update Ingestion Job Record
    await models.UploadJob.findByIdAndUpdate(job.upload_id, {
      status: 'completed',
      processed_count: totalProcessed,
      flagged_count: totalAlerts,
      completed_at: new Date()
    });

    await logAction(
      req.user ? req.user.username : 'API',
      req.user ? req.user.role : 'Guest',
      'BULK_TRANSACTION_IMPORT_MAPPED',
      req.ip,
      `Imported ${totalProcessed} transactions with confirmed column mapping in ${elapsed}s. Raised ${totalAlerts} alerts.`
    );

    return res.json({
      success: true,
      message: `Import completed successfully. Processed ${totalProcessed} transactions and raised ${totalAlerts} alerts in ${elapsed}s.`,
      upload_id,
      processed: totalProcessed,
      flagged: totalAlerts,
      elapsed_seconds: parseFloat(elapsed),
      mapping: cleanedMapping,
      template_saved: Boolean(savedTemplate)
    });

  } catch (error) {
    if (upload_id) {
      await models.UploadJob.findByIdAndUpdate(upload_id, {
        status: 'failed',
        error: error.message
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 4. GET /api/uploads/mapping-templates
 * Lists all saved column mapping templates.
 */
const getMappingTemplates = async (req, res) => {
  try {
    const templates = await models.UploadMappingTemplate.find({});
    // Sort descending by last_used_at
    const sorted = templates.sort((a, b) => new Date(b.last_used_at || b.created_at) - new Date(a.last_used_at || a.created_at));

    const response = sorted.map(t => ({
      template_id: t.template_id,
      template_name: t.template_name,
      source_signature: t.source_signature,
      headers_count: Array.isArray(t.headers) ? t.headers.length : 0,
      headers: t.headers || [],
      mapping: t.mapping,
      usage_count: t.usage_count || 1,
      created_by: t.created_by,
      created_at: t.created_at,
      last_used_at: t.last_used_at
    }));

    return res.json({
      success: true,
      templates: response
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 4. DELETE /api/uploads/mapping-templates/:id
 * Removes a saved template.
 */
const deleteMappingTemplate = async (req, res) => {
  const { id } = req.params;

  try {
    let result = await models.UploadMappingTemplate.deleteOne({ template_id: id });
    if (result.deletedCount === 0) {
      result = await models.UploadMappingTemplate.deleteOne({ _id: id });
    }

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Template not found.' });
    }

    await logAction(
      req.user ? req.user.username : 'API',
      req.user ? req.user.role : 'Guest',
      'MAPPING_TEMPLATE_DELETED',
      req.ip,
      `Deleted mapping template ${id}`
    );

    return res.json({
      success: true,
      message: 'Mapping template deleted successfully.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  detectHeaders,
  getSuggestedMapping,
  confirmMapping,
  getMappingTemplates,
  deleteMappingTemplate
};
