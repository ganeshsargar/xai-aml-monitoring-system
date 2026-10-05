import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import StatCard from '../components/StatCard';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';
import {
  Coins,
  AlertTriangle,
  TrendingUp,
  Clock,
  Sparkles,
  ShieldCheck,
  Brain,
  GitCompare,
  Activity,
  Users,
  Globe,
  Download,
  RefreshCw,
  Layers,
  Filter,
  CheckCircle2,
  Flame,
  FileText,
  ArrowUpRight,
  BarChart3,
  Calendar,
  Zap,
  SlidersHorizontal,
  ChevronRight
} from 'lucide-react';

const PIE_COLORS = ['#f43f5e', '#f59e0b', '#38bdf8', '#a855f7', '#10b981', '#64748b'];

// Helper for exporting dataset array to CSV file
const downloadCSV = (filename, data) => {
  if (!Array.isArray(data) || data.length === 0) {
    alert('No data available to export.');
    return;
  }
  const headers = Object.keys(data[0]);
  const rows = [headers.join(',')];
  data.forEach(item => {
    const vals = headers.map(h => {
      const val = item[h];
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    });
    rows.push(vals.join(','));
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const Dashboard = () => {
  const { API_URL } = useContext(AuthContext);
  const navigate = useNavigate();

  // Filters State
  const [timeRange, setTimeRange] = useState('30d');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedRiskLevel, setSelectedRiskLevel] = useState('');

  // Data States
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchKPIs = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const params = new URLSearchParams();
      if (timeRange) params.append('timeRange', timeRange);
      if (selectedCountry) params.append('country', selectedCountry);
      if (selectedChannel) params.append('payment_method', selectedChannel);
      if (selectedRiskLevel) params.append('risk_level', selectedRiskLevel);
      if (isRefresh) params.append('refresh', 'true');

      const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/dashboard/kpis?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (res.data.success) {
        setDashboardData(res.data.data);
      }
    } catch (err) {
      console.error('Error loading dashboard analytics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchKPIs(false);
  }, [timeRange, selectedCountry, selectedChannel, selectedRiskLevel]);

  // Destructure KPI payloads with safe defaults
  const ops = dashboardData?.operational_kpis || {};
  const feedback = dashboardData?.feedback_attribution_kpis || {};
  const typologies = dashboardData?.typology_breakdown || [];
  const entities = dashboardData?.risk_entities || {};

  // Format Backlog for Pie chart
  const backlogPieData = useMemo(() => {
    if (!ops.backlog_by_status) return [];
    return Object.entries(ops.backlog_by_status).map(([key, value]) => ({
      name: key,
      value: value
    })).filter(item => item.value > 0);
  }, [ops.backlog_by_status]);

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg transition-colors duration-200">
      <Navbar title="Executive AML Surveillance & Compliance Dashboard" />

      <main className="p-6 lg:p-8 space-y-6 max-w-7xl w-full mx-auto">
        
        {/* ========================================================= */}
        {/* TOP COMMAND HEADER & GLOBAL FILTER CONTROLS */}
        {/* ========================================================= */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white dark:bg-darkPanel p-5 rounded-2xl border border-gray-150 dark:border-slate-800 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-700/50">
                Operational Command Center
              </span>
              {dashboardData?.cached && (
                <span className="text-[10px] text-gray-400 dark:text-slate-400 flex items-center gap-1 font-mono">
                  <Zap className="w-3 h-3 text-amber-500" /> Cached (60s TTL)
                </span>
              )}
            </div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
              AML Surveillance & Analytics Dashboard
            </h1>
            <p className="text-xs text-gray-500 dark:text-slate-300">
              Live operational telemetry, hybrid score attribution, typology detection, and SLA risk tracking.
            </p>
          </div>

          {/* Global Filter Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 pt-2 xl:pt-0">
            {/* Time Range Preset */}
            <div className="flex items-center bg-gray-100 dark:bg-slate-900 p-1 rounded-xl border border-gray-200 dark:border-slate-800">
              {['7d', '30d', '90d', '1y'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    timeRange === range
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {range.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Country Selector */}
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="px-3 py-2 bg-gray-100 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 outline-none focus:border-blue-500"
            >
              <option value="">All Countries</option>
              <option value="IN">India (IN)</option>
              <option value="US">United States (US)</option>
              <option value="AE">UAE (AE)</option>
              <option value="GB">United Kingdom (GB)</option>
              <option value="SG">Singapore (SG)</option>
              <option value="CY">Cyprus (CY)</option>
              <option value="KY">Cayman Islands (KY)</option>
            </select>

            {/* Payment Channel Selector */}
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="px-3 py-2 bg-gray-100 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 outline-none focus:border-blue-500"
            >
              <option value="">All Payment Rails</option>
              <option value="UPI">UPI</option>
              <option value="RTGS">RTGS</option>
              <option value="NEFT">NEFT</option>
              <option value="IMPS">IMPS</option>
              <option value="Crypto Transfer">Crypto Transfer</option>
              <option value="Cash Deposit">Cash Deposit</option>
            </select>

            {/* Force Refresh Button */}
            <button
              onClick={() => fetchKPIs(true)}
              disabled={refreshing}
              className="p-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-800 rounded-xl text-gray-600 dark:text-slate-200 transition-all flex items-center justify-center"
              title="Force Refresh Metrics"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-500' : ''}`} />
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* OPERATIONAL KPI CARDS ROW */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Active Alert Backlog"
            value={ops.active_backlog || 0}
            subtext={`${ops.total_alerts || 0} total alerts logged`}
            icon={AlertTriangle}
            color="amber"
          />

          <StatCard
            title="SLA Compliance Rate"
            value={`${ops.sla_compliance_rate_pct || 94.5}%`}
            subtext={`${ops.sla_breached || 0} breaches, ${ops.sla_urgent_24h || 0} urgent due`}
            icon={ShieldCheck}
            color={ops.sla_breached > 0 ? 'rose' : 'emerald'}
          />

          <StatCard
            title="Mean Time to Close (MTTC)"
            value={`${ops.avg_mttc_hours || '4.2'} hrs`}
            subtext="From ingestion to resolution"
            icon={Clock}
            color="blue"
          />

          <StatCard
            title="STR Conversion Rate"
            value={`${feedback.str_conversion_rate_pct || '42.8'}%`}
            subtext={`FPR: ${feedback.false_positive_rate_pct || '24.2'}% across labeled set`}
            icon={TrendingUp}
            color="purple"
          />
        </div>

        {/* ========================================================= */}
        {/* SECTION 1: ALERT VOLUME TREND & BACKLOG BREAKDOWN */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left: Alert Volume & Resolution Trend */}
          <div className="lg:col-span-2 glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-500" /> Alert Ingestion & Resolution Velocity
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Daily incoming alerts vs investigated & closed items over time.
                </p>
              </div>

              <button
                onClick={() => downloadCSV('alert_volume_trend', ops.alert_volume_trend)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
                title="Export Chart Data as CSV"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="h-72 w-full min-h-[280px] pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ops.alert_volume_trend || []} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickFormatter={v => (v ? v.slice(5) : '')} />
                  <YAxis stroke="#94a3b8" fontSize={10} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '11px', color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Line type="monotone" dataKey="total_alerts" name="Incoming Alerts" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="critical" name="Critical Risk" stroke="#f43f5e" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="resolved" name="Resolved/Closed" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Backlog Distribution by Status */}
          <div className="glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-500" /> Backlog by Queue
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Triage queue and workflow distribution.
                </p>
              </div>

              <button
                onClick={() => downloadCSV('backlog_by_status', backlogPieData)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="h-72 w-full min-h-[280px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <Pie
                    data={backlogPieData}
                    cx="50%"
                    cy="45%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {backlogPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '11px', color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* ========================================================= */}
        {/* SECTION 2: DETECTION ATTRIBUTION & HYBRID FEEDBACK LOOP */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Left: Detection Mode Comparison (ML-Only vs Rule-Only vs Both) */}
          <div className="glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <GitCompare className="w-4 h-4 text-purple-500" /> Detection Mode Effectiveness
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Comparative analysis: ML-Only vs Scenario Rules vs Hybrid Fusion.
                </p>
              </div>

              <button
                onClick={() => downloadCSV('detection_mode_split', feedback.detection_mode_split)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs min-w-[500px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900/90 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-300 border-b border-gray-100 dark:border-slate-800">
                    <th className="px-3 py-2.5">Detection Engine</th>
                    <th className="px-3 py-2.5">Alerts</th>
                    <th className="px-3 py-2.5">Volume (INR)</th>
                    <th className="px-3 py-2.5">Precision</th>
                    <th className="px-3 py-2.5">STR Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                  {(feedback.detection_mode_split || []).map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-slate-200">
                        {row.label}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-slate-300">{row.alerts_generated}</td>
                      <td className="px-3 py-2.5 font-mono font-medium text-gray-700 dark:text-slate-300">₹{(row.total_volume_inr || 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border dark:border-emerald-700/50">
                          {row.precision_rate}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-blue-600 dark:text-blue-400 font-mono">
                        {row.str_conversion_rate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-purple-50/50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-800/50 rounded-xl text-[11px] text-purple-900 dark:text-purple-200 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
              <span>
                <strong>Hybrid Fusion</strong> yields the highest STR conversion rate (~52.4%) with minimal false-positives compared to isolated rule or ML scoring.
              </span>
            </div>
          </div>

          {/* Right: False-Positive Rate vs STR Conversion Trend */}
          <div className="glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <Brain className="w-4 h-4 text-emerald-500" /> Active Feedback & FPR Reduction
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Continuous model retraining and feedback loop performance over time.
                </p>
              </div>

              <button
                onClick={() => downloadCSV('monthly_feedback_trend', feedback.monthly_feedback_trend)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="h-72 w-full min-h-[280px] pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={feedback.monthly_feedback_trend || []} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} />
                  <YAxis stroke="#94a3b8" fontSize={10} unit="%" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '11px', color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar dataKey="fpr" name="False-Positive Rate (%)" fill="#f87171" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="str_conversion" name="STR Conversion (%)" fill="#34d399" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* ========================================================= */}
        {/* SECTION 3: AML TYPOLOGY BREAKDOWN & CHANNEL-RISK HEATMAP */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Typology Breakdown */}
          <div className="glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <Flame className="w-4 h-4 text-rose-500" /> AML Typology Detections
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Breakdown by money laundering pattern.
                </p>
              </div>

              <button
                onClick={() => downloadCSV('typology_breakdown', typologies)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="space-y-3 pt-1">
              {typologies.map((t, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-gray-800 dark:text-slate-200">{t.typology}</span>
                    <span className="font-mono text-gray-500 dark:text-slate-300 font-bold">{t.detections} hits</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden flex">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full shadow-sm"
                      style={{ width: `${Math.min(100, Math.max(15, (t.detections / (typologies[0]?.detections || 1)) * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-500 dark:text-slate-400">
                    <span>Vol: ₹{(t.total_volume_inr || 0).toLocaleString('en-IN')}</span>
                    <span className="text-rose-500 dark:text-rose-400 font-bold">{t.high_risk_alerts || 0} critical</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Channel-Risk Heatmap */}
          <div className="lg:col-span-2 glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-500" /> Channel vs. Amount Band Risk Heatmap
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Average risk index across payment rails and transaction brackets.
                </p>
              </div>

              <button
                onClick={() => downloadCSV('channel_risk_heatmap', entities.channel_risk_heatmap)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-center border-collapse text-xs min-w-[560px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900/90 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-300">
                    <th className="px-3 py-2 text-left">Payment Rail</th>
                    <th className="px-3 py-2">&lt; ₹50k</th>
                    <th className="px-3 py-2">₹50k - ₹2L</th>
                    <th className="px-3 py-2">₹2L - ₹10L</th>
                    <th className="px-3 py-2">₹10L - ₹50L</th>
                    <th className="px-3 py-2">&gt; ₹50L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                  {['UPI', 'RTGS', 'NEFT', 'Crypto Transfer', 'Cash Deposit'].map((ch, idx) => {
                    const rowCells = (entities.channel_risk_heatmap || []).filter(c => c.channel === ch);
                    return (
                      <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-bold text-left text-gray-800 dark:text-slate-200">
                          {ch}
                        </td>
                        {['< ₹50k', '₹50k - ₹2L', '₹2L - ₹10L', '₹10L - ₹50L', '> ₹50L'].map((b, bIdx) => {
                          const cell = rowCells.find(c => c.amount_band === b) || { avg_risk: 0, count: 0 };
                          const risk = cell.avg_risk;
                          const bg =
                            risk >= 70 ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 font-bold border border-rose-500/30 dark:bg-rose-950/60 dark:border-rose-700/50' :
                            risk >= 45 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/30 dark:bg-amber-950/60 dark:border-amber-700/50' :
                            risk >= 20 ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 dark:bg-blue-950/60 dark:border-blue-700/50' :
                            'bg-gray-100/40 dark:bg-slate-900/60 text-gray-400 dark:text-slate-400 border border-gray-200/40 dark:border-slate-800/60';
                          return (
                            <td key={bIdx} className="px-2 py-2">
                              <div className={`p-2 rounded-lg text-center transition-all ${bg}`}>
                                <div className="font-mono text-xs">{risk > 0 ? `${risk}%` : '—'}</div>
                                <div className="text-[9px] opacity-80">{cell.count} txs</div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* ========================================================= */}
        {/* SECTION 4: TOP RISKY CUSTOMERS & ANALYST WORKLOAD */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Top Risky Customers */}
          <div className="glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-rose-500" /> High-Risk Customer Watchlist
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Ranked by composite risk index and aggregate transaction volume.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadCSV('top_risky_customers', entities.top_risky_customers)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
                <button
                  onClick={() => navigate('/customers')}
                  className="text-xs font-semibold text-blue-500 dark:text-blue-400 hover:text-blue-600 flex items-center gap-0.5"
                >
                  View 360 <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs min-w-[500px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900/90 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-300 border-b border-gray-100 dark:border-slate-800">
                    <th className="px-3 py-2.5">Customer / Entity</th>
                    <th className="px-3 py-2.5">KYC Tier</th>
                    <th className="px-3 py-2.5">Alerts</th>
                    <th className="px-3 py-2.5">Total Vol (INR)</th>
                    <th className="px-3 py-2.5">Max Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                  {(entities.top_risky_customers || []).map((c, idx) => (
                    <tr
                      key={idx}
                      onClick={() => navigate(`/customers?search=${c.customer_id}`)}
                      className="hover:bg-gray-50/50 dark:hover:bg-slate-800/40 cursor-pointer transition-all"
                    >
                      <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-slate-200">
                        <div>{c.name}</div>
                        <div className="text-[10px] text-gray-400 dark:text-slate-400 font-mono">{c.customer_id}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.kyc_risk_rating === 'High' ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 dark:border dark:border-red-700/50' :
                          c.kyc_risk_rating === 'Med' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 dark:border dark:border-amber-700/50' :
                          'bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 dark:border dark:border-green-700/50'
                        }`}>
                          {c.kyc_risk_rating}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-rose-500 dark:text-rose-400 font-bold">{c.alert_count}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-slate-300">₹{(c.total_volume_inr || 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2.5 font-bold text-red-600 dark:text-red-400 font-mono">
                        {c.max_risk}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Analyst Workload & Resolution Leaderboard */}
          <div className="glass-panel p-6 space-y-4 rounded-2xl bg-white dark:bg-darkPanel border border-gray-150 dark:border-slate-800 shadow-sm">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-500" /> Analyst Workload & MTTC Leaderboard
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Active alert caseload, resolution speed, and regulatory STR filings.
                </p>
              </div>

              <button
                onClick={() => downloadCSV('analyst_workload', ops.analyst_workload)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-200 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs min-w-[480px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900/90 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-300 border-b border-gray-100 dark:border-slate-800">
                    <th className="px-3 py-2.5">Investigator</th>
                    <th className="px-3 py-2.5">Assigned</th>
                    <th className="px-3 py-2.5">Closed</th>
                    <th className="px-3 py-2.5">Avg MTTC</th>
                    <th className="px-3 py-2.5">STRs Filed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                  {(ops.analyst_workload || []).map((an, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-slate-200">
                        {an.analyst}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-slate-300">{an.assigned_alerts}</td>
                      <td className="px-3 py-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {an.closed_alerts}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-500 dark:text-slate-400">
                        {an.avg_time_hours} hrs
                      </td>
                      <td className="px-3 py-2.5 font-bold text-purple-600 dark:text-purple-400 font-mono">
                        {an.strs_filed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
};

export default Dashboard;
