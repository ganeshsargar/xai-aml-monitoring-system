import React, { useState, useEffect, useContext, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import { 
  AlertOctagon, 
  Check, 
  X, 
  ArrowRight, 
  PlusCircle, 
  Eye, 
  AlertTriangle, 
  Clock, 
  ShieldAlert, 
  UserCheck, 
  Users, 
  Filter, 
  ArrowUpDown, 
  CheckSquare, 
  Square, 
  Layers, 
  Briefcase, 
  FileText, 
  Search,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  BrainCircuit
} from 'lucide-react';
import ScreeningPanel from '../components/ScreeningPanel';
import ShapChart from '../components/ShapChart';


const Alerts = () => {
  const { API_URL, user } = useContext(AuthContext);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'suggested'

  // Filters & Queue Sorting
  const [statusFilter, setStatusFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('priority_score');
  const [sortDir, setSortDir] = useState('desc');

  // Selected Alert Details & Drawer
  const [selectedAlert, setSelectedAlert] = useState(null);

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Bulk Assign Modal
  const [isBulkAssignModal, setIsBulkAssignModal] = useState(false);
  const [assigneeInput, setAssigneeInput] = useState('');
  const [usersList, setUsersList] = useState([]);

  // Disposition Modal (Single & Bulk)
  const [isDispositionModal, setIsDispositionModal] = useState(false);
  const [dispositionCode, setDispositionCode] = useState('False Positive');
  const [dispositionRationale, setDispositionRationale] = useState('');
  const [isBulkDismiss, setIsBulkDismiss] = useState(false);
  const [isFourEyesApproval, setIsFourEyesApproval] = useState(false);

  // Escalate to Case Modal
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [caseTitle, setCaseTitle] = useState('');

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      if (activeTab === 'suggested') {
        const res = await axios.get(`${API_URL}/api/alerts/active-learning?limit=50`);
        if (res.data.success) {
          setAlerts(res.data.data);
          if (selectedAlert) {
            const refreshed = res.data.data.find(a => a.alert_id === selectedAlert.alert_id);
            if (refreshed) setSelectedAlert(refreshed);
          }
        }
      } else {
        const params = { 
          limit: 200,
          sortBy,
          sortDir
        };
        if (statusFilter) params.status = statusFilter;
        if (levelFilter) params.level = levelFilter;
        if (overdueFilter) params.overdue = 'true';
        if (searchQuery) params.search = searchQuery;

        const res = await axios.get(`${API_URL}/api/alerts`, { params });
        if (res.data.success) {
          setAlerts(res.data.data);
          if (selectedAlert) {
            const refreshed = res.data.data.find(a => a.alert_id === selectedAlert.alert_id);
            if (refreshed) setSelectedAlert(refreshed);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching alerts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [activeTab, statusFilter, levelFilter, overdueFilter, sortBy, sortDir]);

  // Load investigators list for assignment
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/admin/users`);
        if (res.data.success) {
          setUsersList(res.data.data || []);
        }
      } catch (e) {
        // Non-admin roles might not have access to admin users endpoint
      }
    };
    fetchUsers();
  }, [API_URL]);

  const handleToggleSelectAll = () => {
    if (selectedIds.size === alerts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(alerts.map(a => a.alert_id)));
    }
  };

  const handleToggleSelect = (id, e) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSingleDispositionSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAlert || !dispositionRationale.trim()) {
      alert("A substantive rationale is required.");
      return;
    }

    try {
      const action = isFourEyesApproval ? 'approve' : 'close';
      const res = await axios.post(`${API_URL}/api/alerts/${selectedAlert.alert_id}/disposition`, {
        disposition_code: dispositionCode,
        rationale: dispositionRationale,
        action
      });

      if (res.data.success) {
        alert(res.data.message);
        setIsDispositionModal(false);
        setDispositionRationale('');
        setIsFourEyesApproval(false);
        fetchAlerts();
      }
    } catch (err) {
      alert("Disposition failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleBulkDismissSubmit = async (e) => {
    e.preventDefault();
    if (selectedIds.size === 0 || !dispositionRationale.trim()) {
      alert("Please enter a dismissal rationale.");
      return;
    }

    try {
      const res = await axios.post(`${API_URL}/api/alerts/bulk-dismiss`, {
        alert_ids: Array.from(selectedIds),
        disposition_code: dispositionCode,
        rationale: dispositionRationale
      });

      if (res.data.success) {
        alert(res.data.message);
        setIsDispositionModal(false);
        setIsBulkDismiss(false);
        setSelectedIds(new Set());
        setDispositionRationale('');
        fetchAlerts();
      }
    } catch (err) {
      alert("Bulk dismissal failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleBulkAssignSubmit = async (e) => {
    e.preventDefault();
    if (selectedIds.size === 0 || !assigneeInput) {
      alert("Please select an investigator.");
      return;
    }

    try {
      const res = await axios.post(`${API_URL}/api/alerts/bulk-assign`, {
        alert_ids: Array.from(selectedIds),
        assignee: assigneeInput
      });

      if (res.data.success) {
        alert(res.data.message);
        setIsBulkAssignModal(false);
        setSelectedIds(new Set());
        fetchAlerts();
      }
    } catch (err) {
      alert("Bulk assignment failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleEscalateToCase = async (e) => {
    e.preventDefault();
    if (!caseTitle || !selectedAlert) return;
    try {
      const res = await axios.post(`${API_URL}/api/cases`, {
        title: caseTitle,
        alerts: [selectedAlert.alert_id]
      });

      if (res.data.success) {
        alert(`Case ${res.data.data.case_id} created successfully.`);
        setIsCaseModalOpen(false);
        setCaseTitle('');
        fetchAlerts();
      }
    } catch (err) {
      alert("Failed to escalate: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Compliance Alert Queue & Workflow" />

      <main className="p-8 space-y-6">
        
        {/* Bulk Actions Banner (appears when items selected) */}
        {selectedIds.size > 0 && (
          <div className="p-4 rounded-xl bg-blue-600 text-white shadow-lg flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <CheckSquare className="w-5 h-5 text-blue-200" />
              <span className="text-sm font-bold">
                {selectedIds.size} alert(s) selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsBulkAssignModal(true)}
                className="px-3 py-1.5 bg-white text-blue-700 hover:bg-blue-50 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
              >
                <Users className="w-3.5 h-3.5" /> Assign Selected
              </button>
              <button
                onClick={() => {
                  setIsBulkDismiss(true);
                  setDispositionCode('False Positive');
                  setIsDispositionModal(true);
                }}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> Bulk Dismiss
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-2.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-blue-200 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Active Learning & View Navigation Tabs */}
        <div className="flex items-center gap-3 border-b border-gray-200 dark:border-darkBorder pb-3">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'all'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-darkBorder/40'
            }`}
          >
            <Layers className="w-4 h-4" />
            All Alerts Queue
          </button>
          
          <button
            onClick={() => setActiveTab('suggested')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all relative ${
              activeTab === 'suggested'
                ? 'bg-gradient-to-r from-amber-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-darkBorder/40'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
            Suggested for Review (Active Learning)
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-white font-mono">
              Uncertainty Queue
            </span>
          </button>
        </div>

        {/* Filter & Sorting Toolbar */}
        <div className="glass-panel p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search alert, entity, tx..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchAlerts()}
                  className="pl-8 pr-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-xs w-48 text-gray-700 dark:text-gray-200"
                />
              </div>

              {/* Status Option */}
              <div className="space-y-0.5">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-gray-700 dark:text-gray-300 text-xs cursor-pointer"
                >
                  <option value="">All Statuses</option>
                  <option value="New">New</option>
                  <option value="In Review L1">In Review L1</option>
                  <option value="Escalated L2">Escalated L2</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>

              {/* Severity Level */}
              <div className="space-y-0.5">
                <select
                  value={levelFilter}
                  onChange={(e) => setLevelFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-gray-700 dark:text-gray-300 text-xs cursor-pointer"
                >
                  <option value="">All Severities</option>
                  <option value="Critical">Critical (80%+)</option>
                  <option value="High">High (60-79%)</option>
                  <option value="Medium">Medium (35-59%)</option>
                  <option value="Low">Low (&lt;35%)</option>
                </select>
              </div>

              {/* Overdue Filter Button */}
              <button
                onClick={() => setOverdueFilter(!overdueFilter)}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  overdueFilter 
                    ? 'bg-red-600 text-white shadow-md shadow-red-900/20' 
                    : 'bg-gray-100 dark:bg-darkBg text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Overdue Only
              </button>
            </div>

            {/* Sorting Controls */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 uppercase text-[10px] tracking-wider font-bold">Sort Queue:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-2.5 py-1.5 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer"
              >
                <option value="priority_score">Priority Score</option>
                <option value="due_at">SLA Deadline (Urgent First)</option>
                <option value="risk_score">Risk Score</option>
                <option value="createdAt">Creation Date</option>
                <option value="aging">Aging Time</option>
              </select>
              <button
                onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
                title="Toggle sort direction"
                className="p-1.5 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder rounded-lg text-gray-500"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  setStatusFilter('');
                  setLevelFilter('');
                  setOverdueFilter(false);
                  setSearchQuery('');
                  setSortBy('priority_score');
                  setSortDir('desc');
                }}
                className="px-3 py-1.5 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder rounded-lg text-xs font-semibold text-gray-500 ml-2"
              >
                Reset
              </button>
            </div>

          </div>
        </div>

        {/* Main Grid: Queue on Left, Auditor Drawer on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Alerts Stream List (Col-span-2) */}
          <div className="glass-panel p-6 lg:col-span-2 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleToggleSelectAll}
                  className="text-gray-400 hover:text-blue-500 transition-colors"
                >
                  {selectedIds.size === alerts.length && alerts.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-blue-500" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Compliance Alert Queue ({alerts.length} Parent Alerts)
                </h4>
              </div>
              <span className="text-[10px] text-gray-400">
                Entity Aggregation: 24h Window
              </span>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-darkBorder">
              {loading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <div key={idx} className="py-4 flex justify-between items-center">
                    <div className="space-y-2">
                      <div className="h-4 w-36 skeleton" />
                      <div className="h-3 w-64 skeleton" />
                    </div>
                    <div className="h-7 w-20 skeleton" />
                  </div>
                ))
              ) : alerts.length > 0 ? (
                alerts.map((alert) => {
                  const isSelected = selectedIds.has(alert.alert_id);
                  const isActiveSelected = selectedAlert?.alert_id === alert.alert_id;
                  const isOverdue = alert.is_overdue;

                  return (
                    <div 
                      key={alert.alert_id} 
                      onClick={() => setSelectedAlert(alert)}
                      className={`flex justify-between items-center py-3.5 cursor-pointer px-3.5 rounded-xl transition-all ${
                        isActiveSelected 
                          ? 'bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 shadow-sm' 
                          : 'hover:bg-gray-50 dark:hover:bg-darkBorder/20 border border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={(e) => handleToggleSelect(alert.alert_id, e)}
                          className="mt-1 text-gray-400 hover:text-blue-500"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-500" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>

                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <AlertOctagon className={`w-4 h-4 ${
                              alert.level === 'Critical' ? 'text-red-500 animate-pulse' :
                              alert.level === 'High' ? 'text-orange-500' :
                              alert.level === 'Medium' ? 'text-amber-500' : 'text-emerald-500'
                            }`} />
                            
                            <span className="font-bold text-xs text-gray-800 dark:text-gray-200 font-mono">
                              {alert.alert_id}
                            </span>

                            {/* Priority Badge */}
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                              P-{alert.priority_score || 50}
                            </span>

                            {/* Level Badge */}
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              alert.level === 'Critical' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                              alert.level === 'High' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' :
                              alert.level === 'Medium' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                              'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            }`}>
                              {alert.level}
                            </span>

                            {/* Multi-transaction Aggregation Badge */}
                            {alert.transaction_count > 1 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                                <Layers className="w-3 h-3" /> {alert.transaction_count} txs
                              </span>
                            )}

                            {/* SLA Overdue or Countdown Badge */}
                            {isOverdue ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold bg-red-600 text-white animate-pulse shadow-sm">
                                <AlertTriangle className="w-3 h-3" /> OVERDUE ({Math.abs(alert.hours_until_due)}h)
                              </span>
                            ) : alert.status !== 'Closed' && alert.hours_until_due != null && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-darkBorder/40 text-gray-600 dark:text-gray-300">
                                <Clock className="w-3 h-3" /> Due in {alert.hours_until_due}h
                              </span>
                            )}

                            {/* Active Learning Uncertainty Chip */}
                            {alert.uncertainty_score != null && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300/40">
                                <BrainCircuit className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                Model Uncertainty: {(alert.uncertainty_score * 100).toFixed(0)}% (±{alert.distance_to_threshold?.toFixed(1)} pts to boundary)
                              </span>
                            )}
                          </div>
                          
                          {/* Entity & Volume Summary */}
                          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
                            <span>
                              Entity: <b className="text-gray-700 dark:text-gray-200">{alert.entity_name || alert.entity_id}</b> ({alert.entity_type || 'Account'})
                            </span>
                            <span>•</span>
                            <span>
                              Total Vol: <b className="text-gray-800 dark:text-gray-200">₹{(alert.total_volume || alert.transaction?.amount || 0).toLocaleString()}</b>
                            </span>
                            <span>•</span>
                            <span>
                              Assignee: <b className="text-blue-600 dark:text-blue-400">{alert.assignee || 'Unassigned'}</b>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Status pill & view icon */}
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          alert.status === 'New' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' :
                          alert.status === 'In Review L1' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' :
                          alert.status === 'Escalated L2' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' :
                          'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        }`}>
                          {alert.status}
                        </span>
                        <Eye className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-16 text-gray-400 text-xs">
                  No compliance alerts match the current queue criteria.
                </div>
              )}
            </div>
          </div>

          {/* Alert Auditor Panel (Col-span-1) */}
          <div className="lg:col-span-1 space-y-6">
            <div className="glass-panel p-6 space-y-5">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder flex items-center justify-between">
                <span>Alert Investigation Auditor</span>
                {selectedAlert && (
                  <span className="text-[10px] font-mono font-bold text-blue-500">
                    {selectedAlert.alert_id}
                  </span>
                )}
              </h4>

              {selectedAlert ? (
                <div className="space-y-5 text-xs">
                  
                  {/* Priority & Threat Card */}
                  <div className="p-3.5 bg-gray-50 dark:bg-darkBg/60 border border-gray-200/60 dark:border-darkBorder/40 rounded-xl space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-gray-400 uppercase font-bold">Threat & Priority</span>
                      <span className="font-mono text-purple-600 dark:text-purple-400 font-extrabold text-xs">
                        Priority Score: {selectedAlert.priority_score || 50}/100
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${
                        selectedAlert.level === 'Critical' ? 'text-red-500' :
                        selectedAlert.level === 'High' ? 'text-orange-500' :
                        selectedAlert.level === 'Medium' ? 'text-amber-500' : 'text-emerald-500'
                      }`}>
                        {selectedAlert.level} Level ({selectedAlert.risk_score}% Risk)
                      </span>
                      <span className="text-[10px] text-gray-500">
                        Status: <b>{selectedAlert.status}</b>
                      </span>
                    </div>
                    {selectedAlert.due_at && (
                      <div className="text-[10px] text-gray-500 flex items-center justify-between pt-1 border-t border-gray-200/40 dark:border-darkBorder/30">
                        <span>SLA Due Date:</span>
                        <b className={selectedAlert.is_overdue ? 'text-red-500 font-bold' : 'text-gray-700 dark:text-gray-300'}>
                          {new Date(selectedAlert.due_at).toLocaleString()}
                        </b>
                      </div>
                    )}
                  </div>

                  {/* Aggregated Entity Details */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Aggregated Entity</span>
                    <div className="p-3 bg-gray-50 dark:bg-darkBg/40 border border-gray-100 dark:border-darkBorder rounded-xl space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Entity ID:</span>
                        <b className="font-mono text-gray-800 dark:text-gray-200">{selectedAlert.entity_id}</b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Name:</span>
                        <b className="text-gray-800 dark:text-gray-200">{selectedAlert.entity_name || 'Account Holder'}</b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Child Transactions:</span>
                        <b className="text-blue-600 dark:text-blue-400">{selectedAlert.transaction_count || 1} aggregated</b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Total Volume:</span>
                        <b className="text-gray-800 dark:text-gray-200">₹{(selectedAlert.total_volume || 0).toLocaleString()}</b>
                      </div>
                    </div>
                  </div>

                  {/* Four-Eyes Proposal Alert if Pending Approval */}
                  {selectedAlert.proposed_by && selectedAlert.status !== 'Closed' && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1 text-[11px]">
                      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-bold">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Four-Eyes Approval Pending
                      </div>
                      <p className="text-gray-600 dark:text-gray-300">
                        Proposed Disposition: <b>{selectedAlert.proposed_disposition}</b> by <b>{selectedAlert.proposed_by}</b>
                      </p>
                      {selectedAlert.proposed_rationale && (
                        <p className="text-gray-500 italic">"{selectedAlert.proposed_rationale}"</p>
                      )}
                    </div>
                  )}

                  {/* Closed Disposition Record if Closed */}
                  {selectedAlert.status === 'Closed' && selectedAlert.disposition_code && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-1 text-[11px]">
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Closed Disposition: {selectedAlert.disposition_code}
                      </div>
                      <p className="text-gray-600 dark:text-gray-300">
                        Closed by <b>{selectedAlert.closed_by || 'Investigator'}</b> on {selectedAlert.closed_at ? new Date(selectedAlert.closed_at).toLocaleString() : ''}
                      </p>
                      {selectedAlert.closure_reason && (
                        <p className="text-gray-500">Rationale: {selectedAlert.closure_reason}</p>
                      )}
                    </div>
                  )}

                  {/* Child Transactions List */}
                  {selectedAlert.child_transactions && selectedAlert.child_transactions.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[10px] text-gray-400 uppercase font-bold block">
                        Child Transactions ({selectedAlert.child_transactions.length})
                      </span>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {selectedAlert.child_transactions.map((tx, idx) => (
                          <div key={idx} className="p-2 bg-gray-50 dark:bg-darkBg/60 border border-gray-100 dark:border-darkBorder rounded-lg flex justify-between items-center text-[10px]">
                            <div>
                              <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{tx.transaction_id}</span>
                              <span className="text-gray-400 block">{tx.category || 'Transfer'} • {tx.country || 'IN'}</span>
                            </div>
                            <div className="text-right">
                              <b className="text-gray-800 dark:text-gray-200 font-mono">₹{tx.amount?.toLocaleString()}</b>
                              <span className="text-orange-500 block font-bold">{tx.risk_score}% Risk</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Explainable AI Attribution & Counterfactuals */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Explainable AI (XAI) & Attributions</span>
                    <div className="p-3.5 bg-gray-50 dark:bg-darkBg/60 border border-gray-100 dark:border-darkBorder rounded-xl">
                      <ShapChart
                        shapData={selectedAlert.transaction?.shap_explanation || selectedAlert.shap_explanation}
                        explanationType={selectedAlert.transaction?.explanation_type || (selectedAlert.transaction?.shap_explanation ? 'shap' : 'rule-based')}
                        groupedAttributions={selectedAlert.transaction?.grouped_attributions || []}
                        reasons={selectedAlert.reasons || selectedAlert.transaction?.reasons || []}
                        whyAlertSummary={selectedAlert.why_alert_summary || selectedAlert.transaction?.why_alert_summary}
                        transaction={selectedAlert.transaction || { 
                          transaction_id: selectedAlert.transaction_id || selectedAlert.entity_id, 
                          risk_score: selectedAlert.risk_score, 
                          amount: selectedAlert.total_volume,
                          country: selectedAlert.country || 'IN',
                          payment_method: selectedAlert.payment_method || 'Transfer'
                        }}
                        API_URL={API_URL}
                      />
                    </div>
                  </div>

                  {/* Watchlist & Name Screening */}
                  <ScreeningPanel
                    API_URL={API_URL}
                    entityType="Transaction"
                    entityId={selectedAlert.transaction?.transaction_id || selectedAlert.transaction_id}
                    names={[
                      { label: 'Sender', name: selectedAlert.transaction?.sender_name || selectedAlert.entity_name },
                      { label: 'Receiver', name: selectedAlert.transaction?.receiver_name }
                    ]}
                    initialHits={selectedAlert.transaction?.screening_hits || []}
                    onDecisionRecorded={fetchAlerts}
                  />


                  {/* Investigation Actions */}
                  <div className="pt-3 border-t border-gray-100 dark:border-darkBorder space-y-2">
                    <span className="text-[10px] text-gray-400 uppercase font-bold block">Workflow Actions</span>

                    {/* Four-Eyes Secondary Approval Button (if pending approval from a different user) */}
                    {selectedAlert.proposed_by && selectedAlert.proposed_by !== user?.username && selectedAlert.status !== 'Closed' && (
                      <button
                        onClick={() => {
                          setIsFourEyesApproval(true);
                          setDispositionCode(selectedAlert.proposed_disposition || 'True Positive - STR Filed');
                          setDispositionRationale(`Confirmed and approved Four-Eyes disposition: ${selectedAlert.proposed_rationale || ''}`);
                          setIsDispositionModal(true);
                        }}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-900/10"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Four-Eyes Approve Disposition
                      </button>
                    )}

                    {/* Escalate to Case */}
                    <button
                      onClick={() => {
                        setCaseTitle(`Investigation: ${selectedAlert.entity_name || selectedAlert.entity_id} (${selectedAlert.level} Alert)`);
                        setIsCaseModalOpen(true);
                      }}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-blue-900/10"
                    >
                      <Briefcase className="w-3.5 h-3.5" /> Escalate to Case File
                    </button>

                    {/* Close / Disposition Alert Button */}
                    {selectedAlert.status !== 'Closed' && (
                      <button
                        onClick={() => {
                          setIsBulkDismiss(false);
                          setIsFourEyesApproval(false);
                          setDispositionCode('False Positive');
                          setDispositionRationale('');
                          setIsDispositionModal(true);
                        }}
                        className="w-full py-2 bg-gray-100 hover:bg-gray-200 dark:bg-darkBorder/60 dark:hover:bg-darkBorder text-gray-700 dark:text-gray-200 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" /> Close / Disposition Alert
                      </button>
                    )}
                  </div>

                </div>
              ) : (
                <div className="text-center py-20 text-gray-400 text-xs italic">
                  Select an alert from the queue on the left to examine entity risk, child transactions, and audit workflow actions.
                </div>
              )}
            </div>
          </div>

        </div>

      </main>

      {/* Disposition Modal (Single / Bulk / Four-Eyes) */}
      {isDispositionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-blue-500" />
                {isBulkDismiss ? 'Bulk Dismiss Alerts' : (isFourEyesApproval ? 'Four-Eyes Secondary Approval' : 'Alert Disposition Closure')}
              </h4>
              <button 
                onClick={() => setIsDispositionModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={isBulkDismiss ? handleBulkDismissSubmit : handleSingleDispositionSubmit} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Disposition Code
                </label>
                <select
                  value={dispositionCode}
                  onChange={(e) => setDispositionCode(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none font-semibold text-gray-700 dark:text-gray-200"
                >
                  <option value="False Positive">False Positive</option>
                  <option value="True Positive - STR Filed">True Positive - STR Filed (Requires Four-Eyes)</option>
                  <option value="True Positive - No Filing">True Positive - No Filing (Requires Four-Eyes)</option>
                  <option value="Insufficient Information">Insufficient Information</option>
                </select>
              </div>

              {dispositionCode.startsWith('True Positive') && !isFourEyesApproval && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-300">
                  <p className="font-bold">Four-Eyes Regulatory Requirement:</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    True Positive & STR dispositions require proposal by the primary investigator followed by verification and approval by a secondary compliance officer.
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Investigation Rationale / Case Notes (Mandatory)
                </label>
                <textarea
                  rows={3}
                  value={dispositionRationale}
                  onChange={(e) => setDispositionRationale(e.target.value)}
                  placeholder="Detail the investigative evidence, customer profile verification, and decision basis..."
                  required
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none text-xs text-gray-700 dark:text-gray-200 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDispositionModal(false)}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-md shadow-blue-900/10"
                >
                  {isFourEyesApproval ? 'Confirm Approval' : (dispositionCode.startsWith('True Positive') ? 'Submit Proposal' : 'Confirm Disposition')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Assign Modal */}
      {isBulkAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-sm w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-500" />
                Assign {selectedIds.size} Alerts
              </h4>
              <button 
                onClick={() => setIsBulkAssignModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBulkAssignSubmit} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Select Investigator
                </label>
                <input
                  type="text"
                  value={assigneeInput}
                  onChange={(e) => setAssigneeInput(e.target.value)}
                  placeholder="Enter username (e.g. investigator, lead_analyst)"
                  required
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none text-xs text-gray-700 dark:text-gray-200"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBulkAssignModal(false)}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-md shadow-blue-900/10"
                >
                  Assign Alerts
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Escalate to Case Modal */}
      {isCaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-blue-500" />
                Escalate Alert to Investigation Case
              </h4>
              <button 
                onClick={() => setIsCaseModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEscalateToCase} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Case Investigation Title
                </label>
                <input
                  type="text"
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  placeholder="e.g. Multi-Account Structuring Cluster - Customer 01"
                  required
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none text-xs text-gray-700 dark:text-gray-200"
                />
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-blue-800 dark:text-blue-300 text-[11px] space-y-0.5">
                <p className="font-bold">Linking Alert {selectedAlert?.alert_id}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Creates an investigative case file with multi-hop Cytoscape network mapping, PDF report compiling, and timeline chronology.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCaseModalOpen(false)}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-md shadow-blue-900/10"
                >
                  Create Case File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Alerts;
