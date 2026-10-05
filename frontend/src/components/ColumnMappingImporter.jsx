import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Table,
  Check,
  X,
  Layers,
  HelpCircle,
  Database,
  LayoutDashboard
} from 'lucide-react';

const CANONICAL_FIELD_INFO = {
  transaction_id: { label: 'Transaction ID', required: true, desc: 'Unique transaction identifier (e.g. TX100234, UTR)' },
  timestamp: { label: 'Timestamp / Date', required: true, desc: 'Transaction execution datetime or posting date' },
  sender_account: { label: 'Sender Account', required: true, desc: 'Debit / source bank account number or wallet ID' },
  receiver_account: { label: 'Receiver Account', required: true, desc: 'Credit / beneficiary account number or wallet ID' },
  amount: { label: 'Amount', required: true, desc: 'Transfer amount (numerical value)' },
  currency: { label: 'Currency', required: true, desc: 'ISO 3-letter currency code (e.g. INR, USD, EUR)' },
  sender_name: { label: 'Sender Name', required: false, desc: 'Remitter or originator full name' },
  receiver_name: { label: 'Receiver Name', required: false, desc: 'Beneficiary or payee full name' },
  country: { label: 'Country', required: false, desc: 'Jurisdiction code (e.g. IN, US, KY, PA)' },
  city: { label: 'City', required: false, desc: 'Originating or destination city' },
  payment_method: { label: 'Payment Method', required: false, desc: 'Channel rail (UPI, RTGS, IMPS, Cash Deposit)' },
  category: { label: 'Category', required: false, desc: 'Transaction type (Transfer, Salary, Investment)' },
  merchant: { label: 'Merchant', required: false, desc: 'Counterparty vendor or merchant name' },
  device_id: { label: 'Device ID', required: false, desc: 'Hardware fingerprint or client terminal ID' },
  ip_address: { label: 'IP Address', required: false, desc: 'Client network IP address' },
  status: { label: 'Status', required: false, desc: 'Clearing status (Approved, Pending, Flagged)' }
};

const REQUIRED_FIELDS = ['transaction_id', 'timestamp', 'sender_account', 'receiver_account', 'amount', 'currency'];

export default function ColumnMappingImporter({ API_URL, onImportComplete, onClose }) {
  const navigate = useNavigate();
  const targetApiUrl = API_URL || import.meta.env.VITE_API_URL || 'http://localhost:5050';

  // Steps: 'select', 'detecting', 'auto_applied', 'mapping', 'importing', 'success'
  const [step, setStep] = useState('select');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Uploaded file detection details
  const [uploadId, setUploadId] = useState('');
  const [rawHeaders, setRawHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [rowCountEstimate, setRowCountEstimate] = useState(0);
  const [autoAppliedTemplate, setAutoAppliedTemplate] = useState(null);

  // Mapping state: { [canonicalField]: rawHeaderString || '' }
  const [mapping, setMapping] = useState({});
  const [suggestionMeta, setSuggestionMeta] = useState({}); // { [canonicalField]: { confidence, method } }

  // Template saving options
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // Execution result state
  const [importResult, setImportResult] = useState(null);

  // Ingestion queue real-time progress state
  const [importProgress, setImportProgress] = useState({
    progress_pct: 0,
    processed_count: 0,
    total_count: 0,
    flagged_count: 0,
    status: 'queued'
  });

  // Reset all states
  const handleReset = () => {
    setStep('select');
    setSelectedFile(null);
    setErrorMessage('');
    setUploadId('');
    setRawHeaders([]);
    setPreviewRows([]);
    setRowCountEstimate(0);
    setAutoAppliedTemplate(null);
    setMapping({});
    setSuggestionMeta({});
    setSaveAsTemplate(false);
    setTemplateName('');
    setImportResult(null);
    setImportProgress({
      progress_pct: 0,
      processed_count: 0,
      total_count: 0,
      flagged_count: 0,
      status: 'queued'
    });
  };

  // Step 1: Detect Headers
  const handleFileChange = async (file) => {
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      setErrorMessage('Please select a valid .csv file.');
      return;
    }

    setSelectedFile(file);
    setErrorMessage('');
    setStep('detecting');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
      const res = await axios.post(`${targetApiUrl}/api/uploads/detect-headers`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (res.data.success) {
        const { upload_id, headers, preview_rows, row_count_estimate, auto_applied_template } = res.data;
        setUploadId(upload_id);
        setRawHeaders(headers || []);
        setPreviewRows(preview_rows || []);
        setRowCountEstimate(row_count_estimate || 0);

        if (auto_applied_template) {
          setAutoAppliedTemplate(auto_applied_template);
          setMapping(auto_applied_template.mapping || {});
          setStep('auto_applied');
        } else {
          // Fetch auto-suggestions
          await fetchSuggestions(upload_id, headers);
          setTemplateName(`Mapping for ${file.name.replace(/\.[^/.]+$/, '')}`);
          setStep('mapping');
        }
      } else {
        setErrorMessage(res.data.error || 'Failed to analyze headers.');
        setStep('select');
      }
    } catch (err) {
      setErrorMessage(err.response?.data?.error || err.message || 'File upload failed');
      setStep('select');
    }
  };

  // Fetch suggested mappings from columnMappingService
  const fetchSuggestions = async (uplId, headers) => {
    try {
      const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
      const res = await axios.get(`${targetApiUrl}/api/uploads/${uplId}/suggested-mapping`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (res.data.success) {
        const initialMapping = {};
        const meta = {};

        for (const s of res.data.suggestions) {
          initialMapping[s.canonical_field] = s.suggested_raw_header || '';
          meta[s.canonical_field] = {
            confidence: s.confidence,
            method: s.method
          };
        }

        setMapping(initialMapping);
        setSuggestionMeta(meta);
      }
    } catch (err) {
      console.warn('Could not load suggestions, falling back to manual mapping:', err.message);
      // Initialize blank mapping
      const blank = {};
      Object.keys(CANONICAL_FIELD_INFO).forEach(k => { blank[k] = ''; });
      setMapping(blank);
    }
  };

  // Switch from auto-applied template to manual adjustment
  const handleEditAutoApplied = async () => {
    if (!suggestionMeta || Object.keys(suggestionMeta).length === 0) {
      await fetchSuggestions(uploadId, rawHeaders);
    }
    setTemplateName(autoAppliedTemplate?.template_name || `Mapping for ${selectedFile?.name}`);
    setStep('mapping');
  };

  // Update a field's mapping dropdown
  const handleMappingChange = (canonicalField, rawHeaderVal) => {
    setMapping(prev => ({
      ...prev,
      [canonicalField]: rawHeaderVal
    }));
  };

  // Validate missing required fields
  const missingRequired = REQUIRED_FIELDS.filter(f => !mapping[f] || !mapping[f].trim());

  // Check for duplicate assignments
  const usedHeaders = {};
  const duplicateHeaderErrors = [];
  Object.entries(mapping).forEach(([field, raw]) => {
    if (raw && raw.trim()) {
      if (usedHeaders[raw]) {
        duplicateHeaderErrors.push(`"${raw}" mapped to both ${usedHeaders[raw]} and ${field}`);
      } else {
        usedHeaders[raw] = field;
      }
    }
  });

  // Step 4: Confirm and execute streaming parse + ML scoring pipeline
  const handleConfirmMapping = async () => {
    if (missingRequired.length > 0) {
      setErrorMessage(`Please map all required fields: ${missingRequired.map(f => CANONICAL_FIELD_INFO[f]?.label || f).join(', ')}`);
      return;
    }

    if (duplicateHeaderErrors.length > 0) {
      setErrorMessage(`Conflicting mappings: ${duplicateHeaderErrors.join('; ')}`);
      return;
    }

    setErrorMessage('');
    setStep('importing');
    setImportProgress({
      progress_pct: 10,
      processed_count: 0,
      total_count: rowCountEstimate || 0,
      flagged_count: 0,
      status: 'starting'
    });

    try {
      const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
      const payload = {
        mapping,
        save_as_template: saveAsTemplate,
        template_name: templateName,
        async: true
      };

      const res = await axios.post(`${targetApiUrl}/api/uploads/${uploadId}/mapping?async=true`, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!res.data.success) {
        setErrorMessage(res.data.error || 'Failed to initialize import.');
        setStep('mapping');
        return;
      }

      // If backend executed synchronously anyway or returned instant completed
      if (res.data.processed !== undefined && res.data.status !== 'queued' && res.data.status !== 'processing') {
        setImportResult(res.data);
        setStep('success');
        if (onImportComplete) onImportComplete(res.data);
        return;
      }

      // Start live polling loop for background job status
      const pollStartTime = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await axios.get(`${targetApiUrl}/api/uploads/status/${uploadId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });

          if (pollRes.data && pollRes.data.success) {
            const jobData = pollRes.data.data;
            setImportProgress({
              progress_pct: jobData.progress_pct || 0,
              processed_count: jobData.processed_count || 0,
              total_count: jobData.total_count || rowCountEstimate || 0,
              flagged_count: jobData.flagged_count || 0,
              status: jobData.status || 'processing'
            });

            if (jobData.status === 'completed') {
              clearInterval(pollInterval);
              const finalElapsed = parseFloat(((Date.now() - pollStartTime) / 1000).toFixed(1));
              const finalResult = {
                success: true,
                message: `Import completed successfully. Processed ${jobData.processed_count} transactions and raised ${jobData.flagged_count} alerts in ${finalElapsed}s.`,
                upload_id: uploadId,
                processed: jobData.processed_count,
                flagged: jobData.flagged_count,
                elapsed_seconds: finalElapsed,
                mapping,
                template_saved: saveAsTemplate
              };
              setImportResult(finalResult);
              setStep('success');
              if (onImportComplete) onImportComplete(finalResult);
            } else if (jobData.status === 'failed') {
              clearInterval(pollInterval);
              setErrorMessage(jobData.error || 'Background import execution failed.');
              setStep('mapping');
            }
          }
        } catch (pollErr) {
          console.warn('Progress poll issue:', pollErr.message);
        }
      }, 400);

    } catch (err) {
      setErrorMessage(err.response?.data?.error || err.message || 'Import execution failed');
      setStep('mapping');
    }
  };

  // Live Mapped Preview Data (transforms first 5 rows with current mapping)
  const mappedPreview = previewRows.map(row => {
    const transformed = {};
    Object.entries(mapping).forEach(([canonicalField, rawHeader]) => {
      if (rawHeader && row[rawHeader] !== undefined) {
        transformed[canonicalField] = row[rawHeader];
      } else {
        transformed[canonicalField] = '—';
      }
    });
    return transformed;
  });

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage('')} className="text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── STEP 1: File Selection / Drag and Drop ── */}
      {step === 'select' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              if (e.dataTransfer.files?.[0]) handleFileChange(e.dataTransfer.files[0]);
            }}
            className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center space-y-3 cursor-pointer transition-all relative ${
              isDragOver
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-200 dark:border-darkBorder bg-gray-50/50 hover:bg-gray-100/50 dark:bg-darkBg/30 dark:hover:bg-darkBg/60'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                {selectedFile ? selectedFile.name : 'Drop your transaction CSV here, or browse'}
              </div>
              <p className="text-[11px] text-gray-400">
                Supports any column layout, header names, or language variants
              </p>
            </div>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400 px-1">
            <span>Required fields: ID, Timestamp, Sender, Receiver, Amount, Currency</span>
            <span className="flex items-center gap-1 text-emerald-500 font-medium">
              <Sparkles className="w-3.5 h-3.5" /> Auto-detect & fuzzy matching enabled
            </span>
          </div>
        </div>
      )}

      {/* ── STEP 2: Detecting Headers Spinner ── */}
      {step === 'detecting' && (
        <div className="p-10 border border-gray-100 dark:border-darkBorder rounded-2xl flex flex-col items-center justify-center space-y-3 bg-gray-50/50 dark:bg-darkBg/20 animate-fade-in">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Analyzing CSV headers & detecting schema signature...
          </div>
          <p className="text-[11px] text-gray-400">
            Reading preview sample without loading full file into memory
          </p>
        </div>
      )}

      {/* ── STEP 3: Auto-Applied Template Banner ── */}
      {step === 'auto_applied' && autoAppliedTemplate && (
        <div className="space-y-5 animate-fade-in">
          <div className="p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  Detected format: {autoAppliedTemplate.template_name}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Exact header signature matched a saved template. Mapping has been applied automatically.
                </p>
                <div className="text-[10px] text-gray-400">
                  {rawHeaders.length} columns detected • ~{rowCountEstimate} rows in file
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEditAutoApplied}
                className="px-3 py-2 bg-gray-100 dark:bg-darkBg/80 hover:bg-gray-200 dark:hover:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-300 rounded-xl transition-all"
              >
                Review / Change Mapping
              </button>
              <button
                type="button"
                onClick={handleConfirmMapping}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white rounded-xl shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-1.5"
              >
                Confirm & Import Now
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Preview Table */}
          <div className="border border-gray-100 dark:border-darkBorder rounded-2xl overflow-hidden bg-white dark:bg-darkBg/40">
            <div className="px-4 py-3 bg-gray-50/80 dark:bg-darkBg/60 border-b border-gray-100 dark:border-darkBorder flex items-center justify-between text-xs font-bold text-gray-400">
              <span className="flex items-center gap-1.5">
                <Table className="w-3.5 h-3.5" /> Mapped Preview (First 5 Rows)
              </span>
              <span className="text-[10px] text-gray-400 uppercase font-semibold">
                Using: {autoAppliedTemplate.template_name}
              </span>
            </div>
            <div className="overflow-x-auto max-h-48 text-[11px]">
              <table className="w-full text-left">
                <thead className="bg-gray-50 dark:bg-darkBg text-gray-500 border-b border-gray-100 dark:border-darkBorder font-semibold">
                  <tr>
                    {REQUIRED_FIELDS.map(f => (
                      <th key={f} className="p-2.5 whitespace-nowrap">
                        {CANONICAL_FIELD_INFO[f]?.label || f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-darkBorder font-mono text-[10px]">
                  {mappedPreview.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-darkBg/60">
                      {REQUIRED_FIELDS.map(f => (
                        <td key={f} className="p-2.5 truncate max-w-[140px] text-gray-600 dark:text-gray-300">
                          {r[f]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4: Interactive Column Mapping Table & Live Preview ── */}
      {step === 'mapping' && (
        <div className="space-y-6 animate-fade-in">
          {/* Header Info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-gray-100 dark:border-darkBorder gap-2">
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-500" /> Map CSV Columns to Pipeline Schema
              </h5>
              <p className="text-[11px] text-gray-400">
                File: <strong className="text-gray-600 dark:text-gray-300">{selectedFile?.name}</strong> • {rawHeaders.length} columns detected • ~{rowCountEstimate} rows
              </p>
            </div>
            <button
              onClick={handleReset}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline"
            >
              Choose different file
            </button>
          </div>

          {/* Missing required banner */}
          {missingRequired.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Required fields awaiting mapping: <strong>{missingRequired.map(f => CANONICAL_FIELD_INFO[f]?.label).join(', ')}</strong>
              </span>
            </div>
          )}

          {/* Mapping Table */}
          <div className="border border-gray-200 dark:border-darkBorder rounded-2xl overflow-hidden bg-white dark:bg-darkBg/40 shadow-sm">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-darkBg/90 backdrop-blur border-b border-gray-200 dark:border-darkBorder text-gray-500 dark:text-gray-400 font-semibold z-10">
                  <tr>
                    <th className="p-3.5 w-1/3">Canonical Field (Platform Schema)</th>
                    <th className="p-3.5 w-1/3">Source File Column (Uploaded CSV)</th>
                    <th className="p-3.5 w-1/3">Match Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-darkBorder">
                  {Object.entries(CANONICAL_FIELD_INFO).map(([canonicalKey, info]) => {
                    const isMapped = Boolean(mapping[canonicalKey]);
                    const currentVal = mapping[canonicalKey] || '';
                    const isMissing = info.required && !isMapped;
                    const meta = suggestionMeta[canonicalKey] || { confidence: 0, method: 'none' };

                    return (
                      <tr
                        key={canonicalKey}
                        className={`transition-colors ${
                          isMissing
                            ? 'bg-red-500/5 dark:bg-red-500/10'
                            : 'hover:bg-gray-50/50 dark:hover:bg-darkBg/50'
                        }`}
                      >
                        {/* Canonical Field Info */}
                        <td className="p-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                              {info.label}
                            </span>
                            {info.required ? (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold bg-red-500/10 text-red-500 dark:text-red-400 rounded-md border border-red-500/20">
                                Required
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 text-[9px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-400 rounded-md">
                                Optional
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1" title={info.desc}>
                            {info.desc}
                          </p>
                        </td>

                        {/* Raw Header Dropdown */}
                        <td className="p-3.5">
                          <select
                            value={currentVal}
                            onChange={(e) => handleMappingChange(canonicalKey, e.target.value)}
                            className={`w-full px-3 py-2 text-xs rounded-xl border bg-gray-50 dark:bg-darkBg text-gray-700 dark:text-gray-200 outline-none transition-all ${
                              isMissing
                                ? 'border-red-500/50 focus:border-red-500'
                                : 'border-gray-200 dark:border-darkBorder focus:border-blue-500'
                            }`}
                          >
                            <option value="">-- Ignore this column --</option>
                            {rawHeaders.map((raw) => (
                              <option key={raw} value={raw}>
                                {raw}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Confidence Badge */}
                        <td className="p-3.5">
                          {isMapped ? (
                            meta.confidence >= 0.85 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-[10px] font-semibold">
                                <Check className="w-3 h-3" />
                                {Math.round(meta.confidence * 100)}% ({meta.method})
                              </span>
                            ) : meta.confidence >= 0.60 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full text-[10px] font-semibold">
                                <Sparkles className="w-3 h-3" />
                                {Math.round(meta.confidence * 100)}% ({meta.method})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-[10px] font-semibold">
                                Manual selection
                              </span>
                            )
                          ) : (
                            <span className="text-[11px] text-gray-400 italic">
                              No match
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── LIVE PREVIEW PANEL ── */}
          <div className="border border-gray-200 dark:border-darkBorder rounded-2xl overflow-hidden bg-white dark:bg-darkBg/40 shadow-sm">
            <div className="px-4 py-3 bg-gray-50 dark:bg-darkBg/60 border-b border-gray-200 dark:border-darkBorder flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <Table className="w-4 h-4 text-blue-500" /> Live Data Preview (Mapped First 5 Rows)
              </span>
              <span className="text-[10px] text-gray-400">
                Dynamically updates as dropdowns change
              </span>
            </div>

            <div className="overflow-x-auto text-[11px]">
              <table className="w-full text-left">
                <thead className="bg-gray-50/50 dark:bg-darkBg/80 text-gray-500 font-semibold border-b border-gray-100 dark:border-darkBorder">
                  <tr>
                    {Object.keys(CANONICAL_FIELD_INFO).map((fieldKey) => (
                      <th key={fieldKey} className="p-2.5 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-gray-800 dark:text-gray-200">
                            {CANONICAL_FIELD_INFO[fieldKey].label}
                          </span>
                          <span className="text-[9px] text-gray-400 font-normal">
                            ← {mapping[fieldKey] || '(unmapped)'}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-darkBorder font-mono text-[10px]">
                  {mappedPreview.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-darkBg/50">
                      {Object.keys(CANONICAL_FIELD_INFO).map((fieldKey) => (
                        <td key={fieldKey} className="p-2.5 truncate max-w-[140px] text-gray-600 dark:text-gray-300">
                          {row[fieldKey]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Template Save Checkbox & Action Buttons */}
          <div className="p-4 bg-gray-50/80 dark:bg-darkBg/50 border border-gray-200 dark:border-darkBorder rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Remember this mapping for future files with these exact same columns
                </span>
              </label>

              {saveAsTemplate && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-gray-400">Template Name:</span>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g. Core Banking Export"
                    className="px-3 py-1.5 text-xs bg-white dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none focus:border-blue-500 text-gray-700 dark:text-gray-200"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-darkBorder">
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={missingRequired.length > 0 || duplicateHeaderErrors.length > 0}
                onClick={handleConfirmMapping}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-800 disabled:text-gray-300 text-xs font-semibold text-white rounded-xl shadow-lg shadow-blue-900/10 transition-all flex items-center gap-2"
              >
                <span>Confirm & Import Transactions</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 5: Ingestion Progress ── */}
      {step === 'importing' && (
        <div className="p-8 border border-gray-100 dark:border-darkBorder rounded-2xl bg-white dark:bg-darkBg/50 space-y-6 animate-fade-in shadow-xl shadow-blue-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100 dark:border-darkBorder">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <span>Fast Batch Ingestion & AML Surveillance</span>
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-500 rounded-full animate-pulse uppercase">
                    {importProgress.status}
                  </span>
                </h5>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Streaming normalized rows • XGBoost & Isolation Forest inference • Watchlist screening • Scenario fusion
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black text-blue-600 dark:text-blue-400">
                {Math.min(100, Math.max(0, importProgress.progress_pct || 0))}%
              </span>
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className="space-y-2">
            <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-3.5 overflow-hidden p-0.5 relative shadow-inner">
              <div
                className="bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-lg shadow-blue-500/30"
                style={{ width: `${Math.min(100, Math.max(5, importProgress.progress_pct || 5))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-400">
              <span>{importProgress.processed_count > 0 ? `Processing chunk ${importProgress.processed_count} of ${importProgress.total_count || rowCountEstimate}...` : 'Preparing batch scoring pipeline...'}</span>
              <span>{importProgress.processed_count} / {importProgress.total_count || rowCountEstimate} Rows</span>
            </div>
          </div>

          {/* Real-time stats cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3.5 bg-gray-50 dark:bg-darkCard rounded-xl border border-gray-100 dark:border-darkBorder">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Processed Records</span>
              <div className="text-lg font-bold text-gray-800 dark:text-gray-100 mt-0.5">
                {importProgress.processed_count.toLocaleString()} <span className="text-xs text-gray-400 font-normal">/ {(importProgress.total_count || rowCountEstimate).toLocaleString()}</span>
              </div>
            </div>

            <div className="p-3.5 bg-gray-50 dark:bg-darkCard rounded-xl border border-gray-100 dark:border-darkBorder">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Flagged AML Alerts</span>
              <div className="text-lg font-bold text-amber-500 mt-0.5">
                {importProgress.flagged_count.toLocaleString()}
              </div>
            </div>

            <div className="p-3.5 bg-gray-50 dark:bg-darkCard rounded-xl border border-gray-100 dark:border-darkBorder">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Screening Memoization</span>
              <div className="text-xs font-semibold text-emerald-500 mt-1 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> In-Memory Cached
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 6: Success Result ── */}
      {step === 'success' && importResult && (
        <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl space-y-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h5 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                Transaction Import Completed Successfully!
              </h5>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {importResult.message}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 bg-white/50 dark:bg-darkBg/60 rounded-xl border border-emerald-500/20">
              <span className="text-[10px] uppercase font-bold text-gray-400">Transactions Ingested</span>
              <div className="text-lg font-bold text-gray-800 dark:text-gray-100">
                {importResult.processed?.toLocaleString()}
              </div>
            </div>

            <div className="p-3 bg-white/50 dark:bg-darkBg/60 rounded-xl border border-emerald-500/20">
              <span className="text-[10px] uppercase font-bold text-gray-400">Flagged AML Alerts</span>
              <div className="text-lg font-bold text-amber-500">
                {importResult.flagged?.toLocaleString()}
              </div>
            </div>

            <div className="p-3 bg-white/50 dark:bg-darkBg/60 rounded-xl border border-emerald-500/20">
              <span className="text-[10px] uppercase font-bold text-gray-400">Elapsed Time</span>
              <div className="text-lg font-bold text-gray-800 dark:text-gray-100">
                {importResult.elapsed_seconds || 0}s
              </div>
            </div>

            <div className="p-3 bg-white/50 dark:bg-darkBg/60 rounded-xl border border-emerald-500/20">
              <span className="text-[10px] uppercase font-bold text-gray-400">Mapping Template</span>
              <div className="text-xs font-semibold text-emerald-500 truncate mt-1">
                {importResult.template_saved ? 'Saved for future files' : 'Used for this batch'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-emerald-500/20">
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-darkBorder dark:hover:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 rounded-xl transition-all"
            >
              Import Another Dataset
            </button>
            <button
              onClick={() => {
                if (onImportComplete) onImportComplete(importResult);
                if (onClose) onClose();
                navigate('/transactions');
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-xl shadow-md transition-all flex items-center gap-1.5"
            >
              <span>View Transactions</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (onImportComplete) onImportComplete(importResult);
                if (onClose) onClose();
                navigate('/dashboard');
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white rounded-xl shadow-md transition-all flex items-center gap-1.5"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Go to Dashboard</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
