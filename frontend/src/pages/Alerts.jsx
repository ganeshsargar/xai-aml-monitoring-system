import React, { useState, useEffect, useContext } from 'react';
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
  Play
} from 'lucide-react';

const Alerts = () => {
  const { API_URL, user } = useContext(AuthContext);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  // Selected Alert details
  const [selectedAlert, setSelectedAlert] = useState(null);

  // Case creation dialog
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [caseTitle, setCaseTitle] = useState('');

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const params = { limit: 200 };
      if (statusFilter) params.status = statusFilter;
      if (levelFilter) params.level = levelFilter;

      const res = await axios.get(`${API_URL}/api/alerts`, { params });
      if (res.data.success) {
        setAlerts(res.data.data);
      }
    } catch (err) {
      console.error("Error fetching alerts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [statusFilter, levelFilter]);

  const handleUpdateStatus = async (alertId, newStatus) => {
    try {
      const res = await axios.put(`${API_URL}/api/alerts/${alertId}`, { status: newStatus });
      if (res.data.success) {
        alert(`Alert status updated to ${newStatus}`);
        setSelectedAlert(null);
        fetchAlerts();
      }
    } catch (err) {
      alert("Failed to update alert: " + (err.response?.data?.error || err.message));
    }
  };

  const handleEscalateToCase = async () => {
    if (!caseTitle || !selectedAlert) return;
    try {
      // 1. Create case with the selected alert
      const res = await axios.post(`${API_URL}/api/cases`, {
        title: caseTitle,
        alerts: [selectedAlert.alert_id]
      });

      if (res.data.success) {
        alert(`Case created successfully. Alert escalated.`);
        // 2. Set alert status to Escalated
        await axios.put(`${API_URL}/api/alerts/${selectedAlert.alert_id}`, { status: 'Escalated' });
        
        setIsCaseModalOpen(false);
        setCaseTitle('');
        setSelectedAlert(null);
        fetchAlerts();
      }
    } catch (err) {
      alert("Failed to escalate: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Compliance Alert Queue" />

      <main className="p-8 space-y-6">
        
        {/* Filter Toolbar */}
        <div className="glass-panel p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
            {/* Status Option */}
            <div className="space-y-1">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-gray-600 dark:text-gray-300"
              >
                <option value="">All Statuses</option>
                <option value="New">New</option>
                <option value="Investigating">Investigating</option>
                <option value="Dismissed">Dismissed</option>
                <option value="Escalated">Escalated</option>
              </select>
            </div>

            {/* Level option */}
            <div className="space-y-1">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Severity Level</span>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-gray-600 dark:text-gray-300"
              >
                <option value="">All Levels</option>
                <option value="Critical">Critical (75%+)</option>
                <option value="High">High (50-75%)</option>
                <option value="Medium">Medium (20-50%)</option>
                <option value="Low">Low (&lt;20%)</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => { setStatusFilter(''); setLevelFilter(''); }}
            className="px-4 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder rounded-xl text-xs font-semibold text-gray-500"
          >
            Clear Filters
          </button>
        </div>

        {/* Alerts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Alerts Stream List (Col-span-2) */}
          <div className="glass-panel p-6 lg:col-span-2 space-y-4">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder">
              Threat Stream Log ({alerts.length} Flagged alerts)
            </h4>

            <div className="divide-y divide-gray-100 dark:divide-darkBorder">
              {loading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="py-4 flex justify-between items-center">
                    <div className="space-y-2">
                      <div className="h-4 w-28 skeleton" />
                      <div className="h-3 w-48 skeleton" />
                    </div>
                    <div className="h-7 w-16 skeleton" />
                  </div>
                ))
              ) : alerts.length > 0 ? (
                alerts.map((alert) => (
                  <div 
                    key={alert.alert_id} 
                    onClick={() => setSelectedAlert(alert)}
                    className={`flex justify-between items-center py-4 cursor-pointer hover:bg-blue-50/10 dark:hover:bg-blue-900/5 px-4 rounded-xl transition-all ${
                      selectedAlert?.alert_id === alert.alert_id ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <AlertOctagon className={`w-4 h-4 ${
                          alert.level === 'Critical' ? 'text-red-500 animate-pulse' :
                          alert.level === 'High' ? 'text-orange-500' :
                          alert.level === 'Medium' ? 'text-amber-500' : 'text-emerald-500'
                        }`} />
                        <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                          {alert.alert_id} ({alert.transaction_id})
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          alert.level === 'Critical' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                          alert.level === 'High' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' :
                          alert.level === 'Medium' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                          'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        }`}>
                          {alert.level}
                        </span>
                      </div>
                      
                      <div className="text-xs text-gray-400">
                        Risk Rating: <span className="font-bold text-gray-700 dark:text-gray-300">{alert.risk_score}%</span> | 
                        Volume: <span className="font-bold text-gray-700 dark:text-gray-300">₹{alert.transaction?.amount?.toLocaleString()}</span> | 
                        Country: <span className="font-bold text-gray-700 dark:text-gray-300">{alert.transaction?.country}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                        alert.status === 'New' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' :
                        alert.status === 'Investigating' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' :
                        alert.status === 'Escalated' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' :
                        'bg-gray-100 text-gray-800 dark:bg-darkBorder/40 dark:text-gray-400'
                      }`}>
                        {alert.status}
                      </span>
                      <Eye className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-16 text-gray-400">
                  No alerts listed in this queue.
                </div>
              )}
            </div>
          </div>

          {/* Alert Auditor Panel (Col-span-1) */}
          <div className="lg:col-span-1 space-y-6">
            <div className="glass-panel p-6 space-y-6">
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder">
                Alert Auditor
              </h4>

              {selectedAlert ? (
                <div className="space-y-6">
                  {/* Alert Core Info */}
                  <div className="space-y-3 text-xs">
                    <div>
                      <span className="text-gray-400 uppercase block text-[10px]">Alert ID</span>
                      <b className="text-sm text-gray-800 dark:text-white font-mono">{selectedAlert.alert_id}</b>
                    </div>
                    <div>
                      <span className="text-gray-400 uppercase block text-[10px]">Threat Level</span>
                      <b className={`text-sm ${
                        selectedAlert.level === 'Critical' ? 'text-red-500' :
                        selectedAlert.level === 'High' ? 'text-orange-500' :
                        selectedAlert.level === 'Medium' ? 'text-amber-500' : 'text-emerald-500'
                      }`}>{selectedAlert.level} ({selectedAlert.risk_score}% Risk)</b>
                    </div>
                    <div>
                      <span className="text-gray-400 uppercase block text-[10px]">Current Status</span>
                      <b className="text-gray-800 dark:text-white">{selectedAlert.status}</b>
                    </div>
                    <div>
                      <span className="text-gray-400 uppercase block text-[10px]">Registered On</span>
                      <b className="text-gray-700 dark:text-gray-300">{new Date(selectedAlert.createdAt).toLocaleString()}</b>
                    </div>
                  </div>

                  {/* Flow routing Details */}
                  {selectedAlert.transaction && (
                    <div className="p-4 bg-gray-50 dark:bg-darkBg/60 border border-gray-100 dark:border-darkBorder/40 rounded-xl space-y-4">
                      <h5 className="font-bold text-xs text-gray-400 uppercase">Trigger Transaction</h5>
                      <div className="flex items-center justify-between text-xs py-1.5 border-b border-gray-200/50 dark:border-darkBorder/30">
                        <div>
                          <p className="text-[10px] text-gray-400">Sender</p>
                          <span className="font-semibold text-gray-800 dark:text-white block">{selectedAlert.transaction.sender_name}</span>
                          <span className="text-[9px] font-mono text-gray-500">{selectedAlert.transaction.sender_account}</span>
                        </div>
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                        <div className="text-right">
                          <p className="text-[10px] text-gray-400">Receiver</p>
                          <span className="font-semibold text-gray-800 dark:text-white block">{selectedAlert.transaction.receiver_name}</span>
                          <span className="text-[9px] font-mono text-gray-500">{selectedAlert.transaction.receiver_account}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-gray-400 block">Amount</span>
                          <b className="text-gray-700 dark:text-gray-300 font-bold">₹{selectedAlert.transaction.amount?.toLocaleString()}</b>
                        </div>
                        <div>
                          <span className="text-gray-400 block">Category</span>
                          <b className="text-gray-700 dark:text-gray-300">{selectedAlert.transaction.category}</b>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Audit Actions (Only for Admin & Investigator) */}
                  {['Admin', 'Investigator'].includes(user?.role) && (
                    <div className="pt-4 border-t border-gray-100 dark:border-darkBorder space-y-2">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-bold">Audit Action</span>
                      
                      {selectedAlert.status === 'New' && (
                        <button
                          onClick={() => handleUpdateStatus(selectedAlert.alert_id, 'Investigating')}
                          className="flex items-center justify-center gap-1.5 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-xl transition-all outline-none"
                        >
                          <Play className="w-3.5 h-3.5" /> Start Investigation
                        </button>
                      )}

                      {['New', 'Investigating'].includes(selectedAlert.status) && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setIsCaseModalOpen(true)}
                            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-xs font-semibold text-white rounded-xl transition-all outline-none flex items-center justify-center gap-1"
                          >
                            <PlusCircle className="w-3.5 h-3.5" /> Escalate
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(selectedAlert.alert_id, 'Dismissed')}
                            className="flex-1 py-2.5 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder text-xs font-semibold text-gray-600 dark:text-gray-400 rounded-xl transition-all outline-none flex items-center justify-center gap-1"
                          >
                            <X className="w-3.5 h-3.5" /> Dismiss
                          </button>
                        </div>
                      )}

                      {selectedAlert.status === 'Dismissed' && (
                        <button
                          onClick={() => handleUpdateStatus(selectedAlert.alert_id, 'New')}
                          className="w-full py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-50 dark:hover:bg-darkBorder/40 text-xs font-semibold text-gray-600 dark:text-gray-400 rounded-xl transition-all"
                        >
                          Reopen Alert
                        </button>
                      )}

                      {selectedAlert.status === 'Escalated' && (
                        <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950/10 text-xs text-red-500 font-bold border border-red-100 dark:border-red-900/10">
                          Escalated to Active Investigation File
                        </div>
                      )}
                    </div>
                  )}

                </div>
              ) : (
                <div className="text-center py-20 text-xs text-gray-400">
                  Select an alert from the stream to audit.
                </div>
              )}
            </div>
          </div>

        </div>
      </main>

      {/* Case Escalation Dialog Modal */}
      {isCaseModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md p-6 glass-panel bg-white dark:bg-darkPanel shadow-2xl animate-fade-in border border-gray-100 dark:border-darkBorder">
            <h3 className="text-base font-bold text-gray-800 dark:text-white mb-4">
              Escalate Threat Alert
            </h3>
            <div className="space-y-4 text-xs">
              <p className="text-gray-400 leading-relaxed">
                Escalating alert <b>{selectedAlert?.alert_id}</b>. This moves the alert into an active investigation case and flags the accounts involved for tracking.
              </p>
              <div className="space-y-2">
                <label className="font-bold text-gray-400 uppercase tracking-wider block">
                  Case Name / Title
                </label>
                <input
                  type="text"
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  placeholder="e.g., Escalation on offshore transaction TX10020"
                  className="w-full px-4 py-3 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-xl outline-none text-sm transition-all text-white"
                  required
                />
              </div>
              <div className="flex gap-4 pt-2">
                <button
                  onClick={handleEscalateToCase}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 font-semibold text-white rounded-xl transition-all text-center shadow-lg shadow-red-900/10"
                >
                  Escalate Alert
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

    </div>
  );
};

export default Alerts;
