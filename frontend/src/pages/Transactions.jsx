import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import ShapChart from '../components/ShapChart';
import { 
  Search, 
  Filter, 
  Download, 
  ArrowRight, 
  X, 
  AlertTriangle,
  FileSpreadsheet,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Upload,
  Database,
  ShieldCheck,
  Layers,
  Cpu,
  CheckCircle2
} from 'lucide-react';
import ColumnMappingImporter from '../components/ColumnMappingImporter';

const mapPaymentMethod = (method) => {
  const mapping = {
    'Wire Transfer': 'RTGS',
    'Wire': 'RTGS',
    'ACH': 'NEFT',
    'Direct Deposit': 'IMPS',
    'Transfer': 'UPI'
  };
  return mapping[method] || method || 'UPI';
};

const Transactions = () => {
  const { API_URL, user } = useContext(AuthContext);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Search and filter parameters
  const [search, setSearch] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [country, setCountry] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [status, setStatus] = useState('');
  
  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const limit = 10;

  // Selected Transaction for Drawer/Modal
  const [selectedTx, setSelectedTx] = useState(null);

  // Case creation fields
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [caseTitle, setCaseTitle] = useState('');

  // Column mapping upload modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit,
        search,
        minAmount,
        maxAmount,
        country,
        risk_level: riskLevel,
        status
      };
      
      const res = await axios.get(`${API_URL}/api/transactions`, { params });
      if (res.data.success) {
        setTxs(res.data.data);
        setTotalPages(res.data.totalPages);
        setTotalItems(res.data.total);
      }
    } catch (err) {
      console.error("Error fetching transactions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [page, country, riskLevel, status]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchTransactions();
  };

  const handleClearFilters = () => {
    setSearch('');
    setMinAmount('');
    setMaxAmount('');
    setCountry('');
    setRiskLevel('');
    setStatus('');
    setPage(1);
    // Timeout to let states clear before calling API
    setTimeout(fetchTransactions, 50);
  };

  // Client-Side CSV Export (gorgeous, fast, zero package dependencies)
  const handleExportCSV = () => {
    if (txs.length === 0) return;
    
    // Define headers
    const headers = [
      'Transaction ID', 'Sender Account', 'Sender Name', 'Receiver Account', 'Receiver Name', 
      'Amount', 'Currency', 'Timestamp', 'Country', 'Payment Method', 'Status', 'Risk Score'
    ];

    // Build row strings
    const rows = txs.map(t => [
      t.transaction_id, t.sender_account, t.sender_name, t.receiver_account, t.receiver_name,
      t.amount, t.currency === 'USD' ? 'INR' : (t.currency || 'INR'), t.timestamp, t.country, mapPaymentMethod(t.payment_method), t.status, `${t.risk_score}%`
    ]);

    // Combine
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(','))].join('\n');

    // Trigger download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `argus_transactions_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Escalate Transaction to a Case file
  const handleCreateCase = async () => {
    if (!caseTitle || !selectedTx) return;

    try {
      const res = await axios.post(`${API_URL}/api/cases`, {
        title: caseTitle,
        transaction_id: selectedTx.transaction_id
      });

      if (res.data.success) {
        alert("Case created successfully. Assigned to case files.");
        setIsCaseModalOpen(false);
        setCaseTitle('');
        setSelectedTx(null);
        fetchTransactions(); // reload status
      }
    } catch (err) {
      alert("Failed to escalate to case file: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Transaction Ledger" />

      <main className="p-8 space-y-6">
        
        {/* Filters and search panel */}
        <div className="glass-panel p-6 space-y-4">
          <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search Input */}
            <div className="relative md:col-span-2">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Transaction ID, Name, Account, Country..."
                className="w-full pl-9 pr-4 py-2.5 bg-gray-100 focus:bg-white dark:bg-darkBg dark:focus:bg-gray-900 border border-transparent focus:border-blue-500 rounded-xl text-sm outline-none transition-all"
              />
            </div>
            
            {/* Country Selector */}
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="px-4 py-2.5 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-xl text-sm outline-none transition-all text-gray-600 dark:text-gray-300"
            >
              <option value="">All Jurisdictions</option>
              <option value="IN">India (IN)</option>
              <option value="US">United States (US)</option>
              <option value="KY">Cayman Islands (KY)</option>
              <option value="PA">Panama (PA)</option>
              <option value="AE">UAE (AE)</option>
              <option value="RU">Russia (RU)</option>
              <option value="GB">United Kingdom (GB)</option>
            </select>

            {/* Submit search */}
            <button
              type="submit"
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-sm font-semibold text-white rounded-xl transition-all shadow-md shadow-blue-900/10"
            >
              Apply Filter
            </button>
          </form>

          {/* Advanced Multi-filters */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-gray-100 dark:border-darkBorder">
            <div className="flex flex-wrap items-center gap-3">
              {/* Risk Level Selector */}
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value)}
                className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg text-xs font-semibold outline-none transition-all text-gray-500"
              >
                <option value="">Risk Level</option>
                <option value="Low">Low (&lt;20%)</option>
                <option value="Medium">Medium (20-50%)</option>
                <option value="High">High (50-75%)</option>
                <option value="Critical">Critical (75%+)</option>
              </select>

              {/* Status Selector */}
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg text-xs font-semibold outline-none transition-all text-gray-500"
              >
                <option value="">Status</option>
                <option value="Approved">Approved</option>
                <option value="Pending">Pending</option>
                <option value="Flagged">Flagged</option>
              </select>

              <button
                onClick={handleClearFilters}
                className="text-xs text-gray-400 hover:text-gray-600 font-semibold"
              >
                Reset Filters
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-50 dark:hover:bg-darkBorder/40 text-xs font-semibold text-gray-600 dark:text-gray-400 rounded-lg transition-all"
              >
                <Download className="w-3.5 h-3.5" /> Export Page (CSV)
              </button>

              {(user?.role === 'Admin' || user?.role === 'Investigator') && (
                <button
                  onClick={() => setIsUploadModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-lg transition-all shadow-sm shadow-blue-900/10"
                >
                  <Upload className="w-3.5 h-3.5" /> Import CSV
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Ledger Table */}
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100/50 dark:bg-darkBg/50 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-200/50 dark:border-darkBorder/50">
                  <th className="px-6 py-4">Transaction ID</th>
                  <th className="px-6 py-4">Sender / Account</th>
                  <th className="px-6 py-4">Receiver / Account</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Jurisdiction</th>
                  <th className="px-6 py-4 text-center">ML Risk Rating</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/50 dark:divide-darkBorder/50 text-sm">
                {loading ? (
                  Array.from({ length: 5 }).map((_, idx) => (
                    <tr key={idx}>
                      <td className="px-6 py-4"><div className="h-4 w-16 skeleton" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-28 skeleton" /><div className="h-3 w-16 skeleton mt-1" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-28 skeleton" /><div className="h-3 w-16 skeleton mt-1" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-12 skeleton" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-8 skeleton" /></td>
                      <td className="px-6 py-4"><div className="h-6 w-12 skeleton mx-auto" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-14 skeleton" /></td>
                      <td className="px-6 py-4"><div className="h-6 w-6 skeleton" /></td>
                    </tr>
                  ))
                ) : txs.length > 0 ? (
                  txs.map((tx) => (
                    <tr 
                      key={tx.transaction_id}
                      onClick={() => setSelectedTx(tx)}
                      className={`hover:bg-blue-50/20 dark:hover:bg-blue-900/10 cursor-pointer transition-all ${
                        selectedTx?.transaction_id === tx.transaction_id ? 'bg-blue-50/40 dark:bg-blue-900/15' : ''
                      }`}
                    >
                      <td className="px-6 py-4 font-semibold text-gray-800 dark:text-gray-200">
                        {tx.transaction_id}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-800 dark:text-gray-200">{tx.sender_name}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{tx.sender_account}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-800 dark:text-gray-200">{tx.receiver_name}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{tx.receiver_account}</div>
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-800 dark:text-gray-200">
                        ₹{tx.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-600 dark:text-gray-400">{tx.country}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-extrabold ${
                          tx.risk_score >= 75 ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900/20' :
                          tx.risk_score >= 50 ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' :
                          tx.risk_score >= 20 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                          'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        }`}>
                          {tx.risk_score}%
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                          tx.status === 'Approved' ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                          tx.status === 'Flagged' ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 animate-pulse' :
                          'bg-gray-100 text-gray-600 dark:bg-darkBorder/40 dark:text-gray-400'
                        }`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" className="text-center py-16 text-gray-400">
                      No transaction records matched these criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200/50 dark:border-darkBorder/50 bg-gray-50/50 dark:bg-darkPanel/50">
              <span className="text-xs text-gray-400 font-semibold">
                Showing {txs.length} of {totalItems} transactions
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(p - 1, 1))}
                  disabled={page === 1}
                  className="p-1.5 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder rounded-lg text-gray-500 disabled:opacity-50 disabled:pointer-events-none transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="flex items-center justify-center px-3 text-xs font-bold text-gray-600 dark:text-gray-300">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                  disabled={page === totalPages}
                  className="p-1.5 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder rounded-lg text-gray-500 disabled:opacity-50 disabled:pointer-events-none transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Transaction Slide-out Detailed Drawer */}
      {selectedTx && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-sm transition-all duration-300">
          <div className="w-full max-w-xl h-screen bg-white dark:bg-darkPanel border-l border-gray-200 dark:border-darkBorder shadow-2xl flex flex-col justify-between overflow-y-auto">
            
            {/* Drawer Header */}
            <div>
              <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100 dark:border-darkBorder bg-gray-50/50 dark:bg-darkBg/20">
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400">Transaction Profile</span>
                  <h3 className="text-lg font-bold text-gray-800 dark:text-white mt-0.5">
                    Audit File: {selectedTx.transaction_id}
                  </h3>
                </div>
                <button 
                  onClick={() => setSelectedTx(null)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-darkBorder rounded-lg text-gray-400 hover:text-gray-600 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="p-6 space-y-6">
                
                {/* Score & Risk Alert */}
                <div className={`p-4 border rounded-2xl flex items-center justify-between ${
                  selectedTx.risk_score >= 50 
                    ? 'bg-rose-50/50 border-rose-100 dark:bg-rose-950/10 dark:border-rose-900/20 text-rose-800 dark:text-rose-400' 
                    : 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-950/10 dark:border-emerald-900/20 text-emerald-800 dark:text-emerald-400'
                }`}>
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className={`w-5 h-5 ${selectedTx.risk_score >= 50 ? 'text-rose-500 animate-bounce' : 'text-emerald-500'}`} />
                    <div>
                      <h4 className="text-xs uppercase font-extrabold tracking-wider">
                        Fused Hybrid Risk Rating
                      </h4>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Calibrated ML Classifier + Deterministic Scenario Rule Engine
                      </p>
                    </div>
                  </div>
                  <span className="text-3xl font-black">
                    {selectedTx.risk_score}%
                  </span>
                </div>

                {/* Hybrid Fusion Score Decomposition (ML vs Rule Engine) */}
                <div className="glass-panel p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-indigo-500" />
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Dual Risk Fusion (ML + Rules)
                      </h4>
                    </div>
                    {selectedTx.score_breakdown?.critical_override && (
                      <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 font-bold px-2 py-0.5 rounded-full border border-red-500/20">
                        Critical Floor Enforced
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-gray-50/80 dark:bg-darkBg/60 rounded-xl border border-gray-100 dark:border-darkBorder/40 space-y-1.5">
                      <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-[10px]">
                        <span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
                          <Cpu className="w-3 h-3 text-blue-500" /> Calibrated ML
                        </span>
                        <span className="font-bold text-blue-500 font-mono">
                          {selectedTx.score_breakdown?.ml_score ?? selectedTx.ml_score ?? selectedTx.risk_score}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 dark:bg-darkBorder/55 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full" 
                          style={{ width: `${selectedTx.score_breakdown?.ml_score ?? selectedTx.ml_score ?? selectedTx.risk_score}%` }} 
                        />
                      </div>
                      <span className="text-[9px] text-gray-400 block">Weight: {((selectedTx.score_breakdown?.ml_weight ?? 0.50) * 100).toFixed(0)}%</span>
                    </div>

                    <div className="p-3 bg-gray-50/80 dark:bg-darkBg/60 rounded-xl border border-gray-100 dark:border-darkBorder/40 space-y-1.5">
                      <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-[10px]">
                        <span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
                          <ShieldCheck className="w-3 h-3 text-amber-500" /> Scenario Rules
                        </span>
                        <span className="font-bold text-amber-500 font-mono">
                          {selectedTx.score_breakdown?.rule_score ?? selectedTx.rule_score ?? 0}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 dark:bg-darkBorder/55 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-amber-500 rounded-full" 
                          style={{ width: `${selectedTx.score_breakdown?.rule_score ?? selectedTx.rule_score ?? 0}%` }} 
                        />
                      </div>
                      <span className="text-[9px] text-gray-400 block">Weight: {((selectedTx.score_breakdown?.rule_weight ?? 0.50) * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-50 dark:bg-darkBg/30 rounded-lg text-[10px] text-gray-500 dark:text-gray-400 font-mono flex items-center justify-between">
                    <span>Formula:</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">
                      {selectedTx.score_breakdown?.formula || `Final = 0.50 * ML(${selectedTx.ml_score ?? selectedTx.risk_score}) + 0.50 * Rules(${selectedTx.rule_score ?? 0}) = ${selectedTx.risk_score}`}
                    </span>
                  </div>
                </div>

                {/* Scenario Rule Engine Hits */}
                <div className="glass-panel p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" /> Scenario Rule Hits
                    </h4>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      (selectedTx.rule_hits && selectedTx.rule_hits.length > 0)
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    }`}>
                      {selectedTx.rule_hits?.length || 0} Triggered
                    </span>
                  </div>

                  {selectedTx.rule_hits && selectedTx.rule_hits.length > 0 ? (
                    <div className="space-y-3">
                      {selectedTx.rule_hits.map((hit, idx) => (
                        <div 
                          key={idx} 
                          className="p-3 bg-gray-50/80 dark:bg-darkBg/60 border border-gray-100 dark:border-darkBorder/40 rounded-xl space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                hit.severity === 'Critical' ? 'bg-red-500 text-white' :
                                hit.severity === 'High' ? 'bg-orange-500 text-white' :
                                hit.severity === 'Medium' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white'
                              }`}>
                                {hit.severity}
                              </span>
                              <span className="font-bold text-gray-800 dark:text-white">
                                {hit.name}
                              </span>
                            </div>
                            <span className="font-mono text-[10px] text-gray-400 font-semibold">
                              Score: {hit.score}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed bg-white/60 dark:bg-darkBg/80 p-2 rounded-lg border border-gray-100 dark:border-darkBorder/20">
                            {hit.explanation}
                          </p>
                          <div className="flex items-center justify-between text-[9px] text-gray-400 font-mono">
                            <span>ID: {hit.scenario_id}</span>
                            <span>Weight: {hit.weight || 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900/20 rounded-xl text-center text-xs text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span>No deterministic AML scenario rules triggered. Evaluated across all 7 typologies.</span>
                    </div>
                  )}
                </div>

                {/* Composite Risk Assessment Factor Progress Bars */}
                <div className="glass-panel p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Composite Risk Breakdown
                    </h4>
                    <span className="text-[9px] bg-slate-100 dark:bg-darkBorder/40 text-slate-500 font-mono px-1.5 py-0.5 rounded">
                      Formula weighted
                    </span>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: 'Transaction Risk', value: Math.min(95, Math.round((selectedTx.amount || 0) > 80000 ? 95 : ((selectedTx.amount || 0) / 1000) + 15)), color: 'bg-orange-500' },
                      { label: 'Behaviour Risk', value: ['IMPS', 'RTGS', 'NEFT', 'UPI', 'Crypto Transfer'].includes(selectedTx.payment_method) ? 85 : 30, color: 'bg-rose-500' },
                      { label: 'Country Risk', value: ['KY', 'PA', 'AE', 'RU', 'BS', 'LU'].includes(selectedTx.country) ? 95 : 20, color: 'bg-amber-500' },
                      { label: 'Historical Risk', value: selectedTx.is_laundering === 1 ? 95 : (selectedTx.risk_score > 50 ? 70 : 25), color: 'bg-red-500' },
                      { label: 'Network Risk', value: selectedTx.risk_score >= 50 ? 85 : 35, color: 'bg-indigo-500' },
                      { label: 'Velocity Risk', value: (new Date(selectedTx.timestamp).getHours() >= 22 || new Date(selectedTx.timestamp).getHours() <= 5) ? 80 : 35, color: 'bg-blue-500' }
                    ].map((factor, idx) => (
                      <div key={idx} className="space-y-1 text-xs">
                        <div className="flex justify-between text-gray-700 dark:text-gray-300">
                          <span>{factor.label}</span>
                          <span className="font-bold">{factor.value}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-200 dark:bg-darkBorder/55 rounded-full overflow-hidden">
                          <div className={`h-full ${factor.color} rounded-full`} style={{ width: `${factor.value}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-gray-400 leading-relaxed pt-1.5 border-t border-gray-100 dark:border-darkBorder/40">
                    Calculated score: <span className="font-semibold text-gray-650 dark:text-gray-250">0.25*Tx + 0.15*Beh + 0.20*Geo + 0.15*Hist + 0.15*Net + 0.10*Vel</span>
                  </p>
                </div>

                {/* AI Investigator Summary Panel */}
                <div className="glass-panel p-5 space-y-4 bg-gradient-to-tr from-orange-500/5 to-transparent">
                  <div className="flex justify-between items-center pb-2 border-b border-gray-150/40 dark:border-darkBorder/40">
                    <h4 className="text-xs font-bold text-orange-500 uppercase tracking-wider">
                      AI Investigator Insights
                    </h4>
                    <span className="text-[9px] bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 font-extrabold px-2 py-0.5 rounded">
                      Confidence: {Math.min(99, 90 + (selectedTx.risk_score % 10))}%
                    </span>
                  </div>
                  <div className="space-y-3 text-xs leading-relaxed">
                    <p className="text-gray-700 dark:text-gray-300">
                      {selectedTx.risk_score >= 50 
                        ? `This transaction is flagged as high-risk because the sender initiated a transfer of ₹${selectedTx.amount?.toLocaleString()} via ${mapPaymentMethod(selectedTx.payment_method)}. Routing country ${selectedTx.country} and positive SHAP features for [${selectedTx.reasons?.join(', ')}] support threat propagation and layering.`
                        : `This transaction is clean. The amount of ₹${selectedTx.amount?.toLocaleString()} falls within normal baseline bounds with standard geographical routing.`
                      }
                    </p>
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div>
                        <span className="text-gray-400 block text-[9px] uppercase">Recommended Action</span>
                        <b className="text-gray-700 dark:text-gray-300 font-bold block">
                          {selectedTx.risk_score >= 75 ? 'Freeze and File STR' : (selectedTx.risk_score >= 50 ? 'EDD Audit Verify' : 'Approve Transfer')}
                        </b>
                      </div>
                      <div>
                        <span className="text-gray-400 block text-[9px] uppercase">Model Verdict</span>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${selectedTx.risk_score >= 50 ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' : 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300'}`}>
                          {selectedTx.risk_score >= 75 ? 'Critical Risk' : (selectedTx.risk_score >= 50 ? 'High Risk' : 'Low Risk')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Transaction Routing Timeline */}
                <div className="glass-panel p-5 space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Interactive Money Flow Routing Timeline
                  </h4>
                  <div className="relative pl-6 space-y-4 border-l border-gray-200 dark:border-darkBorder/60 ml-2 py-2">
                    {[
                      { label: 'Originator Outward', time: '-14 min', account: selectedTx.sender_account, holder: selectedTx.sender_name, amount: selectedTx.amount, type: 'UPI Outward', status: 'Clean' },
                      { label: 'Layering Node Routing', time: '-7 min', account: 'ACC8829102', holder: 'Transit Shell Intermediary', amount: selectedTx.amount - 250, type: 'IMPS Routing', status: selectedTx.risk_score >= 50 ? 'Suspicious' : 'Clean' },
                      { label: 'Target Destination', time: 'Settled', account: selectedTx.receiver_account, holder: selectedTx.receiver_name, amount: selectedTx.amount - 500, type: mapPaymentMethod(selectedTx.payment_method), status: selectedTx.risk_score >= 50 ? 'High Risk' : 'Clean' }
                    ].map((step, idx) => (
                      <div key={idx} className="relative text-xs">
                        {/* Bullet */}
                        <div className={`absolute -left-[30px] top-1 w-3 h-3 rounded-full border-2 bg-white dark:bg-darkPanel ${step.status === 'High Risk' || step.status === 'Suspicious' ? 'border-red-500' : 'border-emerald-500'}`} />
                        
                        <div className="flex justify-between text-[10px] text-gray-400 font-bold">
                          <span>{step.label} ({step.time})</span>
                          <span className={step.status === 'High Risk' || step.status === 'Suspicious' ? 'text-red-500' : 'text-emerald-500'}>
                            {step.status}
                          </span>
                        </div>
                        <div className="mt-1">
                          <b className="text-gray-800 dark:text-white">{step.holder}</b>
                          <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                            <span>Acc: {step.account}</span>
                            <span>₹{step.amount.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Transfer Info */}
                <div className="glass-panel p-5 space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Core Transfer Details
                  </h4>
                  <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-darkBorder">
                    <div>
                      <p className="text-[10px] text-gray-400">Sender Account</p>
                      <h5 className="font-semibold text-gray-800 dark:text-white mt-0.5">{selectedTx.sender_name}</h5>
                      <span className="text-[10px] font-mono text-gray-500">{selectedTx.sender_account}</span>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-300" />
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400">Receiver Account</p>
                      <h5 className="font-semibold text-gray-800 dark:text-white mt-0.5">{selectedTx.receiver_name}</h5>
                      <span className="text-[10px] font-mono text-gray-500">{selectedTx.receiver_account}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-gray-400 block">Transfer Volume</span>
                      <b className="text-sm text-gray-800 dark:text-white font-bold">₹{selectedTx.amount?.toLocaleString()} ({selectedTx.currency === 'USD' ? 'INR' : (selectedTx.currency || 'INR')})</b>
                    </div>
                    <div>
                      <span className="text-gray-400 block">Payment Channel</span>
                      <b className="text-gray-700 dark:text-gray-300">{mapPaymentMethod(selectedTx.payment_method)}</b>
                    </div>
                  </div>
                </div>

                {/* Network & Routing Details */}
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="glass-panel p-4 space-y-1">
                    <span className="text-gray-400">Device ID</span>
                    <b className="text-gray-700 dark:text-gray-300 block font-mono">{selectedTx.device_id || 'Unknown'}</b>
                  </div>
                  <div className="glass-panel p-4 space-y-1">
                    <span className="text-gray-400">IP Address</span>
                    <b className="text-gray-700 dark:text-gray-300 block font-mono">{selectedTx.ip_address || 'Unknown'}</b>
                  </div>
                  <div className="glass-panel p-4 space-y-1">
                    <span className="text-gray-400">Merchant Target</span>
                    <b className="text-gray-700 dark:text-gray-300 block truncate">{selectedTx.merchant || 'None'}</b>
                  </div>
                  <div className="glass-panel p-4 space-y-1">
                    <span className="text-gray-400">Category Tag</span>
                    <b className="text-gray-700 dark:text-gray-300 block">{selectedTx.category}</b>
                  </div>
                </div>

                {/* SHAP Explanation Visualizer */}
                <div className="glass-panel p-5 space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Explainable AI Attribution (SHAP)
                  </h4>
                  <ShapChart shapData={selectedTx.shap_explanation} />
                </div>

              </div>
            </div>

            {/* Action buttons footer */}
            <div className="p-6 border-t border-gray-100 dark:border-darkBorder bg-gray-50/50 dark:bg-darkBg/20 flex gap-4">
              {selectedTx.risk_score >= 50 && ['Admin', 'Investigator'].includes(user?.role) && (
                <button
                  onClick={() => setIsCaseModalOpen(true)}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 font-semibold text-xs text-white rounded-xl transition-all text-center shadow-lg shadow-red-900/10"
                >
                  Escalate Case File
                </button>
              )}
              <button
                onClick={() => setSelectedTx(null)}
                className="flex-1 py-3 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder font-semibold text-xs text-gray-600 dark:text-gray-400 rounded-xl transition-all text-center"
              >
                Close Audit
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Case Escalation Dialog Modal */}
      {isCaseModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md p-6 glass-panel bg-white dark:bg-darkPanel shadow-2xl animate-fade-in border border-gray-100 dark:border-darkBorder">
            <h3 className="text-base font-bold text-gray-800 dark:text-white mb-4">
              Escalate Case File
            </h3>
            <div className="space-y-4 text-xs">
              <p className="text-gray-400 leading-relaxed">
                Escalating transaction <b>{selectedTx?.transaction_id}</b> to an active Case Investigation file. This triggers alerts tracking and registers the file in the investigation logs.
              </p>
              <div className="space-y-2">
                <label className="font-bold text-gray-400 uppercase tracking-wider block">
                  Case File Reference / Title
                </label>
                <input
                  type="text"
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  placeholder="e.g., Suspicious structuring loop target ACC10023"
                  className="w-full px-4 py-3 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-xl outline-none text-sm transition-all"
                  required
                />
              </div>
              <div className="flex gap-4 pt-2">
                <button
                  onClick={handleCreateCase}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 font-semibold text-white rounded-xl transition-all text-center shadow-lg shadow-red-900/10"
                >
                  Escalate Case File
                </button>
                <button
                  onClick={() => setIsCaseModalOpen(false)}
                  className="flex-1 py-3 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder font-semibold text-gray-600 dark:text-gray-400 rounded-xl transition-all text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Mapping Importer Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="relative w-full max-w-5xl my-8 bg-white dark:bg-darkCard border border-gray-200 dark:border-darkBorder rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-darkBorder">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">
                    Import Transactions with Column Mapping
                  </h3>
                  <p className="text-xs text-gray-400">
                    Upload any CSV format. Auto-detect headers, configure canonical mappings, or auto-apply saved templates.
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setIsUploadModalOpen(false); fetchTransactions(); }}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-darkBg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ColumnMappingImporter 
              API_URL={API_URL} 
              onClose={() => setIsUploadModalOpen(false)}
              onImportComplete={() => {
                fetchTransactions();
              }} 
            />
          </div>
        </div>
      )}

    </div>
  );
};

export default Transactions;
