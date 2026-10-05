import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import {
  FileText,
  FileSpreadsheet,
  Download,
  FileCode,
  CheckCircle,
  AlertTriangle,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Eye,
  CheckSquare,
  X,
  Calendar,
  Layers,
  ShieldCheck,
  Building,
  UserCheck,
  AlertCircle,
  Plus
} from 'lucide-react';

const Reports = () => {
  const { API_URL, user } = useContext(AuthContext);

  // Tab: 'str' | 'ctr'
  const [activeTab, setActiveTab] = useState('str');

  // STR State
  const [strs, setStrs] = useState([]);
  const [loadingSTR, setLoadingSTR] = useState(true);
  const [strStatusFilter, setStrStatusFilter] = useState('');
  const [strSearch, setStrSearch] = useState('');

  // CTR State
  const [ctrs, setCtrs] = useState([]);
  const [loadingCTR, setLoadingCTR] = useState(true);
  const [ctrPeriodFilter, setCtrPeriodFilter] = useState('');
  const [ctrSearch, setCtrSearch] = useState('');

  // Modals
  const [selectedSTR, setSelectedSTR] = useState(null);
  const [selectedCTR, setSelectedCTR] = useState(null);
  const [isGenerateCtrOpen, setIsGenerateCtrOpen] = useState(false);
  const [ctrPeriodInput, setCtrPeriodInput] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [ctrThresholdInput, setCtrThresholdInput] = useState(1000000);
  const [isAckModalOpen, setIsAckModalOpen] = useState(false);
  const [targetSTRForFiling, setTargetSTRForFiling] = useState(null);
  const [ackRefInput, setAckRefInput] = useState('');

  // Fetch STRs
  const fetchSTRs = async () => {
    try {
      setLoadingSTR(true);
      const params = {};
      if (strStatusFilter === 'Overdue') {
        params.overdue = 'true';
      } else if (strStatusFilter) {
        params.status = strStatusFilter;
      }

      const res = await axios.get(`${API_URL}/api/reports/str`, { params });
      setStrs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching STRs:", err);
    } finally {
      setLoadingSTR(false);
    }
  };

  // Fetch CTRs
  const fetchCTRs = async () => {
    try {
      setLoadingCTR(true);
      const params = {};
      if (ctrPeriodFilter) params.period = ctrPeriodFilter;

      const res = await axios.get(`${API_URL}/api/reports/ctr`, { params });
      setCtrs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching CTRs:", err);
    } finally {
      setLoadingCTR(false);
    }
  };

  useEffect(() => {
    fetchSTRs();
  }, [strStatusFilter, API_URL]);

  useEffect(() => {
    fetchCTRs();
  }, [ctrPeriodFilter, API_URL]);

  // Four-Eyes Approval
  const handleApproveSTR = async (str) => {
    try {
      const res = await axios.post(`${API_URL}/api/reports/str/${str.str_id}/approve`);
      alert("STR successfully approved under Four-Eyes validation!");
      fetchSTRs();
      if (selectedSTR && selectedSTR.str_id === str.str_id) {
        setSelectedSTR(res.data.str);
      }
    } catch (err) {
      alert("Approval Failed: " + (err.response?.data?.error || err.message));
    }
  };

  // File STR
  const handleConfirmFiling = async (e) => {
    e.preventDefault();
    if (!targetSTRForFiling) return;
    try {
      const res = await axios.post(`${API_URL}/api/reports/str/${targetSTRForFiling.str_id}/file`, {
        acknowledgement_reference: ackRefInput
      });
      alert("STR filed successfully with FIU-IND!");
      setIsAckModalOpen(false);
      setTargetSTRForFiling(null);
      setAckRefInput('');
      fetchSTRs();
      if (selectedSTR && selectedSTR.str_id === targetSTRForFiling.str_id) {
        setSelectedSTR(res.data.str);
      }
    } catch (err) {
      alert("Filing Failed: " + (err.response?.data?.error || err.message));
    }
  };

  // Generate CTR batch
  const handleGenerateCTR = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/api/reports/ctr/generate`, {
        period: ctrPeriodInput,
        threshold_inr: Number(ctrThresholdInput)
      });
      alert(`CTR aggregation generated: ${res.data.count} report(s) compiled.`);
      setIsGenerateCtrOpen(false);
      fetchCTRs();
    } catch (err) {
      alert("Failed to generate CTR batch: " + (err.response?.data?.error || err.message));
    }
  };

  // Export handlers
  const handleExport = (type, id, format) => {
    const url = format === 'pdf'
      ? `${API_URL}/api/reports/${type}/${id}/pdf`
      : `${API_URL}/api/reports/${type}/${id}/export?format=${format}`;
    window.open(url, '_blank');
  };

  // Filtered STR list
  const filteredSTRs = strs.filter(s => {
    if (!strSearch) return true;
    const q = strSearch.toLowerCase();
    return (
      (s.str_id && s.str_id.toLowerCase().includes(q)) ||
      (s.case_id && s.case_id.toLowerCase().includes(q)) ||
      (s.subject?.name && s.subject.name.toLowerCase().includes(q)) ||
      (s.subject?.customer_id && s.subject.customer_id.toLowerCase().includes(q))
    );
  });

  // Filtered CTR list
  const filteredCTRs = ctrs.filter(c => {
    if (!ctrSearch) return true;
    const q = ctrSearch.toLowerCase();
    return (
      (c.ctr_id && c.ctr_id.toLowerCase().includes(q)) ||
      (c.customer_name && c.customer_name.toLowerCase().includes(q)) ||
      (c.customer_id && c.customer_id.toLowerCase().includes(q)) ||
      (c.account_id && c.account_id.toLowerCase().includes(q))
    );
  });

  // Calculate Metrics
  const strMetrics = {
    total: strs.length,
    drafts: strs.filter(s => s.status === 'Draft').length,
    pending: strs.filter(s => s.status === 'Pending Approval').length,
    filed: strs.filter(s => s.status === 'Filed').length,
    overdue: strs.filter(s => s.is_overdue).length
  };

  const ctrMetrics = {
    total: ctrs.length,
    totalVolume: ctrs.reduce((sum, c) => sum + (c.total_cash_amount || 0), 0),
    overdue: ctrs.filter(c => c.is_overdue).length
  };

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Regulatory Reporting Engine (FIU-IND / PMLA)" />

      <main className="p-8 space-y-8 max-w-7xl mx-auto">
        
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Building className="w-6 h-6 text-rose-600 dark:text-rose-400" />
              FIU-IND Regulatory Compliance & Reporting Hub
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Statutory Suspicious Transaction Reports (STR Form-1) and Cash Transaction Reports (CTR Aggregation) pursuant to PMLA 2002.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchSTRs(); fetchCTRs(); }}
              className="px-3 py-2 border border-gray-200 dark:border-darkBorder bg-white dark:bg-darkPanel text-xs font-semibold text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 flex items-center gap-1.5 transition-all shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            {activeTab === 'ctr' && (
              <button
                onClick={() => setIsGenerateCtrOpen(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-md shadow-emerald-900/10 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Run CTR Cash Aggregation
              </button>
            )}
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass-panel p-4 space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total STR Filings</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-gray-800 dark:text-white">{strMetrics.total}</span>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded">
                {strMetrics.filed} Filed
              </span>
            </div>
            <p className="text-[10px] text-gray-400">{strMetrics.pending} Pending Four-Eyes Review</p>
          </div>

          <div className="glass-panel p-4 space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">STR SLA Tracker</span>
            <div className="flex items-baseline justify-between">
              <span className={`text-2xl font-extrabold ${strMetrics.overdue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {strMetrics.overdue}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                strMetrics.overdue > 0 ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {strMetrics.overdue > 0 ? 'Action Required' : 'SLA Compliant'}
              </span>
            </div>
            <p className="text-[10px] text-gray-400">Default 7-day PMLA window</p>
          </div>

          <div className="glass-panel p-4 space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">CTR Aggregated Reports</span>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-gray-800 dark:text-white">{ctrMetrics.total}</span>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                &gt;= 10 Lakhs
              </span>
            </div>
            <p className="text-[10px] text-gray-400">Due 15th of next month</p>
          </div>

          <div className="glass-panel p-4 space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Aggregated Cash Volume</span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-extrabold text-emerald-600">
                ₹{(ctrMetrics.totalVolume / 100000).toFixed(1)}L
              </span>
              <span className="text-[10px] font-mono font-bold text-gray-500">
                INR
              </span>
            </div>
            <p className="text-[10px] text-gray-400">Over threshold cash flows</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-gray-200 dark:border-darkBorder gap-4">
          <button
            onClick={() => setActiveTab('str')}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'str'
                ? 'border-rose-600 text-rose-600 dark:text-rose-400 dark:border-rose-400'
                : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            <FileText className="w-4 h-4" /> Suspicious Transaction Reports (STR)
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
              {strs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('ctr')}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'ctr'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-400'
                : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            <Layers className="w-4 h-4" /> Cash Transaction Reports (CTR)
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
              {ctrs.length}
            </span>
          </button>
        </div>

        {/* STR WORKFLOW TAB */}
        {activeTab === 'str' && (
          <div className="space-y-4 animate-fade-in">
            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 glass-panel">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  value={strSearch}
                  onChange={(e) => setStrSearch(e.target.value)}
                  placeholder="Search by STR ID, Case ID, Subject Name, Customer ID..."
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg text-xs outline-none focus:border-rose-500 text-gray-800 dark:text-gray-200"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={strStatusFilter}
                  onChange={(e) => setStrStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-200 outline-none"
                >
                  <option value="">All STR Statuses</option>
                  <option value="Draft">Draft</option>
                  <option value="Pending Approval">Pending Approval</option>
                  <option value="Filed">Filed</option>
                  <option value="Rejected">Rejected</option>
                  <option value="Overdue">Overdue Filings</option>
                </select>
              </div>
            </div>

            {/* STR Records Table */}
            <div className="glass-panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100/60 dark:bg-darkBorder/40 text-gray-400 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-4">STR ID & Case</th>
                      <th className="py-3 px-4">Subject & Account</th>
                      <th className="py-3 px-4">Grounds of Suspicion</th>
                      <th className="py-3 px-4">Reported Flow</th>
                      <th className="py-3 px-4">Due Date & SLA</th>
                      <th className="py-3 px-4">Status & Four-Eyes</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-darkBorder font-medium">
                    {loadingSTR ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-gray-400">Loading STR filings...</td>
                      </tr>
                    ) : filteredSTRs.length > 0 ? (
                      filteredSTRs.map((s) => (
                        <tr key={s.str_id} className="hover:bg-gray-50/50 dark:hover:bg-darkBorder/20 transition-all">
                          <td className="py-3.5 px-4">
                            <span className="font-mono font-bold text-gray-800 dark:text-gray-200 block">
                              {s.str_id}
                            </span>
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">
                              Case: {s.case_id || 'N/A'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <b className="text-gray-800 dark:text-white block">{s.subject?.name || 'Primary Subject'}</b>
                            <span className="text-[10px] text-gray-400 block font-mono">
                              CID: {s.subject?.customer_id || 'N/A'} • {s.subject?.kyc_risk_rating || 'High'} Risk
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-block px-1.5 py-0.5 rounded font-bold text-[10px] bg-gray-100 dark:bg-darkBorder text-gray-700 dark:text-gray-300">
                              {s.ground_for_suspicion_code || 'G01'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <b className="text-gray-800 dark:text-white block">
                              INR {(s.total_amount || 0).toLocaleString('en-IN')}
                            </b>
                            <span className="text-[10px] text-gray-400">
                              {s.transaction_count || 0} Transactions
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="block text-gray-700 dark:text-gray-300">
                              {s.due_date ? new Date(s.due_date).toLocaleDateString('en-IN') : 'N/A'}
                            </span>
                            {s.is_overdue ? (
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                                <AlertTriangle className="w-2.5 h-2.5" /> Overdue
                              </span>
                            ) : s.status === 'Filed' ? (
                              <span className="text-[9px] text-emerald-600 font-bold">Filed on time</span>
                            ) : (
                              <span className="text-[9px] text-gray-400">Within SLA</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                              s.status === 'Filed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                              s.status === 'Pending Approval' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                              s.status === 'Rejected' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                              'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                            }`}>
                              {s.status}
                            </span>
                            <span className="block text-[9px] text-gray-400 mt-1">
                              P: {s.prepared_by || 'Investigator'} | A: {s.approved_by || 'Pending'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setSelectedSTR(s)}
                                className="p-1.5 text-gray-500 hover:text-blue-600 bg-gray-100 hover:bg-blue-50 dark:bg-darkBorder dark:hover:bg-blue-950/40 rounded transition-all"
                                title="View Details & Narrative"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleExport('str', s.str_id, 'pdf')}
                                className="p-1.5 text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 dark:bg-darkBorder dark:hover:bg-gray-700 rounded transition-all"
                                title="Export PDF"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleExport('str', s.str_id, 'xml')}
                                className="p-1.5 text-gray-500 hover:text-blue-600 bg-gray-100 hover:bg-blue-50 dark:bg-darkBorder dark:hover:bg-blue-950/40 rounded transition-all"
                                title="Export XML"
                              >
                                <FileCode className="w-3.5 h-3.5" />
                              </button>

                              {/* Approval Quick Action */}
                              {s.status === 'Draft' && (
                                <button
                                  onClick={() => handleApproveSTR(s)}
                                  className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded transition-all"
                                  title="Approve under Four-Eyes"
                                >
                                  Approve
                                </button>
                              )}

                              {/* Filing Quick Action */}
                              {s.status === 'Pending Approval' && (
                                <button
                                  onClick={() => { setTargetSTRForFiling(s); setIsAckModalOpen(true); }}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded transition-all"
                                  title="Mark as Filed with FIU"
                                >
                                  File
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-gray-400">
                          No Suspicious Transaction Reports match the filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* CTR WORKFLOW TAB */}
        {activeTab === 'ctr' && (
          <div className="space-y-4 animate-fade-in">
            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 glass-panel">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  value={ctrSearch}
                  onChange={(e) => setCtrSearch(e.target.value)}
                  placeholder="Search by CTR ID, Customer Name, CID, Account Number..."
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg text-xs outline-none focus:border-emerald-500 text-gray-800 dark:text-gray-200"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="month"
                  value={ctrPeriodFilter}
                  onChange={(e) => setCtrPeriodFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-200 outline-none"
                />
                {ctrPeriodFilter && (
                  <button
                    onClick={() => setCtrPeriodFilter('')}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* CTR Records Table */}
            <div className="glass-panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100/60 dark:bg-darkBorder/40 text-gray-400 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-4">CTR ID & Period</th>
                      <th className="py-3 px-4">Customer Details</th>
                      <th className="py-3 px-4">Primary Account</th>
                      <th className="py-3 px-4">Aggregated Cash Volume</th>
                      <th className="py-3 px-4">Filing Due Date</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-darkBorder font-medium">
                    {loadingCTR ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-gray-400">Loading CTR records...</td>
                      </tr>
                    ) : filteredCTRs.length > 0 ? (
                      filteredCTRs.map((c) => (
                        <tr key={c.ctr_id} className="hover:bg-gray-50/50 dark:hover:bg-darkBorder/20 transition-all">
                          <td className="py-3.5 px-4">
                            <span className="font-mono font-bold text-gray-800 dark:text-gray-200 block">
                              {c.ctr_id}
                            </span>
                            <span className="text-[10px] text-emerald-600 font-bold">
                              Period: {c.period}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <b className="text-gray-800 dark:text-white block">{c.customer_name || 'N/A'}</b>
                            <span className="text-[10px] text-gray-400 font-mono">CID: {c.customer_id || 'N/A'}</span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-gray-700 dark:text-gray-300">
                            {c.account_id || 'N/A'}
                          </td>
                          <td className="py-3.5 px-4">
                            <b className="text-emerald-600 block">
                              INR {(c.total_cash_amount || 0).toLocaleString('en-IN')}
                            </b>
                            <span className="text-[10px] text-gray-400">
                              {c.transaction_count || 1} Cash Deposit/Withdrawal(s)
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="block text-gray-700 dark:text-gray-300">
                              {c.due_date ? new Date(c.due_date).toLocaleDateString('en-IN') : 'N/A'}
                            </span>
                            <span className="text-[9px] text-gray-400">Due 15th of month</span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                              {c.status || 'Generated'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setSelectedCTR(c)}
                                className="p-1.5 text-gray-500 hover:text-emerald-600 bg-gray-100 hover:bg-emerald-50 dark:bg-darkBorder dark:hover:bg-emerald-950/40 rounded transition-all"
                                title="View Cash Breakdown"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleExport('ctr', c.ctr_id, 'pdf')}
                                className="p-1.5 text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 dark:bg-darkBorder dark:hover:bg-gray-700 rounded transition-all"
                                title="Export PDF"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleExport('ctr', c.ctr_id, 'xml')}
                                className="p-1.5 text-gray-500 hover:text-emerald-600 bg-gray-100 hover:bg-emerald-50 dark:bg-darkBorder dark:hover:bg-emerald-950/40 rounded transition-all"
                                title="Export XML"
                              >
                                <FileCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleExport('ctr', c.ctr_id, 'json')}
                                className="p-1.5 text-gray-500 hover:text-indigo-600 bg-gray-100 hover:bg-indigo-50 dark:bg-darkBorder dark:hover:bg-indigo-950/40 rounded transition-all"
                                title="Export JSON"
                              >
                                <FileSpreadsheet className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-gray-400">
                          No Cash Transaction Reports found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* VIEW STR DETAILS MODAL */}
      {selectedSTR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-5 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-start pb-3 border-b border-gray-100 dark:border-darkBorder">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-extrabold text-rose-600">{selectedSTR.str_id}</span>
                  <span className="text-xs px-2 py-0.5 rounded font-bold bg-gray-100 dark:bg-darkBorder text-gray-700 dark:text-gray-300">
                    {selectedSTR.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Case Ref: {selectedSTR.case_id} • Due Date: {new Date(selectedSTR.due_date).toLocaleDateString('en-IN')}
                </p>
              </div>
              <button onClick={() => setSelectedSTR(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Subject Snapshot */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-gray-50 dark:bg-darkBg rounded-lg">
                <span className="text-[10px] text-gray-400 font-bold uppercase block">Subject Name</span>
                <b className="text-gray-800 dark:text-white">{selectedSTR.subject?.name || 'N/A'}</b>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-darkBg rounded-lg">
                <span className="text-[10px] text-gray-400 font-bold uppercase block">Total Flow</span>
                <b className="text-rose-600">INR {(selectedSTR.total_amount || 0).toLocaleString('en-IN')}</b>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-darkBg rounded-lg">
                <span className="text-[10px] text-gray-400 font-bold uppercase block">Preparer</span>
                <b className="text-gray-700 dark:text-gray-300">{selectedSTR.prepared_by || 'N/A'}</b>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-darkBg rounded-lg">
                <span className="text-[10px] text-gray-400 font-bold uppercase block">Approver</span>
                <b className="text-gray-700 dark:text-gray-300">{selectedSTR.approved_by || 'Pending Four-Eyes'}</b>
              </div>
            </div>

            {/* Full Narrative Text Box */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                Deterministic STR Narrative (PMLA Section 12)
              </label>
              <div className="p-4 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                {selectedSTR.narrative || 'No narrative compiled.'}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-darkBorder flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExport('str', selectedSTR.str_id, 'pdf')}
                  className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> PDF
                </button>
                <button
                  onClick={() => handleExport('str', selectedSTR.str_id, 'xml')}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <FileCode className="w-3.5 h-3.5" /> XML
                </button>
                <button
                  onClick={() => handleExport('str', selectedSTR.str_id, 'json')}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> JSON
                </button>
              </div>

              <div className="flex items-center gap-2">
                {selectedSTR.status === 'Draft' && (
                  <button
                    onClick={() => handleApproveSTR(selectedSTR)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg flex items-center gap-1"
                  >
                    <CheckSquare className="w-3.5 h-3.5" /> Approve (Four-Eyes)
                  </button>
                )}
                {selectedSTR.status === 'Pending Approval' && (
                  <button
                    onClick={() => { setTargetSTRForFiling(selectedSTR); setIsAckModalOpen(true); }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg flex items-center gap-1"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> File with FIU-IND
                  </button>
                )}
                <button
                  onClick={() => setSelectedSTR(null)}
                  className="px-4 py-2 border border-gray-200 dark:border-darkBorder text-gray-700 dark:text-gray-300 rounded-lg text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW CTR DETAILS MODAL */}
      {selectedCTR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-start pb-3 border-b border-gray-100 dark:border-darkBorder">
              <div>
                <span className="font-mono text-sm font-extrabold text-emerald-600">{selectedCTR.ctr_id}</span>
                <p className="text-xs text-gray-400">
                  Customer: {selectedCTR.customer_name} ({selectedCTR.customer_id}) • Account: {selectedCTR.account_id}
                </p>
              </div>
              <button onClick={() => setSelectedCTR(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 block">Total Aggregated Cash</span>
                <b className="text-base text-emerald-800 dark:text-emerald-300">INR {(selectedCTR.total_cash_amount || 0).toLocaleString('en-IN')}</b>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Reporting Period</span>
                <b className="text-xs font-bold text-gray-700 dark:text-gray-300">{selectedCTR.period}</b>
              </div>
            </div>

            {/* Transactions Schedule */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                Aggregated Cash Transactions ({selectedCTR.transaction_count || 1})
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {(selectedCTR.transactions || []).map((t, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 dark:bg-darkBg border border-gray-100 dark:border-darkBorder rounded-lg text-xs flex justify-between items-center">
                    <div>
                      <b className="text-gray-800 dark:text-white font-mono block">Tx {t.transaction_id}</b>
                      <span className="text-[10px] text-gray-400">{t.timestamp ? new Date(t.timestamp).toLocaleString('en-IN') : 'N/A'}</span>
                    </div>
                    <b className="text-emerald-600">INR {(t.amount || 0).toLocaleString('en-IN')}</b>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-darkBorder">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExport('ctr', selectedCTR.ctr_id, 'pdf')}
                  className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> PDF
                </button>
                <button
                  onClick={() => handleExport('ctr', selectedCTR.ctr_id, 'xml')}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <FileCode className="w-3.5 h-3.5" /> XML
                </button>
              </div>
              <button
                onClick={() => setSelectedCTR(null)}
                className="px-4 py-2 bg-gray-100 dark:bg-darkBorder text-gray-700 dark:text-gray-300 rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GENERATE CTR BATCH MODAL */}
      {isGenerateCtrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-emerald-500" />
                Run Monthly CTR Cash Aggregation
              </h4>
              <button onClick={() => setIsGenerateCtrOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateCTR} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Target Reporting Period (YYYY-MM)
                </label>
                <input
                  type="month"
                  value={ctrPeriodInput}
                  onChange={(e) => setCtrPeriodInput(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none font-semibold text-gray-700 dark:text-gray-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Statutory Cash Threshold (INR)
                </label>
                <input
                  type="number"
                  value={ctrThresholdInput}
                  onChange={(e) => setCtrThresholdInput(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none font-semibold text-gray-700 dark:text-gray-200"
                />
                <p className="text-[10px] text-gray-400">Default: ₹10,00,000 (10 Lakhs) per PMLA Maintenance of Records Rules.</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsGenerateCtrOpen(false)}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-md shadow-emerald-900/10"
                >
                  Execute CTR Aggregation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STR FIU ACK MODAL */}
      {isAckModalOpen && targetSTRForFiling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                File STR with FIU-IND
              </h4>
              <button onClick={() => { setIsAckModalOpen(false); setTargetSTRForFiling(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmFiling} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  FIU-IND Acknowledgement Reference Number
                </label>
                <input
                  type="text"
                  value={ackRefInput}
                  onChange={(e) => setAckRefInput(e.target.value)}
                  placeholder="e.g. FIU-ACK-2026-990412"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none font-mono text-xs text-gray-700 dark:text-gray-200"
                />
                <p className="text-[10px] text-gray-400">Leave blank to auto-generate a provisional FIU acknowledgement token.</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setIsAckModalOpen(false); setTargetSTRForFiling(null); }}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-md shadow-emerald-900/10"
                >
                  Confirm Filing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Reports;
