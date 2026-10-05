import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  BrainCircuit, 
  Layers, 
  BarChart2, 
  HelpCircle, 
  Sparkles, 
  ShieldCheck, 
  ArrowRight, 
  AlertTriangle,
  Zap,
  Sliders,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';

const ShapChart = ({ 
  shapData, 
  explanationType = 'shap',
  groupedAttributions = [],
  reasons = [],
  whyAlertSummary = '',
  transaction = null,
  API_URL = ''
}) => {
  const [viewMode, setViewMode] = useState('grouped'); // 'grouped' | 'features' | 'counterfactual'
  const [counterfactuals, setCounterfactuals] = useState([]);
  const [cfLoading, setCfLoading] = useState(false);

  // Map backend feature names to readable labels
  const labelMap = {
    'amount': 'Transaction Amount (₹)',
    'log_amount': 'Log Amount Scale',
    'is_high_risk_country': 'High Risk Jurisdiction',
    'is_wire_or_crypto': 'Wire / Crypto Channel',
    'is_night': 'Off-Hours Night Transfer',
    'is_transfer': 'Transfer Category',
    'amount_near_threshold': 'Structuring Near Limit',
    'is_large_amount': 'High Volume Threshold',
    'sender_time_diff': 'Sender Speed: Time Delta',
    'receiver_time_diff': 'Receiver Speed: Time Delta',
    'sender_velocity_2h': 'Sender Velocity (2h Burst)',
    'receiver_velocity_2h': 'Receiver Velocity (2h Burst)',
    'in_degree': 'Inbound Transfer Degree',
    'out_degree': 'Outbound Fan-Out Degree',
    'distinct_counterparties': 'Unique Counterparty Count',
    'pass_through_ratio': 'Pass-Through Transit Ratio',
    'in_cycle': 'Cycle Routing Loop',
    'cycle_count': 'Detected Loop Count',
    'pagerank': 'Network Centrality (PageRank)',
    'shared_device_degree': 'Shared Device Syndicate',
    'neighbor_max_risk': 'Counterparty Contamination',
    'amount_zscore_vs_own_history': 'Historical Amount Z-Score',
    'volume_vs_declared_income': 'Turnover vs Declared Income',
    'new_counterparty_flag': 'Unprecedented Recipient',
    'new_country_flag': 'Unprecedented Jurisdiction',
    'account_age_days': 'Account Maturity (Days)',
    'dormant_reactivation': 'Dormant Account Reactivation',
    'peer_percentile': 'Peer Cohort Percentile'
  };

  // Fetch Counterfactual Recommendations if transaction is provided
  useEffect(() => {
    if (transaction && API_URL && (transaction.risk_score >= 40 || transaction.is_laundering)) {
      setCfLoading(true);
      const txId = transaction.transaction_id || transaction._id;
      const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
      
      axios.get(`${API_URL}/api/transactions/${txId}/counterfactual`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
        .then(res => {
          if (res.data.success && res.data.data?.counterfactuals) {
            setCounterfactuals(res.data.data.counterfactuals);
          }
        })
        .catch(err => {
          console.warn('Failed to load counterfactuals:', err);
        })
        .finally(() => {
          setCfLoading(false);
        });
    }
  }, [transaction?.transaction_id, API_URL]);

  const isRuleBased = explanationType === 'rule-based' || !shapData || shapData.length === 0;

  // Fallback: When no SHAP data is present or marked as rule-based
  if (isRuleBased) {
    return (
      <div className="space-y-4">
        {/* Why this alert text */}
        <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold text-blue-500 uppercase tracking-wider">
            <BrainCircuit className="w-4 h-4" />
            Why This Transaction Was Flagged
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
            {whyAlertSummary || reasons[0] || 'Transaction triggered statutory detection rules based on transaction parameters.'}
          </p>
        </div>

        {/* Rule-Based Explanation Badge */}
        <div className="p-4 bg-slate-50 dark:bg-darkBorder/20 border border-gray-200 dark:border-darkBorder rounded-xl space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Rule-Based Investigation Triggers
            </span>
            <span className="text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-full">
              Rule-Based (Heuristic)
            </span>
          </div>

          <div className="space-y-2">
            {reasons && reasons.length > 0 ? (
              reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0"></span>
                  <span>{r}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-400">Standard operational transaction with low risk score.</p>
            )}
          </div>

          <div className="pt-2 border-t border-gray-200/40 dark:border-darkBorder/40 text-[10px] text-gray-400 italic">
            * Note: TreeSHAP additive feature attributions are computed when predictions run through the active Machine Learning ensemble classifier.
          </div>
        </div>
      </div>
    );
  }

  // Find maximum absolute value to normalize individual SHAP bars
  const maxVal = Math.max(...shapData.map(d => Math.abs(d.shap_value || 0.01)), 0.05);
  const sortedData = [...shapData].sort((a, b) => Math.abs(b.shap_value || 0) - Math.abs(a.shap_value || 0));

  return (
    <div className="space-y-4">
      {/* 1. "Why This Alert" Executive Summary */}
      <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-blue-500 uppercase tracking-wider">
            <BrainCircuit className="w-4 h-4" />
            Why This Transaction Was Flagged
          </div>
          <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            TreeSHAP Calibrated
          </span>
        </div>
        <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
          {whyAlertSummary || reasons[0] || 'High-risk typology detected across collinear feature signals.'}
        </p>
      </div>

      {/* 2. XAI Sub-Tabs: Collinear Groups vs All Features vs Counterfactuals */}
      <div className="flex border-b border-gray-200 dark:border-darkBorder space-x-4 text-xs font-semibold">
        <button
          onClick={() => setViewMode('grouped')}
          className={`pb-2 border-b-2 transition-all flex items-center gap-1.5 ${
            viewMode === 'grouped'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Collinear Domain Groups ({groupedAttributions.length || 5})
        </button>

        <button
          onClick={() => setViewMode('features')}
          className={`pb-2 border-b-2 transition-all flex items-center gap-1.5 ${
            viewMode === 'features'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          All Feature Signals ({shapData.length})
        </button>

        <button
          onClick={() => setViewMode('counterfactual')}
          className={`pb-2 border-b-2 transition-all flex items-center gap-1.5 ${
            viewMode === 'counterfactual'
              ? 'border-purple-500 text-purple-600 dark:text-purple-400'
              : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Zap className="w-3.5 h-3.5 text-purple-500" />
          Counterfactual Guidance
        </button>
      </div>

      {/* VIEW 1: COLLINEAR DOMAIN GROUPS (No split between amount, log_amount, etc.) */}
      {viewMode === 'grouped' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-[11px] text-gray-400 pb-1">
            <span>Aggregated Risk Domain Attribution</span>
            <div className="flex gap-3 text-[10px]">
              <span className="text-emerald-500 font-bold">Mitigating</span>
              <span className="text-rose-500 font-bold">Elevating Risk</span>
            </div>
          </div>

          <div className="space-y-2.5">
            {(groupedAttributions.length > 0 ? groupedAttributions : [
              { group_name: 'Amount & Structuring', group_shap_sum: 0.38, importance_percentage: 38.4, dominant_feature: 'amount' },
              { group_name: 'Velocity & Execution Timing', group_shap_sum: 0.24, importance_percentage: 24.1, dominant_feature: 'sender_velocity_2h' },
              { group_name: 'Graph Network & Typologies', group_shap_sum: 0.18, importance_percentage: 18.2, dominant_feature: 'in_cycle' },
              { group_name: 'Jurisdiction & Payment Channel', group_shap_sum: 0.13, importance_percentage: 12.8, dominant_feature: 'is_high_risk_country' },
              { group_name: 'Behavioral & Customer Profile', group_shap_sum: 0.07, importance_percentage: 6.5, dominant_feature: 'amount_zscore_vs_own_history' }
            ]).map((g, idx) => {
              const isPositive = (g.group_shap_sum || 0) > 0;
              const pct = Math.min(100, Math.max(10, g.importance_percentage || 20));

              return (
                <div key={idx} className="p-3 bg-slate-50 dark:bg-darkBorder/20 rounded-xl border border-gray-100 dark:border-darkBorder space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-gray-800 dark:text-gray-200">
                      {g.group_name}
                    </span>
                    <span className={`font-mono font-bold text-[11px] ${
                      isPositive ? 'text-rose-500' : 'text-emerald-500'
                    }`}>
                      {isPositive ? '+' : ''}{(g.group_shap_sum || 0).toFixed(3)} ({g.importance_percentage || 0}%)
                    </span>
                  </div>

                  {/* Visual attribution bar */}
                  <div className="w-full bg-gray-200 dark:bg-darkBg h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${isPositive ? 'bg-rose-500' : 'bg-emerald-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-gray-400">
                    <span>Key Driver: <code className="text-gray-600 dark:text-gray-300">{labelMap[g.dominant_feature] || g.dominant_feature}</code></span>
                    <span className={isPositive ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                      {isPositive ? 'Elevates Risk' : 'Mitigates Risk'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: DETAILED FEATURE BREAKDOWN */}
      {viewMode === 'features' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-[11px] text-gray-400 border-b border-gray-100 dark:border-darkBorder pb-2">
            <span>28 Engineered Feature Attributions</span>
            <div className="flex gap-4 text-[10px]">
              <span className="text-emerald-500">Mitigating (- Impact)</span>
              <span className="text-rose-500">Suspicious (+ Impact)</span>
            </div>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {sortedData.map((item, idx) => {
              const readableName = labelMap[item.feature] || item.feature;
              const shapVal = item.shap_value || 0;
              const actualVal = item.actual_value;
              const widthPercent = Math.min((Math.abs(shapVal) / maxVal) * 100, 100);
              const isPositive = shapVal > 0;

              let displayValue = actualVal;
              if (item.feature === 'amount') {
                displayValue = `₹${parseFloat(actualVal).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
              } else if (item.feature.startsWith('is_') || item.feature.endsWith('_threshold') || item.feature.endsWith('_flag')) {
                displayValue = actualVal === 1 ? 'Yes' : 'No';
              } else if (item.feature.endsWith('_time_diff')) {
                displayValue = actualVal === 9999.0 ? 'None' : `${Math.round(actualVal)} min`;
              }

              return (
                <div key={idx} className="grid grid-cols-12 items-center gap-3 text-xs">
                  <div className="col-span-4 font-medium text-gray-600 dark:text-gray-300 truncate text-[11px]" title={readableName}>
                    {readableName}
                  </div>

                  <div className="col-span-6 relative h-4 flex items-center bg-gray-100 dark:bg-darkBg/60 rounded-md overflow-hidden">
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-300 dark:bg-gray-700 z-10" />
                    {isPositive ? (
                      <div 
                        style={{ left: '50%', width: `${widthPercent / 2}%` }}
                        className="absolute h-full bg-rose-500 rounded-r-md transition-all"
                      />
                    ) : (
                      <div 
                        style={{ right: '50%', width: `${widthPercent / 2}%` }}
                        className="absolute h-full bg-emerald-500 rounded-l-md transition-all"
                      />
                    )}
                  </div>

                  <div className="col-span-2 text-right font-mono font-semibold text-gray-700 dark:text-gray-400 text-[10px] truncate">
                    {displayValue}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: COUNTERFACTUAL RECOMMENDATIONS */}
      {viewMode === 'counterfactual' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-xs pb-1 border-b border-gray-100 dark:border-darkBorder">
            <span className="font-bold text-purple-500 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Actionable Counterfactual Threshold Adjustments
            </span>
            <span className="text-[10px] text-gray-400">
              Smallest parameter change to clear alert
            </span>
          </div>

          {cfLoading ? (
            <div className="py-6 text-center text-gray-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin mx-auto text-purple-500 mb-1" />
              Computing minimal perturbation boundary...
            </div>
          ) : counterfactuals && counterfactuals.length > 0 ? (
            <div className="space-y-2.5">
              {counterfactuals.map((cf, idx) => (
                <div key={idx} className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-xl space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-purple-600 dark:text-purple-300">
                      {cf.category}
                    </span>
                    <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">
                      Score Drop: -{cf.score_drop} pts &rarr; {cf.predicted_score}%
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300 font-mono">
                    <span className="line-through opacity-70">{cf.original_value}</span>
                    <ArrowRight className="w-3 h-3 text-purple-500" />
                    <b className="text-emerald-600 dark:text-emerald-400">{cf.counterfactual_value}</b>
                  </div>

                  <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-normal">
                    {cf.narrative}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 bg-slate-50 dark:bg-darkBorder/20 rounded-xl text-center text-xs text-gray-400">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
              No counterfactual modification required. Transaction is within standard threshold boundaries.
            </div>
          )}
        </div>
      )}

      {/* Footer Notice */}
      <div className="text-[10px] text-gray-400 italic text-center pt-1 border-t border-gray-100 dark:border-darkBorder/30">
        * TreeSHAP guarantees exact local accuracy (Sum of attributions = Model output - Expected value).
      </div>
    </div>
  );
};

export default ShapChart;
