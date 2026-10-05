import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import {
  Sliders,
  Play,
  Check,
  X,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Layers,
  Activity,
  FileText,
  RefreshCw,
  Edit2,
  Plus,
  Trash2,
  HelpCircle,
  TrendingUp,
  Percent,
  ChevronRight,
  Database
} from 'lucide-react';

const ScenarioManager = () => {
  const { API_URL } = useContext(AuthContext);
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Edit Modal State
  const [editingScenario, setEditingScenario] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // Backtest Modal State
  const [backtestScenario, setBacktestScenario] = useState(null);
  const [backtestParams, setBacktestParams] = useState({});
  const [backtestLimit, setBacktestLimit] = useState(5000);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestResult, setBacktestResult] = useState(null);

  const fetchScenarios = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API_URL}/api/scenarios`);
      if (res.data.success) {
        setScenarios(res.data.data);
      }
    } catch (err) {
      console.error('Error fetching scenarios:', err);
      setError('Failed to load AML detection scenarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScenarios();
  }, [API_URL]);

  const handleToggleEnabled = async (scenario) => {
    try {
      const res = await axios.put(`${API_URL}/api/scenarios/${scenario.scenario_id}`, {
        enabled: !scenario.enabled
      });
      if (res.data.success) {
        fetchScenarios();
      }
    } catch (err) {
      alert('Failed to update scenario state: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleOpenEdit = (scenario) => {
    setEditingScenario(scenario);
    setEditForm({
      name: scenario.name,
      description: scenario.description,
      category: scenario.category,
      severity: scenario.severity,
      weight: scenario.weight,
      enabled: scenario.enabled,
      parameters: { ...(scenario.parameters || {}) },
      explanation_template: scenario.explanation_template
    });
  };

  const handleSaveEdit = async () => {
    if (!editingScenario || !editForm) return;
    try {
      setSaving(true);
      const res = await axios.put(`${API_URL}/api/scenarios/${editingScenario.scenario_id}`, editForm);
      if (res.data.success) {
        alert('Scenario updated successfully.');
        setEditingScenario(null);
        setEditForm(null);
        fetchScenarios();
      }
    } catch (err) {
      alert('Failed to save scenario: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenBacktest = (scenario) => {
    setBacktestScenario(scenario);
    setBacktestParams({ ...(scenario.parameters || {}) });
    setBacktestResult(null);
  };

  const handleRunBacktest = async () => {
    if (!backtestScenario) return;
    try {
      setBacktestLoading(true);
      const res = await axios.post(`${API_URL}/api/scenarios/${backtestScenario.scenario_id}/backtest`, {
        parameters: backtestParams,
        limit: backtestLimit
      });
      if (res.data.success) {
        setBacktestResult(res.data.data);
      }
    } catch (err) {
      alert('Back-test execution failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleApplyBacktestParams = async () => {
    if (!backtestScenario || !backtestParams) return;
    try {
      const res = await axios.put(`${API_URL}/api/scenarios/${backtestScenario.scenario_id}`, {
        parameters: backtestParams
      });
      if (res.data.success) {
        alert('Tuned parameters saved to active scenario.');
        setBacktestScenario(null);
        setBacktestResult(null);
        fetchScenarios();
      }
    } catch (err) {
      alert('Failed to apply parameters: ' + (err.response?.data?.error || err.message));
    }
  };

  const getSeverityBadge = (sev) => {
    const s = (sev || '').toUpperCase();
    if (s === 'CRITICAL') return 'bg-rose-500/15 text-rose-500 border-rose-500/30';
    if (s === 'HIGH') return 'bg-orange-500/15 text-orange-500 border-orange-500/30';
    if (s === 'MEDIUM' || s === 'MED') return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
    return 'bg-blue-500/15 text-blue-500 border-blue-500/30';
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="glass-panel p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-500 dark:bg-blue-500/20">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-800 dark:text-white uppercase tracking-wider">
                Configurable AML Scenario & Rule Engine
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Deterministic compliance typologies fused with ML calibrated probabilities (50/50 weighted fusion)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchScenarios}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-darkBg dark:hover:bg-darkBorder rounded-xl transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Rules
          </button>
        </div>
      </div>

      {/* Scenarios Table */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-darkBorder">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" />
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-300">
              Active AML Detection Scenarios ({scenarios.length})
            </h4>
          </div>
          <span className="text-[11px] text-gray-400">
            Rules trigger deterministically on ingestion and combine with ML
          </span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-xs text-gray-400">Loading compliance scenarios...</div>
        ) : error ? (
          <div className="text-center py-12 text-xs text-rose-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/50 dark:bg-darkBg/50 text-[10px] uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Scenario Name & ID</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Severity</th>
                  <th className="py-3 px-3">Rule Weight</th>
                  <th className="py-3 px-3">Key Parameters</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-darkBorder font-medium">
                {scenarios.map((scen) => (
                  <tr key={scen.scenario_id} className="hover:bg-gray-50/50 dark:hover:bg-darkBg/30 transition-colors">
                    {/* Status Toggle */}
                    <td className="py-3 px-3">
                      <button
                        onClick={() => handleToggleEnabled(scen)}
                        className={`w-9 h-5 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                          scen.enabled ? 'bg-blue-600 justify-end' : 'bg-gray-300 dark:bg-gray-700 justify-start'
                        }`}
                        title={scen.enabled ? 'Enabled - Click to disable' : 'Disabled - Click to enable'}
                      >
                        <div className="w-3.5 h-3.5 rounded-full bg-white shadow-md transform transition-transform" />
                      </button>
                    </td>

                    {/* Name & ID */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-gray-800 dark:text-gray-200">
                        {scen.name}
                      </div>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5">
                        {scen.scenario_id}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-1 max-w-sm">
                        {scen.description}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 dark:bg-darkBg text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-darkBorder">
                        {scen.category}
                      </span>
                    </td>

                    {/* Severity */}
                    <td className="py-3 px-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${getSeverityBadge(scen.severity)}`}>
                        {scen.severity}
                      </span>
                    </td>

                    {/* Weight */}
                    <td className="py-3 px-3">
                      <span className="font-black text-gray-800 dark:text-gray-200">
                        +{scen.weight || 25} pts
                      </span>
                    </td>

                    {/* Parameters Preview */}
                    <td className="py-3 px-3 font-mono text-[10px] text-gray-500 max-w-xs truncate">
                      {scen.parameters ? JSON.stringify(scen.parameters) : '{}'}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenBacktest(scen)}
                          className="px-2.5 py-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40 rounded-lg border border-purple-200/40 dark:border-purple-800/30 flex items-center gap-1 transition-all"
                        >
                          <Play className="w-3 h-3" /> Back-Test
                        </button>
                        <button
                          onClick={() => handleOpenEdit(scen)}
                          className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-darkBorder rounded-lg transition-colors"
                          title="Configure Parameters"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Scenario Parameters Modal */}
      {editingScenario && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-2xl p-6 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-3">
              <div>
                <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider">
                  Configure Scenario: {editingScenario.name}
                </h3>
                <span className="text-[10px] font-mono text-gray-400">{editingScenario.scenario_id}</span>
              </div>
              <button
                onClick={() => setEditingScenario(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Severity & Weight */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">
                    Severity Level
                  </label>
                  <select
                    value={editForm.severity}
                    onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-darkBg rounded-xl border border-transparent focus:border-blue-500 font-semibold"
                  >
                    <option value="Critical">Critical (Immediate Escalation)</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">
                    Rule Score Weight (0-50 pts)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={editForm.weight}
                    onChange={(e) => setEditForm({ ...editForm, weight: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-darkBg rounded-xl border border-transparent focus:border-blue-500 font-mono font-bold"
                  />
                </div>
              </div>

              {/* Dynamic Parameters Inputs */}
              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400 block mb-2">
                  Detection Parameters
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-gray-50/70 dark:bg-darkBg/50 rounded-xl border border-gray-150 dark:border-darkBorder">
                  {Object.entries(editForm.parameters).map(([key, val]) => (
                    <div key={key}>
                      <span className="text-[10px] font-mono text-gray-400 block mb-0.5">{key}</span>
                      <input
                        type={typeof val === 'number' ? 'number' : 'text'}
                        value={Array.isArray(val) ? val.join(', ') : val}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parsed = typeof val === 'number' ? Number(raw) : (Array.isArray(val) ? raw.split(',').map(s => s.trim()) : raw);
                          setEditForm({
                            ...editForm,
                            parameters: { ...editForm.parameters, [key]: parsed }
                          });
                        }}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-darkPanel rounded-lg border border-gray-200 dark:border-darkBorder text-xs font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Explanation Template */}
              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">
                  Explanation Template (Placeholders: {'{account_id}'}, {'{amount}'}, {'{window_days}'}, etc.)
                </label>
                <textarea
                  rows="3"
                  value={editForm.explanation_template}
                  onChange={(e) => setEditForm({ ...editForm, explanation_template: e.target.value })}
                  className="w-full p-3 bg-gray-100 dark:bg-darkBg rounded-xl border border-transparent focus:border-blue-500 text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-darkBorder">
              <button
                onClick={() => setEditingScenario(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-100 dark:hover:bg-darkBorder rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-500/20 disabled:opacity-50"
              >
                {saving ? 'Saving Changes...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back-Testing & Parameter Tuning Modal */}
      {backtestScenario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-3xl p-6 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-500">
                  <Play className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider">
                    Historical Back-Testing & Threshold Calibration
                  </h3>
                  <span className="text-xs text-gray-400">
                    Scenario: <strong className="text-gray-800 dark:text-gray-200">{backtestScenario.name}</strong>
                  </span>
                </div>
              </div>
              <button
                onClick={() => setBacktestScenario(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Candidate Parameter Controls */}
            <div className="p-4 bg-gray-50/70 dark:bg-darkBg/50 rounded-xl border border-gray-150 dark:border-darkBorder space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-gray-400">
                  Adjust Candidate Parameters to Test
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  Sample: {backtestLimit} rows
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Object.entries(backtestParams).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-[10px] font-mono text-gray-500 block mb-0.5">{k}</span>
                    <input
                      type={typeof v === 'number' ? 'number' : 'text'}
                      value={Array.isArray(v) ? v.join(', ') : v}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const parsed = typeof v === 'number' ? Number(raw) : (Array.isArray(v) ? raw.split(',').map(s => s.trim()) : raw);
                        setBacktestParams({ ...backtestParams, [k]: parsed });
                      }}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-darkPanel rounded-lg border border-gray-200 dark:border-darkBorder text-xs font-mono"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleRunBacktest}
                  disabled={backtestLoading}
                  className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-md shadow-purple-500/20 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {backtestLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Evaluating Historical Data...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      Run Back-Test Simulation
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Back-test Results Display */}
            {backtestResult && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-gray-50/50 dark:bg-darkBg/40 border border-gray-200/50 dark:border-darkBorder">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Evaluated Set</span>
                    <span className="text-base font-black text-gray-800 dark:text-gray-200">
                      {backtestResult.total_evaluated?.toLocaleString()} txs
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/40 dark:border-purple-900/30">
                    <span className="text-[10px] uppercase font-bold text-purple-500 block">Total Rule Hits</span>
                    <span className="text-base font-black text-purple-600 dark:text-purple-400">
                      {backtestResult.hit_count} hits ({backtestResult.hit_rate}%)
                    </span>
                  </div>

                  {backtestResult.metrics ? (
                    <>
                      <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/40 dark:border-emerald-900/30">
                        <span className="text-[10px] uppercase font-bold text-emerald-500 block">Precision</span>
                        <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                          {(backtestResult.metrics.precision * 100).toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-gray-400 block">
                          TP: {backtestResult.metrics.true_positives} | FP: {backtestResult.metrics.false_positives}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/40 dark:border-blue-900/30">
                        <span className="text-[10px] uppercase font-bold text-blue-500 block">Recall & F1</span>
                        <span className="text-base font-black text-blue-600 dark:text-blue-400">
                          {(backtestResult.metrics.recall * 100).toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-gray-400 block">
                          F1: {backtestResult.metrics.f1_score}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 p-3 rounded-xl bg-gray-50 dark:bg-darkBg text-gray-400 flex items-center">
                      Historical transactions contain no ground-truth labels for precision/recall.
                    </div>
                  )}
                </div>

                {/* Sample Hits Preview */}
                {backtestResult.sample_hits?.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">
                      Sample Rule Hits ({backtestResult.sample_hits.length} previewed)
                    </span>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                      {backtestResult.sample_hits.map((sh, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-gray-50 dark:bg-darkBg/60 border border-gray-150 dark:border-darkBorder flex items-center justify-between"
                        >
                          <div>
                            <span className="font-bold text-gray-800 dark:text-gray-200">
                              {sh.transaction_id}
                            </span>
                            <span className="text-gray-400 ml-2">
                              ₹{Number(sh.amount || 0).toLocaleString('en-IN')} • {sh.sender_account} → {sh.receiver_account}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              sh.is_laundering === 1 ? 'bg-rose-500/15 text-rose-500' : 'bg-gray-100 dark:bg-darkBg text-gray-500'
                            }`}
                          >
                            Label: {sh.is_laundering === 1 ? 'True Fraud' : 'Normal'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action to Apply Tuned Parameters */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-darkBorder">
                  <span className="text-xs text-gray-400">
                    Satisfied with candidate precision and recall?
                  </span>
                  <button
                    onClick={handleApplyBacktestParams}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md shadow-emerald-500/20 flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Apply Tuned Parameters to Live Scenario
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ScenarioManager;
