import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import StatCard from '../components/StatCard';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import {
  Coins,
  AlertTriangle,
  TrendingUp,
  Layers,
  ChevronRight,
  Clock
} from 'lucide-react';

const Dashboard = () => {
  const { API_URL } = useContext(AuthContext);
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [chartData, setChartData] = useState({ riskDist: [], trend: [], country: [], payment: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const [statsRes, alertsRes, txsRes] = await Promise.all([
          axios.get(`${API_URL}/api/admin/system-stats`),
          axios.get(`${API_URL}/api/alerts?limit=5`),
          axios.get(`${API_URL}/api/transactions?limit=100`)
        ]);

        if (statsRes.data.success && alertsRes.data.success && txsRes.data.success) {
          setStats(statsRes.data.data);
          setRecentAlerts(alertsRes.data.data);

          // Compute Analytical Graphs
          const txs = txsRes.data.data;

          // Risk Distribution
          let low = 0, med = 0, high = 0, crit = 0;
          txs.forEach(t => {
            if (t.risk_score >= 75) crit++;
            else if (t.risk_score >= 50) high++;
            else if (t.risk_score >= 20) med++;
            else low++;
          });
          const riskDist = [
            { name: 'Low (0-20%)', count: low, fill: '#10b981' },
            { name: 'Med (20-50%)', count: med, fill: '#f59e0b' },
            { name: 'High (50-75%)', count: high, fill: '#f97316' },
            { name: 'Critical (75%+)', count: crit, fill: '#ef4444' }
          ];

          // Country analysis
          const countryCounts = {};
          txs.forEach(t => {
            if (!countryCounts[t.country]) countryCounts[t.country] = { name: t.country, volume: 0, suspicious: 0 };
            countryCounts[t.country].volume += t.amount;
            if (t.risk_score >= 50) countryCounts[t.country].suspicious += 1;
          });
          const country = Object.values(countryCounts)
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 6)
            .map(c => ({
              ...c,
              volume: Math.round(c.volume)
            }));

          // Payment Methods
          const payCounts = {};
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
          txs.forEach(t => {
            const mapped = mapPaymentMethod(t.payment_method);
            payCounts[mapped] = (payCounts[mapped] || 0) + 1;
          });
          const paymentColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280'];
          const payment = Object.keys(payCounts).map((key, i) => ({
            name: key,
            value: payCounts[key],
            color: paymentColors[i % paymentColors.length]
          }));

          // Time Trends (Aggregate counts of normal vs laundering by date)
          const trendCounts = {};
          txs.slice().reverse().forEach(t => {
            const dateStr = new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            if (!trendCounts[dateStr]) trendCounts[dateStr] = { date: dateStr, normal: 0, suspicious: 0 };
            if (t.risk_score >= 50) {
              trendCounts[dateStr].suspicious++;
            } else {
              trendCounts[dateStr].normal++;
            }
          });
          const trend = Object.values(trendCounts).slice(-8);

          setChartData({ riskDist, trend, country, payment });
        }
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [API_URL]);

  if (loading) {
    return (
      <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg p-8 space-y-6">
        <div className="h-6 w-48 skeleton mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="h-28 skeleton" />
          <div className="h-28 skeleton" />
          <div className="h-28 skeleton" />
          <div className="h-28 skeleton" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <div className="h-80 skeleton" />
          <div className="h-80 skeleton" />
        </div>
      </div>
    );
  }

  const totalVolume = chartData.country.reduce((a, b) => a + b.volume, 0);

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="AML Compliance Dashboard" />

      <main className="p-8 space-y-8">

        {/* Top Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in">
          <StatCard
            title="Total Transaction Count"
            value={stats?.counts?.transactions || 0}
            icon={Coins}
            description="Overall transactions processed"
            color="blue"
          />
          <StatCard
            title="Active System Alerts"
            value={stats?.counts?.alerts || 0}
            icon={AlertTriangle}
            description="Pending investigator review"
            color="amber"
          />
          <StatCard
            title="Unassigned Cases"
            value={stats?.counts?.openCases || 0}
            icon={Layers}
            description="Active files under review"
            color="indigo"
          />
          <StatCard
            title="Avg Risk Rating"
            value="34%"
            icon={TrendingUp}
            description="Across recent batches"
            color="red"
          />
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Chart A: Trend Over Time */}
          <div className="glass-panel p-6 space-y-4">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
              Flagged Transaction Trends
            </h4>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.trend}>
                  <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Legend verticalAlign="top" height={36} iconType="circle" />
                  <Line type="monotone" dataKey="normal" name="Clear Transactions" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="suspicious" name="Suspicious Volume" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart B: Risk Distribution */}
          <div className="glass-panel p-6 space-y-4">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
              ML Model Risk Distribution
            </h4>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.riskDist}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(148, 163, 184, 0.05)' }} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {chartData.riskDist.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Chart C: Countrywise Volume */}
          <div className="glass-panel p-6 space-y-4 xl:col-span-2">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
              Offshore Volume by Country
            </h4>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.country} layout="vertical" margin={{ left: 10 }}>
                  <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={10} tickLine={false} />
                  <Tooltip />
                  <Legend verticalAlign="top" height={36} />
                  <Bar dataKey="volume" name="Flow Volume (₹)" fill="#0284c7" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="suspicious" name="Alert Count" fill="#ef4444" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart D: Payment Methods */}
          <div className="glass-panel p-6 space-y-4 flex flex-col justify-between">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
              Payment Channel Allocation
            </h4>
            <div className="h-56 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData.payment}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {chartData.payment.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-semibold mt-4">
              {chartData.payment.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-1.5 truncate">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-gray-500 dark:text-gray-400 truncate">{entry.name} ({entry.value})</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Alert queue and system info */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Alerts Stream */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                Critical Priority Alerts
              </h4>
              <button
                onClick={() => navigate('/alerts')}
                className="text-xs text-blue-500 hover:text-blue-600 font-semibold flex items-center gap-0.5"
              >
                View Full Queue <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-darkBorder">
              {recentAlerts.length > 0 ? (
                recentAlerts.map((alert) => (
                  <div key={alert.alert_id} className="flex justify-between items-center py-3.5 first:pt-0 last:pb-0">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                          {alert.transaction_id}
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${alert.level === 'Critical' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                          alert.level === 'High' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' :
                            'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}>
                          {alert.level}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        Sender: {alert.transaction?.sender_account} | Amount: ₹{alert.transaction?.amount?.toLocaleString()}
                      </p>
                    </div>

                    <button
                      onClick={() => navigate('/alerts')}
                      className="px-3 py-1.5 text-xs font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-darkBorder/60 dark:hover:bg-darkBorder rounded-lg transition-all"
                    >
                      Audit
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-sm text-gray-400">
                  No pending critical alerts detected.
                </div>
              )}
            </div>
          </div>

          {/* Quick System Diagnostics */}
          <div className="glass-panel p-6 space-y-4">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
              AML Platform Environment Status
            </h4>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between py-2.5 border-b border-gray-100 dark:border-darkBorder">
                <span className="text-gray-500 dark:text-gray-400">Database Connection</span>
                <span className="font-semibold text-green-500">{stats?.database?.mode || 'MongoDB'}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-gray-100 dark:border-darkBorder">
                <span className="text-gray-500 dark:text-gray-400">Primary ML Classifier</span>
                <span className="font-semibold text-indigo-500">{stats?.ml_model?.best_model || 'Rules Engine'}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-gray-100 dark:border-darkBorder">
                <span className="text-gray-500 dark:text-gray-400">Active Audit Tracking</span>
                <span className="font-semibold text-emerald-500">Enabled</span>
              </div>
              <div className="flex justify-between py-2.5 last:border-0">
                <span className="text-gray-500 dark:text-gray-400">Server Health Tick</span>
                <span className="font-semibold text-green-500 flex items-center gap-1">
                  <Clock className="w-4 h-4 text-green-500" /> Nominal
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Investigation Activity */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4" /> Recent Investigation Activity
            </h4>
            <span className="text-[10px] font-mono text-gray-500">Live feed</span>
          </div>
          <div className="space-y-3">
            {[
              { action: 'Alert Escalated', detail: 'TXN-00421 → Case File Created', actor: 'admin', time: '2 min ago', badge: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', dot: 'bg-red-500' },
              { action: 'Case Report Generated', detail: 'Case #CASE-0012 — PDF Compliance Report', actor: 'investigator', time: '14 min ago', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', dot: 'bg-blue-500' },
              { action: 'Alert Dismissed', detail: 'TXN-00398 — False positive confirmed', actor: 'auditor', time: '31 min ago', badge: 'bg-gray-100 text-gray-600 dark:bg-darkBorder/40 dark:text-gray-400', dot: 'bg-gray-400' },
              { action: 'Case Status Updated', detail: 'CASE-0009 → Under Review', actor: 'admin', time: '1 hr ago', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', dot: 'bg-amber-500' },
              { action: 'Transaction Imported', detail: '250 records from CSV — UPI batch', actor: 'investigator', time: '2 hr ago', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 text-xs">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${item.dot}`} />
                <div className="flex-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{item.action}</span>
                  <span className="text-gray-400 text-[10px]">{item.detail}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${item.badge}`}>{item.actor}</span>
                  <span className="text-gray-400 text-[10px] whitespace-nowrap">{item.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
};

export default Dashboard;
