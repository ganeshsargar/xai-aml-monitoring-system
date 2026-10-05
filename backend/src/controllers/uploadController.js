const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { convertToINR } = require('../config/fxConfig');
const { generateUploadId, generateTemplateId, generateTxId, generatePrefixedId } = require('../utils/idGenerator');
const { CANONICAL_SCHEMA, REQUIRED_FIELDS } = require('../config/canonicalSchema');
const { 
  getStructuringBounds,
  getHighRiskJurisdictions,
  getHighRiskPaymentMethods,
  getAlertLevel
} = require('../config/riskConfig');
const {
  computeSourceSignature,
  suggestMapping
} = require('../services/columnMappingService');
const scenarioEngine = require('../services/scenarioEngine');
const screeningService = require('../services/screeningService');
const { processTransactionAlert } = require('../services/alertService');
const { ingestionQueue } = require('../services/ingestionQueue');

// Staging directory for pending uploads
const stagingDir = path.join(__dirname, '..', '..', 'uploads', 'staging');
if (!fs.existsSync(stagingDir)) {
  fs.mkdirSync(stagingDir, { recursive: true });
}

// Helper to safely update UploadJob in both Mongoose and FileModel
async function updateUploadJob(uploadId, update) {
  if (typeof models.UploadJob.findOneAndUpdate === 'function') {
    return await models.UploadJob.findOneAndUpdate({ upload_id: uploadId }, update, { new: true });
  } else {
    return await models.UploadJob.findByIdAndUpdate(uploadId, update, { new: true });
  }
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
      sender_account: t.sender_account,
      receiver_account: t.receiver_account,
      amount: t.amount,
      country: t.country,
      payment_method: t.payment_method,
      category: t.category,
      timestamp: t.timestamp
    }));

    const response = await axios.post(
      `${mlServiceUrl}/batch-predict`,
      { transactions: batchPayload },
      { timeout: 8000 }
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
  const bounds = getStructuringBounds();
  const highRiskJurisdictions = getHighRiskJurisdictions();
  const highRiskCountries = Object.keys(highRiskJurisdictions);
  const highRiskMethods = getHighRiskPaymentMethods();

  for (const t of transactions) {
    let score = 5;
    const reasons = [];
    const shap = [];
    const amount = parseFloat(t.amount || 0);
    const country = t.country || 'IN';
    const payMethod = t.payment_method || 'UPI';

    if (amount >= bounds.lower && amount <= bounds.upper) {
      score += 40;
      reasons.push(`₹${amount.toLocaleString('en-IN')} structured near ₹${(bounds.ctr / 100000).toFixed(0)}L CTR threshold`);
      shap.push({ feature: 'amount_near_threshold', shap_value: 0.40, actual_value: 1 });
    } else if (amount >= bounds.ctr) {
      score += 30;
      reasons.push(`High-value transfer of ₹${amount.toLocaleString('en-IN')} exceeds ₹${(bounds.ctr / 100000).toFixed(0)}L threshold`);
      shap.push({ feature: 'is_large_amount', shap_value: 0.30, actual_value: 1 });
    }

    if (highRiskCountries.includes(country)) {
      score += 30;
      const jur = highRiskJurisdictions[country] || { name: country, label: 'High-Risk Jurisdiction' };
      const labelSnippet = jur.label ? ` (${jur.label})` : '';
      reasons.push(`Routed through ${jur.name || country}${labelSnippet}`);
      shap.push({ feature: 'is_high_risk_country', shap_value: 0.30, actual_value: 1 });
    }

    if (highRiskMethods.includes(payMethod)) {
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
  const uploadId = generateUploadId();
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
        if (typeof models.UploadMappingTemplate.findOneAndUpdate === 'function') {
          savedTemplate = await models.UploadMappingTemplate.findOneAndUpdate(
            { source_signature: job.source_signature },
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
        }
      } else {
        const templateId = generateTemplateId();
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

    // 4. Register Ingestion Job in Queue
    const isAsync = req.query.async === 'true' || req.body.async === true;
    const jobData = {
      upload_id: job.upload_id,
      file_path: job.file_path,
      mapping: cleanedMapping,
      row_count_estimate: job.row_count_estimate || 0,
      user: req.user
    };

    if (isAsync) {
      const queuedJob = await ingestionQueue.add(job.upload_id, jobData);
      return res.status(202).json({
        success: true,
        message: 'Upload job enqueued for background ingestion.',
        upload_id: job.upload_id,
        status: 'queued',
        job: queuedJob
      });
    }

    // Synchronous execution with queue progress reporting
    const result = await processIngestionPipeline(jobData, {
      reportProgress: async (p) => {
        await ingestionQueue.setProgress(job.upload_id, p);
      }
    });
    await ingestionQueue.setCompleted(job.upload_id, result);

    await logAction(
      req.user ? req.user.username : 'API',
      req.user ? req.user.role : 'Guest',
      'BULK_TRANSACTION_IMPORT_MAPPED',
      req.ip,
      `Imported ${result.processed} transactions with confirmed column mapping in ${result.elapsed_seconds}s. Raised ${result.flagged} alerts.`
    );

    return res.json({
      success: true,
      message: `Import completed successfully. Processed ${result.processed} transactions and raised ${result.flagged} alerts in ${result.elapsed_seconds}s.`,
      upload_id,
      processed: result.processed,
      flagged: result.flagged,
      elapsed_seconds: result.elapsed_seconds,
      mapping: cleanedMapping,
      template_saved: Boolean(savedTemplate)
    });

  } catch (error) {
    if (upload_id) {
      try {
        await updateUploadJob(upload_id, {
          status: 'failed',
          error: error.message
        });
      } catch (err) {}
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Core Ingestion Worker Function
 * Executed by IngestionQueue with incremental progress updates.
 */
async function processIngestionPipeline(jobData, progressReporter = { reportProgress: async () => {} }) {
  const { upload_id, file_path, mapping } = jobData;
  const startTime = Date.now();

  if (!fs.existsSync(file_path)) {
    throw new Error('Staged file is inaccessible or was removed.');
  }

  const parsedTransactions = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(file_path)
      .pipe(csv())
      .on('data', (rawRow) => {
        const canonicalRow = {};
        for (const [canonField, rawHeader] of Object.entries(mapping)) {
          if (rawHeader && rawRow[rawHeader] !== undefined) {
            canonicalRow[canonField] = rawRow[rawHeader];
          }
        }

        const origAmount = parseFloat(canonicalRow.amount || 0);
        const origCurr = canonicalRow.currency || 'INR';
        const origDate = canonicalRow.timestamp || new Date().toISOString();
        const fxInfo = convertToINR(origAmount, origCurr, origDate);

        parsedTransactions.push({
          transaction_id:   canonicalRow.transaction_id || generateTxId(),
          sender_account:   canonicalRow.sender_account || generatePrefixedId('ACC'),
          sender_name:      canonicalRow.sender_name    || `Customer ${generatePrefixedId('CUST')}`,
          receiver_account: canonicalRow.receiver_account || generatePrefixedId('ACC'),
          receiver_name:    canonicalRow.receiver_name  || `Customer ${generatePrefixedId('CUST')}`,
          amount:           fxInfo.amount,
          currency:         fxInfo.currency,
          amount_inr:       fxInfo.amount_inr,
          fx_rate:          fxInfo.fx_rate,
          fx_date:          fxInfo.fx_date,
          timestamp:        origDate,
          country:          canonicalRow.country        || 'IN',
          city:             canonicalRow.city           || 'Mumbai',
          device_id:        canonicalRow.device_id      || null,
          ip_address:       canonicalRow.ip_address     || null,
          payment_method:   canonicalRow.payment_method || 'UPI',
          category:         canonicalRow.category       || 'Transfer',
          merchant:         canonicalRow.merchant       || 'General',
          status:           canonicalRow.status         || 'Approved',
          is_laundering:    parseInt(canonicalRow.is_laundering || 0),
          _customer_meta:   (canonicalRow.customer_id || canonicalRow.customer_name || canonicalRow.declared_income || canonicalRow.customer_type || canonicalRow.occupation) ? {
            customer_id: canonicalRow.customer_id,
            customer_name: canonicalRow.customer_name,
            customer_type: canonicalRow.customer_type,
            declared_income: canonicalRow.declared_income,
            occupation: canonicalRow.occupation,
            kyc_risk_rating: canonicalRow.kyc_risk_rating,
            is_pep: canonicalRow.is_pep
          } : null
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const totalRaw = parsedTransactions.length;
  await progressReporter.reportProgress({ progress_pct: 15, total_count: totalRaw, processed_count: 0 });

  // Deduplicate against existing transactions in DB
  const allIds = parsedTransactions.map(t => t.transaction_id);
  const existingDocs = await models.Transaction.find({ transaction_id: { $in: allIds } });
  const existingSet = new Set(existingDocs.map(d => d.transaction_id));
  const newTxs = parsedTransactions.filter(t => !existingSet.has(t.transaction_id));

  // Deduplicate internally within file batch
  const seenNewIds = new Set();
  const uniqueNewTxs = [];
  for (const t of newTxs) {
    if (!seenNewIds.has(t.transaction_id)) {
      seenNewIds.add(t.transaction_id);
      uniqueNewTxs.push(t);
    }
  }

  if (uniqueNewTxs.length === 0) {
    if (fs.existsSync(file_path)) fs.unlinkSync(file_path);
    await updateUploadJob(upload_id, {
      status: 'completed',
      processed_count: 0,
      flagged_count: 0,
      completed_at: new Date()
    });
    return {
      success: true,
      processed: 0,
      flagged: 0,
      elapsed_seconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1))
    };
  }

  const BATCH_SIZE = 1000;
  let totalProcessed = 0;
  let totalAlerts = 0;

  for (let i = 0; i < uniqueNewTxs.length; i += BATCH_SIZE) {
    const chunk = uniqueNewTxs.slice(i, i + BATCH_SIZE);
    const scoredMap = await scoreTransactionsBatch(chunk);
    const evaluatedBatch = await scenarioEngine.evaluateBatch(chunk);
    const evalMap = {};
    for (const et of evaluatedBatch) {
      evalMap[et.transaction_id] = et;
    }

    const screeningResults = await screeningService.screenTransactionsBatch(chunk);

    const txDocs = [];
    for (let j = 0; j < chunk.length; j++) {
      const t = chunk[j];
      const scored = scoredMap[t.transaction_id] || {
        risk_score: 5,
        is_laundering: 0,
        reasons: [],
        shap_explanation: []
      };

      const screeningResult = screeningResults[j] || { active_hits: [], all_hits: [] };
      const activeScreeningHits = screeningResult.active_hits || [];
      const screeningRuleHits = activeScreeningHits.map(hit => ({
        scenario_id: `SCREEN_${hit.list_type.toUpperCase()}`,
        name: `${hit.list_type} Watchlist Match (${hit.subject})`,
        category: 'WatchlistScreening',
        severity: hit.severity,
        weight: hit.list_type === 'Sanctions' ? 50 : (hit.list_type === 'PEP' ? 30 : 20),
        reason: hit.reason,
        score: hit.match_score
      }));

      const evalItem = evalMap[t.transaction_id] || {};
      const ruleHits = [...(evalItem.rule_hits || []), ...screeningRuleHits];
      const rawMlScore = scored.risk_score;

      const fusion = scenarioEngine.calculateFusedRiskScore(rawMlScore, ruleHits);
      let finalRiskScore = fusion.final_risk_score;

      if (t.is_laundering === 1 && finalRiskScore < 65) {
        finalRiskScore = 75;
      }

      const screeningReasons = activeScreeningHits.map(h => h.reason);
      const combinedReasons = [...new Set([...screeningReasons, ...(evalItem.rule_hits || []).map(h => h.reason), ...(scored.reasons || [])])].slice(0, 5);

      txDocs.push({
        ...t,
        risk_score: finalRiskScore,
        ml_score: fusion.ml_score,
        rule_score: fusion.rule_score,
        rule_hits: ruleHits,
        screening_hits: screeningResult.all_hits || [],
        score_breakdown: fusion.score_breakdown,
        reasons: combinedReasons,
        shap_explanation: scored.shap_explanation
      });
    }

    if (models.Transaction.insertMany) {
      try {
        await models.Transaction.insertMany(txDocs, { ordered: false });
      } catch (insertErr) {
        console.warn('[Column Mapping Pipeline] Partial batch insert warning:', insertErr.message);
      }
    } else {
      for (const doc of txDocs) await models.Transaction.create(doc);
    }

    for (const doc of txDocs) {
      if (getAlertLevel(doc.risk_score)) {
        try {
          await processTransactionAlert(doc);
          totalAlerts++;
        } catch (alErr) {
          console.warn('[Column Mapping Pipeline] Alert processing error:', alErr.message);
        }
      }
    }

    totalProcessed += txDocs.length;

    // Bulk Sync Customers and Accounts
    if (models.Customer && models.Account) {
      const customerMetaList = chunk.filter(t => t._customer_meta);
      if (customerMetaList.length > 0) {
        try {
          const custIds = [...new Set(customerMetaList.map(t => t._customer_meta.customer_id || `CUST_${t.sender_account}`))];
          const accIds = [...new Set(customerMetaList.map(t => t.sender_account))];

          const existingCustDocs = await models.Customer.find({ customer_id: { $in: custIds } });
          const existingCustSet = new Set(existingCustDocs.map(c => c.customer_id));

          const existingAccDocs = await models.Account.find({ account_id: { $in: accIds } });
          const existingAccSet = new Set(existingAccDocs.map(a => a.account_id));

          const newCustToCreate = [];
          const newAccToCreate = [];
          const seenNewCust = new Set();
          const seenNewAcc = new Set();

          for (const t of customerMetaList) {
            const cm = t._customer_meta;
            const cid = cm.customer_id || `CUST_${t.sender_account}`;
            if (!existingCustSet.has(cid) && !seenNewCust.has(cid)) {
              seenNewCust.add(cid);
              newCustToCreate.push({
                customer_id: cid,
                name: cm.customer_name || t.sender_name || `Customer ${t.sender_account}`,
                type: (cm.customer_type && cm.customer_type.toLowerCase().includes('biz')) ? 'business' : 'individual',
                occupation_or_business_type: cm.occupation || 'General',
                declared_monthly_income_or_turnover: parseFloat(cm.declared_income || 0) || 75000,
                kyc_risk_rating: cm.kyc_risk_rating || 'Low',
                is_pep: cm.is_pep === 1 || cm.is_pep === '1' || cm.is_pep === true,
                onboarding_date: t.timestamp,
                country_of_residence: t.country || 'IN',
                beneficial_owner_ids: []
              });
            }

            if (!existingAccSet.has(t.sender_account) && !seenNewAcc.has(t.sender_account)) {
              seenNewAcc.add(t.sender_account);
              newAccToCreate.push({
                account_id: t.sender_account,
                customer_id: cid,
                open_date: t.timestamp,
                product_type: (cm.customer_type && cm.customer_type.toLowerCase().includes('biz')) ? 'business_current' : 'savings'
              });
            }
          }

          if (newCustToCreate.length > 0) {
            if (models.Customer.insertMany) {
              await models.Customer.insertMany(newCustToCreate, { ordered: false });
            } else {
              for (const c of newCustToCreate) await models.Customer.create(c);
            }
          }
          if (newAccToCreate.length > 0) {
            if (models.Account.insertMany) {
              await models.Account.insertMany(newAccToCreate, { ordered: false });
            } else {
              for (const a of newAccToCreate) await models.Account.create(a);
            }
          }
        } catch (custErr) {
          console.warn('[Column Mapping Pipeline] Bulk Customer/Account Sync Warning:', custErr.message);
        }
      }
    }

    const currentPct = 15 + Math.round((totalProcessed / uniqueNewTxs.length) * 80);
    await progressReporter.reportProgress({
      progress_pct: currentPct,
      processed_count: totalProcessed,
      total_count: uniqueNewTxs.length,
      flagged_count: totalAlerts
    });
  }

  if (fs.existsSync(file_path)) {
    fs.unlinkSync(file_path);
  }

  const elapsed = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));

  await updateUploadJob(upload_id, {
    status: 'completed',
    processed_count: totalProcessed,
    flagged_count: totalAlerts,
    completed_at: new Date()
  });

  return {
    success: true,
    processed: totalProcessed,
    flagged: totalAlerts,
    elapsed_seconds: elapsed
  };
}

// Attach pipeline handler to queue
ingestionQueue.process(processIngestionPipeline);

/**
 * 4. GET /api/uploads/status/:id
 * Returns real-time status and progress percentage of background ingestion job.
 */
const getJobStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const queueJob = await ingestionQueue.getStatus(id);
    const dbJob = await models.UploadJob.findOne({ upload_id: id });

    if (!queueJob && !dbJob) {
      return res.status(404).json({ success: false, error: 'Ingestion job not found.' });
    }

    const statusData = {
      upload_id: id,
      status: queueJob ? queueJob.status : (dbJob ? dbJob.status : 'unknown'),
      progress_pct: queueJob ? queueJob.progress_pct : (dbJob && dbJob.status === 'completed' ? 100 : 0),
      processed_count: queueJob ? queueJob.processed_count : (dbJob ? dbJob.processed_count : 0),
      flagged_count: queueJob ? queueJob.flagged_count : (dbJob ? dbJob.flagged_count : 0),
      total_count: queueJob ? queueJob.total_count : (dbJob ? dbJob.row_count_estimate : 0),
      error: queueJob ? queueJob.error : (dbJob ? dbJob.error : null),
      completed_at: queueJob ? queueJob.completed_at : (dbJob ? dbJob.completed_at : null)
    };

    return res.json({ success: true, data: statusData });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 5. GET /api/uploads/queue
 * Returns list of recent queue jobs.
 */
const listQueueJobs = async (req, res) => {
  try {
    const jobs = await ingestionQueue.listJobs();
    return res.json({ success: true, jobs });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 6. GET /api/uploads/mapping-templates
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
 * 7. DELETE /api/uploads/mapping-templates/:id
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
  getJobStatus,
  listQueueJobs,
  getMappingTemplates,
  deleteMappingTemplate,
  processIngestionPipeline
};
