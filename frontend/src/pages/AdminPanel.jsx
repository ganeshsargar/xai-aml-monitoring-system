import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import { 
  UserPlus, 
  Trash2, 
  History, 
  Settings, 
  Upload, 
  Play, 
  TrendingUp, 
  Database,
  ShieldAlert,
  Download
} from 'lucide-react';

const AdminPanel = () => {
  const { API_URL, ML_SERVICE_URL, user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('model'); // Tabs: model, users, audit, settings
  
  // Model training and dataset states
  const [systemStats, setSystemStats] = useState(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [csvLoading, setCsvLoading] = useState(false);

  // User management states
  const [usersList, setUsersList] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Investigator');
  const [usersLoading, setUsersLoading] = useState(false);

  // Audit log states
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchSystemStats = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/system-stats`);
      if (res.data.success) {
        setSystemStats(res.data.data);
      }
    } catch (err) {
      console.error("Error loading system stats:", err);
    }
  };

  const fetchUsers = async () => {
    if (user.role !== 'Admin') return;
    try {
      setUsersLoading(true);
      const res = await axios.get(`${API_URL}/api/admin/users`);
      if (res.data.success) {
        setUsersList(res.data.data);
      }
    } catch (err) {
      console.error("Error loading users:", err);
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      setAuditLoading(true);
      const res = await axios.get(`${API_URL}/api/admin/audit-logs`);
      if (res.data.success) {
        setAuditLogs(res.data.data);
      }
    } catch (err) {
      console.error("Error loading audit logs:", err);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemStats();
    if (user.role === 'Admin') fetchUsers();
    fetchAuditLogs();
  }, [API_URL, user]);

  const handleTrainModels = async () => {
    try {
      setTrainingLoading(true);
      const res = await axios.post(`${ML_SERVICE_URL}/train`); // POST to python service
      if (res.data.success) {
        alert(`Training Completed! Selected Best Classifier: ${res.data.metrics.best_model}`);
        fetchSystemStats();
      }
    } catch (err) {
      alert("Flask training failed, using rules-engine fallback: " + err.message);
    } finally {
      setTrainingLoading(false);
    }
  };

  const handleCsvImport = async (e) => {
    e.preventDefault();
    if (!csvFile) return;

    const formData = new FormData();
    formData.append('file', csvFile);

    try {
      setCsvLoading(true);
      const res = await axios.post(`${API_URL}/api/transactions/import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        alert(res.data.message);
        setCsvFile(null);
        document.getElementById('csv-upload').value = '';
        fetchSystemStats();
      }
    } catch (err) {
      alert("Failed to upload dataset: " + (err.response?.data?.error || err.message));
    } finally {
      setCsvLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUsername || !newPassword || !newName) return;

    try {
      const res = await axios.post(`${API_URL}/api/auth/register`, {
        username: newUsername,
        password: newPassword,
        name: newName,
        role: newRole
      });

      if (res.data.success) {
        alert(`Account for ${newUsername} created successfully.`);
        setNewUsername('');
        setNewPassword('');
        setNewName('');
        setNewRole('Investigator');
        fetchUsers();
      }
    } catch (err) {
      alert("Failed to create user: " + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteUser = async (username) => {
    if (username === 'admin') {
      alert("Cannot delete primary administrator.");
      return;
    }
    if (!window.confirm(`Are you sure you want to delete user ${username}?`)) return;

    try {
      const res = await axios.delete(`${API_URL}/api/admin/users/${username}`);
      if (res.data.success) {
        alert("User account removed successfully.");
        fetchUsers();
      }
    } catch (err) {
      alert("Failed to delete user: " + (err.response?.data?.error || err.message));
    }
  };

  const handleExportAuditLogs = () => {
    if (auditLogs.length === 0) return;
    const headers = ['Timestamp', 'Username', 'Role', 'Action', 'IP Address', 'Details'];
    const rows = auditLogs.map(l => [l.timestamp, l.username, l.role, l.action, l.ip_address, l.details]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(','))].join('\n');
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `aml_audit_logs_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Audit & System Console" />

      {/* Model Training Fullscreen Overlay Loader */}
      {trainingLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75 backdrop-blur-md transition-all duration-300">
          <div className="bg-white dark:bg-darkPanel border border-gray-200 dark:border-darkBorder rounded-3xl p-8 max-w-md text-center space-y-6 shadow-2xl animate-fade-in mx-4">
            <div className="relative flex items-center justify-center mx-auto">
              {/* Spinning Ring */}
              <div className="w-16 h-16 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
              <TrendingUp className="w-6 h-6 text-blue-500 absolute animate-pulse" />
            </div>
            <div className="space-y-2">
              <h4 className="text-lg font-bold text-gray-800 dark:text-white">Comparative ML Trainer Active</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Engineering custom transaction features, building graph centrality metrics, and training multiple classifiers (Decision Tree, Random Forest, XGBoost). This benchmarks the models and auto-deploys the champion with the highest F1-Score.
              </p>
              <div className="inline-block mt-3 px-3 py-1 bg-amber-500/10 text-amber-500 rounded-full text-[10px] font-bold">
                Please wait... Processing typically takes 20-30 seconds
              </div>
            </div>
            <div className="h-1.5 w-full bg-gray-100 dark:bg-darkBg rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 animate-pulse rounded-full w-full" />
            </div>
          </div>
        </div>
      )}

      <main className="p-8 space-y-6">
        
        {/* Navigation Tabs */}
        <div className="flex gap-4 border-b border-gray-200 dark:border-darkBorder pb-px">
          <button
            onClick={() => setActiveTab('model')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'model' 
                ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            ML Models & Datasets
          </button>
          
          {user.role === 'Admin' && (
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
                activeTab === 'users' 
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              User Management
            </button>
          )}

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'audit' 
                ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            System Audit Trail
          </button>
        </div>

        {/* Tab contents */}
        {activeTab === 'model' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            
            {/* Left: Model comparison table */}
            <div className="glass-panel p-6 lg:col-span-2 space-y-6">
              <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                  Model Comparer & Benchmarks
                </h4>
                <button
                  onClick={handleTrainModels}
                  disabled={trainingLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-xs font-semibold text-white rounded-xl transition-all shadow-md shadow-blue-900/10"
                >
                  <Play className="w-3.5 h-3.5" /> 
                  {trainingLoading ? 'Re-training Models...' : 'Run Comparative Trainer'}
                </button>
              </div>

              {systemStats?.ml_model?.comparison ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100/50 dark:bg-darkBg/50 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-200/50 dark:border-darkBorder/50">
                        <th className="px-4 py-3">Classifier Model</th>
                        <th className="px-4 py-3">Accuracy</th>
                        <th className="px-4 py-3">Precision</th>
                        <th className="px-4 py-3">Recall</th>
                        <th className="px-4 py-3">F1 Score</th>
                        <th className="px-4 py-3">ROC AUC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/50 dark:divide-darkBorder/50 font-medium text-gray-700 dark:text-gray-300">
                      {Object.keys(systemStats.ml_model.comparison).map((name) => {
                        const m = systemStats.ml_model.comparison[name];
                        const isBest = systemStats.ml_model.best_model === name;
                        return (
                          <tr key={name} className={isBest ? 'bg-blue-50/20 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 font-bold' : ''}>
                            <td className="px-4 py-3.5 flex items-center gap-1.5">
                              {name} {isBest && <span className="text-[9px] uppercase bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-extrabold">Active</span>}
                            </td>
                            <td className="px-4 py-3.5 font-mono">{(m.accuracy * 100).toFixed(2)}%</td>
                            <td className="px-4 py-3.5 font-mono">{(m.precision * 100).toFixed(2)}%</td>
                            <td className="px-4 py-3.5 font-mono">{(m.recall * 100).toFixed(2)}%</td>
                            <td className="px-4 py-3.5 font-mono">{(m.f1_score * 100).toFixed(2)}%</td>
                            <td className="px-4 py-3.5 font-mono">{(m.roc_auc).toFixed(4)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-gray-400 italic mt-4">
                    * The comparative engine evaluates and automatically deploys the model with the highest F1-Score to optimize the trade-off between false-positives and missed laundering events.
                  </p>
                </div>
              ) : (
                <div className="text-center py-16 text-xs text-gray-400 border border-dashed border-gray-200 dark:border-darkBorder rounded-2xl">
                  No model statistics initialized. Click "Run Comparative Trainer" to execute the pipeline.
                </div>
              )}
            </div>

            {/* Right: Dataset Upload */}
            <div className="glass-panel p-6 space-y-6">
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder flex items-center gap-1.5">
                <Database className="w-4 h-4" /> Bulk Transaction Importer
              </h4>

              <div className="text-xs text-gray-400 leading-relaxed">
                Upload a structured transaction CSV file. Imported records will undergo automatic feature engineering, ML risk predictions, and alerts routing.
              </div>

              <form onSubmit={handleCsvImport} className="space-y-4">
                <div className="border border-dashed border-gray-200 dark:border-darkBorder rounded-2xl p-6 flex flex-col items-center justify-center space-y-2 cursor-pointer bg-gray-50 hover:bg-gray-100/50 dark:bg-darkBg/20 dark:hover:bg-darkBg/60 transition-all relative">
                  <Upload className="w-8 h-8 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {csvFile ? csvFile.name : 'Select structured AML CSV file'}
                  </span>
                  <input
                    type="file"
                    id="csv-upload"
                    accept=".csv"
                    onChange={(e) => setCsvFile(e.target.files[0])}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={csvLoading || !csvFile}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-xs font-semibold text-white rounded-xl shadow-lg shadow-blue-900/10 transition-all outline-none"
                >
                  {csvLoading ? 'Parsing and Predicting...' : 'Execute Import & Predict'}
                </button>
              </form>
            </div>

          </div>
        )}

        {activeTab === 'users' && user.role === 'Admin' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            
            {/* Left: Add user form */}
            <div className="glass-panel p-6 space-y-5">
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" /> Register Staff Account
              </h4>

              <form onSubmit={handleCreateUser} className="space-y-4 text-xs font-semibold">
                <div className="space-y-1.5">
                  <label className="text-gray-400 uppercase text-[10px]">Full Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., John Investigator"
                    className="w-full px-3 py-2.5 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-white text-xs transition-all"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-gray-400 uppercase text-[10px]">Username</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g., investigator_01"
                    className="w-full px-3 py-2.5 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-white text-xs transition-all"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-gray-400 uppercase text-[10px]">Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-white text-xs transition-all"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-gray-400 uppercase text-[10px]">Assigned Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full px-3 py-2.5 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg outline-none text-gray-500 text-xs transition-all"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Investigator">AML Investigator</option>
                    <option value="Auditor">Compliance Auditor</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-xl shadow-lg shadow-blue-900/10 transition-all outline-none"
                >
                  Register Profile
                </button>
              </form>
            </div>

            {/* Right: Staff list */}
            <div className="glass-panel p-6 lg:col-span-2 space-y-4">
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder">
                Staff Registry Accounts
              </h4>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-100/50 dark:bg-darkBg/50 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-200/50 dark:border-darkBorder/50">
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Registered Date</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/50 dark:divide-darkBorder/50 font-medium text-gray-700 dark:text-gray-300">
                    {usersLoading ? (
                      Array.from({ length: 3 }).map((_, idx) => (
                        <tr key={idx}><td colSpan="4" className="px-4 py-3 skeleton h-10" /></tr>
                      ))
                    ) : usersList.length > 0 ? (
                      usersList.map((u) => (
                        <tr key={u.username} className="hover:bg-gray-50 dark:hover:bg-darkBg/40">
                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-gray-800 dark:text-gray-200">{u.name}</div>
                            <div className="text-[10px] text-gray-400">@{u.username}</div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              {u.role}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-3.5 text-right">
                            {u.username !== 'admin' && (
                              <button
                                onClick={() => handleDeleteUser(u.username)}
                                className="p-1 hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 hover:text-red-600 rounded transition-all"
                                title="Delete account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="4" className="text-center py-8 text-gray-400">No registered users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {activeTab === 'audit' && (
          <div className="glass-panel p-6 space-y-4 animate-fade-in">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <History className="w-4 h-4" /> System Audit Logs
              </h4>
              
              <button
                onClick={handleExportAuditLogs}
                disabled={auditLogs.length === 0}
                className="flex items-center gap-1 px-3 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-50 dark:hover:bg-darkBorder/40 text-xs font-semibold text-gray-600 dark:text-gray-400 rounded-lg transition-all"
              >
                <Download className="w-3.5 h-3.5" /> Export Audit Log (CSV)
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-100/50 dark:bg-darkBg/50 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-200/50 dark:border-darkBorder/50">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Audited Operator</th>
                    <th className="px-4 py-3">Action Type</th>
                    <th className="px-4 py-3">IP Address</th>
                    <th className="px-4 py-3">Details Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/50 dark:divide-darkBorder/50 font-medium text-gray-600 dark:text-gray-400">
                  {auditLoading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <tr key={idx}><td colSpan="5" className="px-4 py-3 skeleton h-10 animate-pulse" /></tr>
                    ))
                  ) : auditLogs.length > 0 ? (
                    auditLogs.map((log, idx) => (
                      <tr key={idx} className="hover:bg-gray-100/20 dark:hover:bg-darkBg/10">
                        <td className="px-4 py-3 font-mono text-[10px] text-gray-400">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-gray-800 dark:text-gray-300 block">{log.username}</span>
                          <span className="text-[9px] text-gray-400 font-semibold">{log.role}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            log.action.includes('FAILED') ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400' :
                            log.action.includes('SUCCESS') || log.action.includes('REGISTERED') ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' :
                            'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400'
                          }`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-400">{log.ip_address}</td>
                        <td className="px-4 py-3 text-gray-800 dark:text-gray-300">{log.details}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan="5" className="text-center py-12 text-gray-400">No actions recorded in audit logs yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
};

export default AdminPanel;
