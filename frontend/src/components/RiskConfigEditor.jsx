import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Sliders, 
  Globe, 
  Clock, 
  CreditCard, 
  ShieldAlert, 
  Save, 
  RotateCcw, 
  Plus, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle,
  FileCheck
} from 'lucide-react';

const RiskConfigEditor = ({ API_URL }) => {
  const [config, setConfig] = useState(null);
  const [originalConfig, setOriginalConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // New jurisdiction state
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newSource, setNewSource] = useState('FATF Monitored Jurisdictions');
  const [newPaymentMethod, setNewPaymentMethod] = useState('');

  const getAuthHeaders = () => {
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API_URL}/api/admin/risk-config`, {
        headers: getAuthHeaders()
      });
      if (res.data.success) {
        setConfig(res.data.data);
        setOriginalConfig(JSON.parse(JSON.stringify(res.data.data)));
      }
    } catch (err) {
      console.error("Failed to load risk configuration:", err);
      setError(err.response?.data?.error || "Failed to load risk configuration.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [API_URL]);

  const handleSave = async () => {
    if (!config) return;

    // Client-side validations
    const ctr = Number(config.ctr_threshold);
    if (!ctr || ctr <= 0) {
      setError("CTR Threshold must be a positive number.");
      return;
    }

    const minPct = Number(config.structuring_band?.min_percent);
    const maxPct = Number(config.structuring_band?.max_percent);
    if (minPct >= maxPct || minPct <= 0 || maxPct > 100) {
      setError("Structuring Band must satisfy: 0% < Min Percent < Max Percent <= 100%.");
      return;
    }

    const { critical, high, medium, low } = config.alert_level_cutoffs;
    if (!(critical > high && high > medium && medium > low)) {
      setError("Alert Cutoffs must strictly satisfy: Critical > High > Medium > Low.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMsg(null);
      const res = await axios.put(`${API_URL}/api/admin/risk-config`, config, {
        headers: getAuthHeaders()
      });
      if (res.data.success) {
        setConfig(res.data.data);
        setOriginalConfig(JSON.parse(JSON.stringify(res.data.data)));
        setSuccessMsg(res.data.message || "Risk configuration updated and audit-logged successfully.");
        setTimeout(() => setSuccessMsg(null), 5000);
      }
    } catch (err) {
      console.error("Failed to save risk config:", err);
      setError(err.response?.data?.error || "Failed to save risk configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (originalConfig) {
      setConfig(JSON.parse(JSON.stringify(originalConfig)));
      setError(null);
      setSuccessMsg("Changes discarded. Configuration reloaded.");
      setTimeout(() => setSuccessMsg(null), 3000);
    }
  };

  // Jurisdiction actions
  const handleAddJurisdiction = (e) => {
    e.preventDefault();
    if (!newCode.trim()) return;
    const cleanCode = newCode.trim().toUpperCase();
    if (config.high_risk_jurisdictions && config.high_risk_jurisdictions[cleanCode]) {
      setError(`Jurisdiction code ${cleanCode} already exists in configuration.`);
      return;
    }

    const updated = {
      ...config.high_risk_jurisdictions,
      [cleanCode]: {
        name: newName.trim() || cleanCode,
        label: newLabel.trim() || 'High-Risk Jurisdiction',
        source: newSource.trim() || 'National Watchlist',
        last_reviewed: new Date().toISOString().split('T')[0]
      }
    };

    setConfig({ ...config, high_risk_jurisdictions: updated });
    setNewCode('');
    setNewName('');
    setNewLabel('');
  };

  const handleDeleteJurisdiction = (code) => {
    const updated = { ...config.high_risk_jurisdictions };
    delete updated[code];
    setConfig({ ...config, high_risk_jurisdictions: updated });
  };

  const handleUpdateJurisdictionField = (code, field, value) => {
    const updated = {
      ...config.high_risk_jurisdictions,
      [code]: {
        ...config.high_risk_jurisdictions[code],
        [field]: value
      }
    };
    setConfig({ ...config, high_risk_jurisdictions: updated });
  };

  // Payment method actions
  const handleAddPaymentMethod = (e) => {
    e.preventDefault();
    if (!newPaymentMethod.trim()) return;
    const val = newPaymentMethod.trim();
    if (config.high_risk_payment_methods.includes(val)) return;
    setConfig({
      ...config,
      high_risk_payment_methods: [...config.high_risk_payment_methods, val]
    });
    setNewPaymentMethod('');
  };

  const handleRemovePaymentMethod = (method) => {
    setConfig({
      ...config,
      high_risk_payment_methods: config.high_risk_payment_methods.filter(m => m !== method)
    });
  };

  // Night hours toggle
  const toggleNightHour = (hour) => {
    const exists = config.night_hours.includes(hour);
    const updated = exists 
      ? config.night_hours.filter(h => h !== hour)
      : [...config.night_hours, hour].sort((a, b) => a - b);
    setConfig({ ...config, night_hours: updated });
  };

  if (loading) {
    return (
      <div className="p-8 text-center space-y-4">
        <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto" />
        <p className="text-xs text-gray-400 font-semibold tracking-wide">Loading canonical risk configuration...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-2xl text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
        <h4 className="text-sm font-bold text-red-600 dark:text-red-400">Failed to load risk configuration</h4>
        <p className="text-xs text-gray-500">{error || "Ensure backend server and config/risk_config.json are accessible."}</p>
        <button 
          onClick={fetchConfig}
          className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-xl hover:bg-red-700 transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  const ctrValue = Number(config.ctr_threshold || 1000000);
  const minPct = Number(config.structuring_band?.min_percent || 82);
  const maxPct = Number(config.structuring_band?.max_percent || 99.9);
  const structLower = (ctrValue * minPct) / 100;
  const structUpper = (ctrValue * maxPct) / 100;

  return (
    <div className="space-y-8 animate-fade-in text-gray-800 dark:text-gray-100">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-200/70 dark:border-darkBorder">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                AML Regulatory Risk & Threshold Configuration
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold">
                  v{config.version || '1.0.0'}
                </span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Shared canonical configuration (<code className="font-mono text-[11px] text-blue-500">config/risk_config.json</code>).
                All writes are strictly audit-logged with previous and updated values.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDiscard}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder/40 text-xs font-semibold text-gray-600 dark:text-gray-300 rounded-xl transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Discard
          </button>
          
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Updating & Logging...' : 'Save & Deploy Configuration'}
          </button>
        </div>
      </div>

      {/* Alerts / Feedback */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-2xl flex items-center gap-3 text-red-700 dark:text-red-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 rounded-2xl flex items-center gap-3 text-green-700 dark:text-green-300 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Metadata bar */}
      <div className="flex flex-wrap items-center gap-6 p-3.5 bg-gray-100/60 dark:bg-darkBg/60 border border-gray-200/50 dark:border-darkBorder/50 rounded-xl text-xs text-gray-500">
        <div>
          <span className="font-semibold text-gray-400 uppercase tracking-wider text-[10px] mr-1.5">Last Updated:</span>
          <span className="font-mono text-gray-700 dark:text-gray-300">
            {config.last_updated ? new Date(config.last_updated).toLocaleString() : 'N/A'}
          </span>
        </div>
        <div>
          <span className="font-semibold text-gray-400 uppercase tracking-wider text-[10px] mr-1.5">Updated By:</span>
          <span className="font-semibold text-gray-700 dark:text-gray-300">{config.updated_by || 'system'}</span>
        </div>
        <div className="flex-1 text-right text-[11px] text-gray-400 italic">
          verify against current rules (e.g. RBI Master Directions / FIU-IND Guidelines / PMLA 2002 / FATF Recommendations)
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* SECTION 1: CTR Threshold & Structuring Bounds */}
        <div className="bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-darkBorder">
            <FileCheck className="w-4 h-4 text-blue-500" />
            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
              Reporting Limits & Structuring Detection
            </h4>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                Cash Transaction Report (CTR) Threshold (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-gray-400 font-bold">₹</span>
                <input
                  type="number"
                  value={config.ctr_threshold}
                  onChange={(e) => setConfig({ ...config, ctr_threshold: parseFloat(e.target.value) || 0 })}
                  className="w-full pl-8 pr-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="1000000"
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Mandatory statutory cash reporting limit (Default: ₹10,00,000 under Rule 3 PMLA).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                  Structuring Min Band (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={config.structuring_band?.min_percent}
                    onChange={(e) => setConfig({
                      ...config,
                      structuring_band: {
                        ...config.structuring_band,
                        min_percent: parseFloat(e.target.value) || 0
                      }
                    })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-gray-400 font-semibold">%</span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                  Structuring Max Band (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={config.structuring_band?.max_percent}
                    onChange={(e) => setConfig({
                      ...config,
                      structuring_band: {
                        ...config.structuring_band,
                        max_percent: parseFloat(e.target.value) || 0
                      }
                    })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-gray-400 font-semibold">%</span>
                </div>
              </div>
            </div>

            {/* Computed Smurfing Window Preview */}
            <div className="p-3.5 bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-900/30 rounded-xl space-y-1">
              <div className="text-[11px] font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5" /> Effective Smurfing Detection Window:
              </div>
              <div className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                ₹{structLower.toLocaleString('en-IN')} – ₹{structUpper.toLocaleString('en-IN')}
              </div>
              <p className="text-[10px] text-blue-700/80 dark:text-blue-400/80">
                Transactions within {minPct}% to {maxPct}% of CTR threshold trigger the <code className="font-mono">amount_near_threshold</code> indicator.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                Large Retail Transfer Alert Threshold (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-gray-400 font-bold">₹</span>
                <input
                  type="number"
                  value={config.large_amount_threshold || 500000}
                  onChange={(e) => setConfig({ ...config, large_amount_threshold: parseFloat(e.target.value) || 0 })}
                  className="w-full pl-8 pr-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: Alert Severity Level Cutoffs */}
        <div className="bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-darkBorder">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
              Alert Triage Severity Cutoffs (Risk Scores)
            </h4>
          </div>

          <div className="space-y-4 text-xs">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Calibrate automated operational alert creation thresholds across risk tiers (0 to 100):
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-red-50/50 dark:bg-red-950/10 border border-red-200/50 dark:border-red-900/30 rounded-xl space-y-1.5">
                <span className="font-bold text-red-600 text-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" /> Critical Severity (≥)
                </span>
                <input
                  type="number"
                  value={config.alert_level_cutoffs?.critical}
                  onChange={(e) => setConfig({
                    ...config,
                    alert_level_cutoffs: {
                      ...config.alert_level_cutoffs,
                      critical: parseInt(e.target.value, 10) || 0
                    }
                  })}
                  className="w-full px-3 py-1.5 bg-white dark:bg-darkBg border border-red-200 dark:border-red-900/60 rounded-lg font-mono text-sm font-bold text-red-600 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/30 rounded-xl space-y-1.5">
                <span className="font-bold text-amber-600 text-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> High Severity (≥)
                </span>
                <input
                  type="number"
                  value={config.alert_level_cutoffs?.high}
                  onChange={(e) => setConfig({
                    ...config,
                    alert_level_cutoffs: {
                      ...config.alert_level_cutoffs,
                      high: parseInt(e.target.value, 10) || 0
                    }
                  })}
                  className="w-full px-3 py-1.5 bg-white dark:bg-darkBg border border-amber-200 dark:border-amber-900/60 rounded-lg font-mono text-sm font-bold text-amber-600 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200/50 dark:border-blue-900/30 rounded-xl space-y-1.5">
                <span className="font-bold text-blue-600 text-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> Medium Severity (≥)
                </span>
                <input
                  type="number"
                  value={config.alert_level_cutoffs?.medium}
                  onChange={(e) => setConfig({
                    ...config,
                    alert_level_cutoffs: {
                      ...config.alert_level_cutoffs,
                      medium: parseInt(e.target.value, 10) || 0
                    }
                  })}
                  className="w-full px-3 py-1.5 bg-white dark:bg-darkBg border border-blue-200 dark:border-blue-900/60 rounded-lg font-mono text-sm font-bold text-blue-600 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1.5">
                <span className="font-bold text-slate-600 dark:text-slate-400 text-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-400" /> Low Severity (≥)
                </span>
                <input
                  type="number"
                  value={config.alert_level_cutoffs?.low}
                  onChange={(e) => setConfig({
                    ...config,
                    alert_level_cutoffs: {
                      ...config.alert_level_cutoffs,
                      low: parseInt(e.target.value, 10) || 0
                    }
                  })}
                  className="w-full px-3 py-1.5 bg-white dark:bg-darkBg border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-sm font-bold text-slate-600 dark:text-slate-400 focus:outline-none"
                />
              </div>
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed">
              Transactions below Low cutoff (&lt; {config.alert_level_cutoffs?.low}) remain in the transaction ledger for monitoring but do not trigger automated alert case tickets.
            </p>
          </div>
        </div>

      </div>

      {/* SECTION 3: High-Risk Jurisdictions Table */}
      <div className="bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-2xl p-6 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-darkBorder">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
              High-Risk Jurisdictions Master List
            </h4>
          </div>
          <span className="text-xs text-gray-400">
            {Object.keys(config.high_risk_jurisdictions || {}).length} designated jurisdictions
          </span>
        </div>

        {/* Existing Jurisdictions Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50/70 dark:bg-darkBg/60 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-200/60 dark:border-darkBorder/60">
                <th className="px-3.5 py-2.5">Code</th>
                <th className="px-3.5 py-2.5">Jurisdiction Name</th>
                <th className="px-3.5 py-2.5">Configured Label</th>
                <th className="px-3.5 py-2.5">Regulatory Source</th>
                <th className="px-3.5 py-2.5">Last Reviewed</th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-darkBorder/40">
              {Object.entries(config.high_risk_jurisdictions || {}).map(([code, jur]) => (
                <tr key={code} className="hover:bg-gray-50/50 dark:hover:bg-darkBg/30">
                  <td className="px-3.5 py-2 font-mono font-bold text-indigo-600 dark:text-indigo-400">{code}</td>
                  <td className="px-3.5 py-2">
                    <input
                      type="text"
                      value={jur.name || ''}
                      onChange={(e) => handleUpdateJurisdictionField(code, 'name', e.target.value)}
                      className="px-2 py-1 bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-darkBorder focus:border-blue-500 focus:bg-white dark:focus:bg-darkBg rounded text-xs w-full focus:outline-none"
                    />
                  </td>
                  <td className="px-3.5 py-2">
                    <input
                      type="text"
                      value={jur.label || ''}
                      onChange={(e) => handleUpdateJurisdictionField(code, 'label', e.target.value)}
                      className="px-2 py-1 bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-darkBorder focus:border-blue-500 focus:bg-white dark:focus:bg-darkBg rounded text-xs w-full focus:outline-none"
                    />
                  </td>
                  <td className="px-3.5 py-2 text-gray-500 dark:text-gray-400">
                    <input
                      type="text"
                      value={jur.source || ''}
                      onChange={(e) => handleUpdateJurisdictionField(code, 'source', e.target.value)}
                      className="px-2 py-1 bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-darkBorder focus:border-blue-500 focus:bg-white dark:focus:bg-darkBg rounded text-xs w-full focus:outline-none"
                    />
                  </td>
                  <td className="px-3.5 py-2 font-mono text-[11px] text-gray-400">
                    <input
                      type="date"
                      value={jur.last_reviewed || ''}
                      onChange={(e) => handleUpdateJurisdictionField(code, 'last_reviewed', e.target.value)}
                      className="px-1.5 py-0.5 bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-darkBorder rounded text-[11px] focus:outline-none"
                    />
                  </td>
                  <td className="px-3.5 py-2 text-right">
                    <button
                      onClick={() => handleDeleteJurisdiction(code)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
                      title="Remove Jurisdiction"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Jurisdiction Form */}
        <form onSubmit={handleAddJurisdiction} className="p-4 bg-gray-50/70 dark:bg-darkBg/40 border border-gray-200/60 dark:border-darkBorder/60 rounded-xl space-y-3">
          <div className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-blue-500" /> Add Designated Jurisdiction
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <input
                type="text"
                maxLength={3}
                placeholder="ISO Code (e.g. VG)"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-lg font-mono uppercase focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <input
                type="text"
                placeholder="Jurisdiction Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <input
                type="text"
                placeholder="Label (e.g. Tax Haven)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Regulatory Source"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shrink-0 transition-all text-xs"
              >
                Add
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* SECTION 4: High-Risk Payment Methods & Night Hours */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* High Risk Payment Rails */}
        <div className="bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-darkBorder">
            <CreditCard className="w-4 h-4 text-purple-500" />
            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
              High-Risk Payment Channels
            </h4>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              {config.high_risk_payment_methods?.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-300 font-semibold border border-purple-200/60 dark:border-purple-900/40"
                >
                  {m}
                  <button
                    type="button"
                    onClick={() => handleRemovePaymentMethod(m)}
                    className="hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <form onSubmit={handleAddPaymentMethod} className="flex gap-2 pt-2">
              <input
                type="text"
                placeholder="Add payment method (e.g. Hawala, Prepaid Card)"
                value={newPaymentMethod}
                onChange={(e) => setNewPaymentMethod(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl text-xs transition-all"
              >
                Add Method
              </button>
            </form>
          </div>
        </div>

        {/* Night Hours Window */}
        <div className="bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-darkBorder">
            <Clock className="w-4 h-4 text-blue-500" />
            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
              Off-Hours Execution Window (Night Hours)
            </h4>
          </div>

          <div className="space-y-3 text-xs">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Click hours (00 to 23) to toggle designation as suspicious off-hours operations:
            </p>

            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
              {Array.from({ length: 24 }).map((_, h) => {
                const isSelected = config.night_hours?.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => toggleNightHour(h)}
                    className={`py-2 text-center rounded-xl font-mono text-xs font-bold transition-all border ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/30'
                        : 'bg-gray-50 dark:bg-darkBg text-gray-500 border-gray-200 dark:border-darkBorder hover:border-blue-400'
                    }`}
                  >
                    {String(h).padStart(2, '0')}:00
                  </button>
                );
              })}
            </div>
            
            <p className="text-[11px] text-gray-400 italic pt-1">
              Active off-hours ({config.night_hours?.length} hours configured): transfers during these hours trigger the <code className="font-mono">is_night</code> red flag.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
};

export default RiskConfigEditor;
