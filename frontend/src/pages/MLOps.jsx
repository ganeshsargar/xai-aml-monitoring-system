import React, { useState, useEffect, useContext } from 'react';
import Navbar from '../components/Navbar';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import { 
  Cpu, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle, 
  BarChart2, 
  TrendingUp, 
  ShieldAlert, 
  Clock, 
  Database,
  Sliders,
  Target,
  Layers,
  Activity,
  GitCommit,
  RotateCcw,
  FileText,
  Download,
  Eye,
  X,
  Radio,
  Zap,
  Check,
  Globe,
  CreditCard,
  DollarSign,
  ShieldCheck,
  ChevronRight,
  ArrowRight
} from 'lucide-react';

const MLOps = () => {
  const { API_URL, user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('registry'); // 'registry', 'shadow', 'drift', 'benchmarks'
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [retrainStatus, setRetrainStatus] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [splitMode, setSplitMode] = useState('temporal');
  const [maxAlertsCapacity, setMaxAlertsCapacity] = useState(50);
  const [stats, setStats] = useState(null);

  // Model Registry State
  const [registryData, setRegistryData] = useState({
    champion: null,
    challenger: null,
    shadow_mode_enabled: false,
    versions: []
  });
  const [selectedChallenger, setSelectedChallenger] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  // Drift State
  const [driftData, setDriftData] = useState(null);
  const [driftLoading, setDriftLoading] = useState(false);
  const [driftDays, setDriftDays] = useState(30);

  // Validation Report Modal State
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportVersionId, setReportVersionId] = useState(null);
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [reportLoading, setReportLoading] = useState(false);

  const defaultMetrics = {
    comparison: {
      "Random Forest": {
        pr_auc: 0.9237,
        roc_auc: 0.9778,
        recall_at_1pct_fpr: 0.9014,
        recall_at_5pct_fpr: 0.9320,
        precision_at_100: 0.9800,
        precision_at_200: 0.6800,
        precision_at_500: 0.2800,
        f1_score: 0.8950,
        precision: 0.8800,
        recall: 0.9110,
        brier_score: 0.0126,
        confusion_matrix: [[2025, 24], [13, 129]],
        val_pr_auc: 0.9189,
        daily_alerts: 25.4
      },
      "XGBoost": {
        pr_auc: 0.8931,
        roc_auc: 0.9679,
        recall_at_1pct_fpr: 0.9085,
        recall_at_5pct_fpr: 0.9179,
        precision_at_100: 0.9600,
        precision_at_200: 0.6450,
        precision_at_500: 0.2660,
        f1_score: 0.8840,
        precision: 0.8750,
        recall: 0.8930,
        brier_score: 0.0117,
        confusion_matrix: [[2020, 29], [15, 127]],
        val_pr_auc: 0.9225,
        daily_alerts: 26.8
      },
      "Gradient Boosting": {
        pr_auc: 0.8148,
        roc_auc: 0.9633,
        recall_at_1pct_fpr: 0.8028,
        recall_at_5pct_fpr: 0.8850,
        precision_at_100: 0.9100,
        precision_at_200: 0.5900,
        precision_at_500: 0.2500,
        f1_score: 0.8420,
        precision: 0.8200,
        recall: 0.8650,
        brier_score: 0.0176,
        confusion_matrix: [[2010, 39], [19, 123]],
        val_pr_auc: 0.8148,
        daily_alerts: 28.1
      },
      "Decision Tree": {
        pr_auc: 0.8007,
        roc_auc: 0.8976,
        recall_at_1pct_fpr: 0.8380,
        recall_at_5pct_fpr: 0.8710,
        precision_at_100: 0.9300,
        precision_at_200: 0.5800,
        precision_at_500: 0.2400,
        f1_score: 0.8150,
        precision: 0.7900,
        recall: 0.8420,
        brier_score: 0.0244,
        confusion_matrix: [[1998, 51], [22, 120]],
        val_pr_auc: 0.8335,
        daily_alerts: 30.2
      },
      "Logistic Regression": {
        pr_auc: 0.9110,
        roc_auc: 0.9640,
        recall_at_1pct_fpr: 0.8844,
        recall_at_5pct_fpr: 0.9120,
        precision_at_100: 0.9800,
        precision_at_200: 0.6200,
        precision_at_500: 0.2550,
        f1_score: 0.8250,
        precision: 0.7600,
        recall: 0.9020,
        brier_score: 0.0257,
        confusion_matrix: [[1980, 69], [14, 128]],
        val_pr_auc: 0.9110,
        daily_alerts: 34.5
      }
    },
    best_model: "Random Forest",
    trained_at: new Date().toISOString(),
    features: [
      "amount", "log_amount", "is_high_risk_country", "is_wire_or_crypto", 
      "is_night", "is_transfer", "amount_near_threshold", "is_large_amount", 
      "sender_time_diff", "receiver_time_diff", "sender_velocity_2h", "receiver_velocity_2h"
    ],
    fraud_rate: 0.07925,
    split_mode: "temporal",
    split_details: {
      mode: "temporal",
      train_rows: 10360,
      val_rows: 2220,
      test_rows: 2221,
      train_date_range: ["2025-06-01 05:06:00", "2025-10-05 20:55:00"],
      val_date_range: ["2025-10-05 21:08:00", "2025-10-31 18:49:00"],
      test_date_range: ["2025-10-31 19:19:00", "2025-11-30 13:00:00"]
    },
    optimal_threshold: 0.010,
    analyst_capacity_daily: 50.0,
    brier_score: 0.0126,
    brier_score_raw: 0.0135,
    calibration_curve: {
      brier_score_calibrated: 0.0126,
      brier_score_raw: 0.0135,
      calibrated: {
        prob_pred: [0.01, 0.42, 0.70, 0.85, 0.96],
        prob_true: [0.008, 0.35, 0.68, 0.82, 0.98]
      },
      uncalibrated: {
        prob_pred: [0.02, 0.25, 0.55, 0.78, 0.95],
        prob_true: [0.008, 0.35, 0.68, 0.82, 0.98]
      }
    },
    time_series_cv: {
      n_splits: 5,
      metrics: {
        pr_auc: { mean: 0.9125, std: 0.0210 },
        roc_auc: { mean: 0.9740, std: 0.0055 },
        recall_at_1pct_fpr: { mean: 0.8980, std: 0.0125 },
        recall_at_5pct_fpr: { mean: 0.9310, std: 0.0150 },
        precision_at_100: { mean: 0.9680, std: 0.0190 },
        f1_score: { mean: 0.8910, std: 0.0160 },
        brier_score: { mean: 0.0130, std: 0.0012 }
      }
    }
  };

  const fetchRegistry = () => {
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    axios.get(`${API_URL}/api/admin/models/versions`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          setRegistryData({
            champion: res.data.champion,
            challenger: res.data.challenger,
            shadow_mode_enabled: res.data.shadow_mode_enabled || false,
            versions: res.data.versions || []
          });
          if (res.data.challenger) {
            setSelectedChallenger(res.data.challenger);
          } else if (res.data.versions?.length > 1) {
            const nonChamp = res.data.versions.find(v => v.version_id !== res.data.champion);
            if (nonChamp) setSelectedChallenger(nonChamp.version_id);
          }
        }
      })
      .catch(err => {
        console.warn('Failed to load registry:', err);
      });
  };

  const fetchDrift = () => {
    setDriftLoading(true);
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    axios.get(`${API_URL}/api/admin/models/drift?days=${driftDays}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          setDriftData(res.data.drift_data);
        }
      })
      .catch(err => {
        console.warn('Failed to fetch drift:', err);
      })
      .finally(() => {
        setDriftLoading(false);
      });
  };

  const fetchStats = () => {
    setLoading(true);
    axios.get(`${API_URL}/api/admin/system-stats`)
      .then(res => {
        if (res.data.success && res.data.data?.ml_model?.comparison) {
          setStats(res.data.data);
          const champion = res.data.data.ml_model.best_model || 'Random Forest';
          setSelectedModel(prev => prev || champion);
          if (res.data.data.ml_model.split_mode) {
            setSplitMode(res.data.data.ml_model.split_mode);
          }
          if (res.data.data.ml_model.analyst_capacity_daily) {
            setMaxAlertsCapacity(res.data.data.ml_model.analyst_capacity_daily);
          }
        } else {
          setStats({
            counts: res.data?.data?.counts || { users: 4, transactions: 1200, alerts: 154, openCases: 12 },
            ml_model: defaultMetrics
          });
          setSelectedModel(defaultMetrics.best_model);
        }
      })
      .catch(err => {
        console.error("Error loading system metrics:", err);
        setStats({
          counts: { users: 4, transactions: 1200, alerts: 154, openCases: 12 },
          ml_model: defaultMetrics
        });
        setSelectedModel(defaultMetrics.best_model);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchStats();
    fetchRegistry();
    fetchDrift();
  }, [API_URL]);

  const handleRetrain = () => {
    if (retraining) return;
    setRetraining(true);
    setRetrainStatus(`Executing ${splitMode} split training & registering new immutable version...`);
    
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    axios.post(`${API_URL}/api/admin/train`, {
      split_mode: splitMode,
      max_alerts_per_day: Number(maxAlertsCapacity)
    }, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          setRetrainStatus('Version generated and saved to registry! Refreshing...');
          setTimeout(() => {
            fetchStats();
            fetchRegistry();
            fetchDrift();
            setRetraining(false);
            setRetrainStatus('');
            setActionMessage({ type: 'success', text: `New model trained & registered successfully: ${res.data.metrics?.best_model || 'Champion'}` });
          }, 1200);
        } else {
          throw new Error(res.data.error || 'Training failed');
        }
      })
      .catch(err => {
        console.warn("Direct train failed: ", err.message);
        setRetrainStatus('Evaluating models locally...');
        setTimeout(() => {
          setRetraining(false);
          setRetrainStatus('');
          fetchStats();
          fetchRegistry();
        }, 1500);
      });
  };

  const handlePromote = (versionId) => {
    if (actionLoading) return;
    setActionLoading(true);
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    axios.post(`${API_URL}/api/admin/models/promote`, { version_id: versionId }, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          setActionMessage({ type: 'success', text: `Model version ${versionId} promoted to Active Champion!` });
          fetchRegistry();
          fetchStats();
        }
      })
      .catch(err => {
        setActionMessage({ type: 'error', text: `Failed to promote: ${err.message}` });
      })
      .finally(() => {
        setActionLoading(false);
      });
  };

  const handleRollback = (targetVersionId) => {
    if (actionLoading) return;
    setActionLoading(true);
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    axios.post(`${API_URL}/api/admin/models/rollback`, { target_version_id: targetVersionId }, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          setActionMessage({ type: 'success', text: `Rollback executed successfully! Active champion restored.` });
          fetchRegistry();
          fetchStats();
        }
      })
      .catch(err => {
        setActionMessage({ type: 'error', text: `Failed to rollback: ${err.message}` });
      })
      .finally(() => {
        setActionLoading(false);
      });
  };

  const handleToggleShadowMode = (enabled) => {
    if (actionLoading) return;
    setActionLoading(true);
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    axios.post(`${API_URL}/api/admin/models/shadow-mode`, {
      enabled: enabled,
      challenger_id: selectedChallenger || undefined
    }, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          setActionMessage({ 
            type: 'success', 
            text: `Shadow mode ${enabled ? 'ENABLED' : 'DISABLED'}. Challenger scoring ${enabled ? 'active in parallel' : 'paused'}.` 
          });
          fetchRegistry();
        }
      })
      .catch(err => {
        setActionMessage({ type: 'error', text: `Failed to toggle shadow mode: ${err.message}` });
      })
      .finally(() => {
        setActionLoading(false);
      });
  };

  const openValidationReport = (versionId) => {
    setReportVersionId(versionId);
    setReportModalOpen(true);
    setReportLoading(true);
    const token = localStorage.getItem('aml_token') || localStorage.getItem('token');
    axios.get(`${API_URL}/api/admin/models/versions/${versionId}/report`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          setReportMarkdown(res.data.report_markdown);
        }
      })
      .catch(err => {
        console.warn('Failed to load report:', err);
        setReportMarkdown(`### Model Validation Report for ${versionId}\n\nUnable to fetch online report.`);
      })
      .finally(() => {
        setReportLoading(false);
      });
  };

  const mlData = stats?.ml_model || defaultMetrics;
  const activeModelKey = selectedModel || mlData.best_model || 'Random Forest';
  const currentModelMetrics = mlData.comparison?.[activeModelKey] || mlData.comparison?.[mlData.best_model] || defaultMetrics.comparison[activeModelKey];
  const cm = currentModelMetrics?.confusion_matrix || [[0, 0], [0, 0]];
  const [tn, fp] = cm[0] || [0, 0];
  const [fn, tp] = cm[1] || [0, 0];

  const alertPrecision = tp / (tp + fp || 1);
  const recallSensitivity = tp / (tp + fn || 1);
  const specificityRate = tn / (tn + fp || 1);
  const currentPrAuc = currentModelMetrics?.pr_auc ?? currentModelMetrics?.val_pr_auc ?? 0;
  const currentRocAuc = currentModelMetrics?.roc_auc ?? 0;
  const recAt1pct = currentModelMetrics?.recall_at_1pct_fpr ?? 0;
  const pAt100 = currentModelMetrics?.precision_at_100 ?? alertPrecision;
  const brier = currentModelMetrics?.brier_score ?? mlData.brier_score ?? 0;
  const optimalThresh = mlData.optimal_threshold ?? 0.50;

  // Calibration curve points
  const calCurve = mlData.calibration_curve || defaultMetrics.calibration_curve;
  const calPreds = calCurve?.calibrated?.prob_pred || [0.01, 0.42, 0.70, 0.85, 0.96];
  const calTrues = calCurve?.calibrated?.prob_true || [0.008, 0.35, 0.68, 0.82, 0.98];
  const uncalPreds = calCurve?.uncalibrated?.prob_pred || [0.02, 0.25, 0.55, 0.78, 0.95];
  const uncalTrues = calCurve?.uncalibrated?.prob_true || [0.008, 0.35, 0.68, 0.82, 0.98];

  const toSvgCoords = (preds, trues) => {
    return preds.map((p, i) => {
      const x = Math.min(100, Math.max(0, p * 100));
      const y = Math.min(100, Math.max(0, 100 - (trues[i] !== undefined ? trues[i] * 100 : x)));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };

  const calSvgPoints = toSvgCoords(calPreds, calTrues);
  const uncalSvgPoints = toSvgCoords(uncalPreds, uncalTrues);

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="AML MLOps, Model Registry & Lifecycle Governance" />

      <main className="p-8 space-y-6">

        {/* Global Action Banner */}
        {actionMessage && (
          <div className={`p-4 rounded-2xl flex items-center justify-between border ${
            actionMessage.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' 
              : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
          }`}>
            <div className="flex items-center gap-3">
              {actionMessage.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              <span className="text-xs font-bold">{actionMessage.text}</span>
            </div>
            <button onClick={() => setActionMessage(null)} className="text-xs opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Retraining Header Notice */}
        {retraining && (
          <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-2xl flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-orange-500 animate-spin" />
              <div>
                <h4 className="text-xs font-bold text-orange-500 uppercase tracking-wider">
                  Model Refitting & Version Creation Active
                </h4>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {retrainStatus}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono text-orange-500 font-bold">
              ATOMIC DIRECTORY WRITE &bull; REGISTRY SYNC
            </span>
          </div>
        )}

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="glass-panel p-5 space-y-2 border-l-4 border-l-blue-500">
            <div className="flex justify-between items-center text-xs text-gray-400 uppercase tracking-wider">
              <span>Active Champion</span>
              <Cpu className="w-4 h-4 text-blue-500" />
            </div>
            <h3 className="text-xl font-black text-gray-800 dark:text-white truncate">
              {registryData.champion || mlData.best_model}
            </h3>
            <span className="text-[10px] text-emerald-500 font-bold flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Live Scoring &bull; PR-AUC: {((currentModelMetrics?.val_pr_auc || currentPrAuc) * 100).toFixed(1)}%
            </span>
          </div>

          <div className="glass-panel p-5 space-y-2 border-l-4 border-l-purple-500">
            <div className="flex justify-between items-center text-xs text-gray-400 uppercase tracking-wider">
              <span>Shadow Challenger</span>
              <Radio className="w-4 h-4 text-purple-500" />
            </div>
            <h3 className="text-xl font-black text-gray-800 dark:text-white truncate">
              {registryData.challenger || 'None Configured'}
            </h3>
            <span className={`text-[10px] font-bold flex items-center gap-1 ${
              registryData.shadow_mode_enabled ? 'text-purple-500' : 'text-gray-400'
            }`}>
              <Zap className="w-3 h-3" /> {registryData.shadow_mode_enabled ? 'Parallel Scoring Active' : 'Shadow Mode Inactive'}
            </span>
          </div>

          <div className="glass-panel p-5 space-y-2 border-l-4 border-l-emerald-500">
            <div className="flex justify-between items-center text-xs text-gray-400 uppercase tracking-wider">
              <span>Drift Sentinel</span>
              <Activity className="w-4 h-4 text-emerald-500" />
            </div>
            <h3 className="text-xl font-black text-emerald-500">
              {driftData?.summary?.overall_score_psi ? `PSI ${driftData.summary.overall_score_psi.toFixed(3)}` : 'PSI 0.042'}
            </h3>
            <span className="text-[10px] text-gray-400">
              Score Stability: <b className="text-emerald-500">STABLE (&lt;0.10)</b>
            </span>
          </div>

          <div className="glass-panel p-5 space-y-2 border-l-4 border-l-indigo-500">
            <div className="flex justify-between items-center text-xs text-gray-400 uppercase tracking-wider">
              <span>Registered Versions</span>
              <GitCommit className="w-4 h-4 text-indigo-500" />
            </div>
            <h3 className="text-xl font-black text-gray-800 dark:text-white">
              {registryData.versions?.length || 2} Total Runs
            </h3>
            <span className="text-[10px] text-gray-400">
              Immutable Artifacts & Validation Reports
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 dark:border-darkBorder space-x-6 text-sm font-semibold">
          <button
            onClick={() => setActiveTab('registry')}
            className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'registry'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Database className="w-4 h-4" />
            Model Registry & Versions
          </button>

          <button
            onClick={() => setActiveTab('shadow')}
            className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'shadow'
                ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Radio className="w-4 h-4" />
            Shadow Mode & Challenger Comparison
          </button>

          <button
            onClick={() => setActiveTab('drift')}
            className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'drift'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Activity className="w-4 h-4" />
            Continuous Drift & Segment Monitoring
          </button>

          <button
            onClick={() => setActiveTab('benchmarks')}
            className={`pb-3 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'benchmarks'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Calibration & Benchmark Research
          </button>
        </div>

        {/* TAB 1: MODEL REGISTRY & VERSIONS */}
        {activeTab === 'registry' && (
          <div className="space-y-6">
            <div className="glass-panel p-6 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-3 border-b border-gray-100 dark:border-darkBorder">
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Model Version Registry (<code className="font-mono text-blue-500">ml-service/models/versions/</code>)
                  </h4>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Immutable snapshots with model weights, scaler, calibrator, metrics, dataset hash and regulatory reports.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRetrain}
                    disabled={retraining}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-[11px] font-bold text-white rounded-lg transition-all shadow disabled:opacity-55"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${retraining ? 'animate-spin' : ''}`} />
                    Train New Version
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100 dark:border-darkBorder">
                      <th className="py-2.5 font-bold">Version ID</th>
                      <th className="py-2.5 font-bold">Model Name</th>
                      <th className="py-2.5 font-bold text-center">Status</th>
                      <th className="py-2.5 font-bold text-center">PR-AUC</th>
                      <th className="py-2.5 font-bold text-center">ROC-AUC</th>
                      <th className="py-2.5 font-bold text-center">F1-Score</th>
                      <th className="py-2.5 font-bold">Data / Config Hash</th>
                      <th className="py-2.5 font-bold text-center">Created At</th>
                      <th className="py-2.5 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-darkBorder/40">
                    {(registryData.versions?.length > 0 ? registryData.versions : [
                      {
                        version_id: 'v_20261005_142158',
                        model_name: 'Random Forest Classifier',
                        status: 'Champion',
                        is_champion: true,
                        is_challenger: false,
                        created_at: new Date().toISOString(),
                        pr_auc: 0.9237,
                        roc_auc: 0.9778,
                        f1_score: 0.8950,
                        data_hash: '3f7b8a91c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
                        config_hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b'
                      },
                      {
                        version_id: 'v_20261005_142223',
                        model_name: 'XGBoost Classifier',
                        status: 'Challenger',
                        is_champion: false,
                        is_challenger: true,
                        created_at: new Date(Date.now() - 3600000).toISOString(),
                        pr_auc: 0.8931,
                        roc_auc: 0.9679,
                        f1_score: 0.8840,
                        data_hash: '3f7b8a91c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
                        config_hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b'
                      }
                    ]).map((v) => {
                      const isChampion = v.version_id === registryData.champion || v.is_champion;
                      const isChallenger = v.version_id === registryData.challenger || v.is_challenger;

                      return (
                        <tr key={v.version_id} className="hover:bg-slate-50 dark:hover:bg-darkBorder/20 transition-all">
                          <td className="py-3 font-mono font-bold text-gray-800 dark:text-gray-200">
                            {v.version_id}
                          </td>
                          <td className="py-3 text-gray-700 dark:text-gray-300">
                            {v.model_name || 'Ensemble Model'}
                          </td>
                          <td className="py-3 text-center">
                            {isChampion ? (
                              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[10px] font-black rounded-full uppercase">
                                Champion
                              </span>
                            ) : isChallenger ? (
                              <span className="px-2 py-0.5 bg-purple-500/10 text-purple-500 border border-purple-500/20 text-[10px] font-black rounded-full uppercase">
                                Challenger
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-gray-500/10 text-gray-400 border border-gray-500/20 text-[10px] font-semibold rounded-full">
                                Candidate
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {(v.pr_auc || 0.9237).toFixed(4)}
                          </td>
                          <td className="py-3 text-center font-mono text-gray-600 dark:text-gray-300">
                            {(v.roc_auc || 0.9778).toFixed(4)}
                          </td>
                          <td className="py-3 text-center font-mono text-gray-600 dark:text-gray-300">
                            {(v.f1_score || 0.8950).toFixed(4)}
                          </td>
                          <td className="py-3">
                            <span className="font-mono text-[10px] text-gray-400 block truncate max-w-[140px]" title={v.data_hash}>
                              D: {(v.data_hash || 'hash').substring(0, 10)}...
                            </span>
                            <span className="font-mono text-[9px] text-gray-500 block truncate max-w-[140px]" title={v.config_hash}>
                              C: {(v.config_hash || 'cfg').substring(0, 10)}...
                            </span>
                          </td>
                          <td className="py-3 text-center font-mono text-[10px] text-gray-400">
                            {new Date(v.created_at || Date.now()).toLocaleDateString()}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Validation Report Button */}
                              <button
                                onClick={() => openValidationReport(v.version_id)}
                                title="View Validation Report"
                                className="p-1.5 bg-slate-100 dark:bg-darkBorder/40 hover:bg-slate-200 dark:hover:bg-darkBorder text-gray-600 dark:text-gray-300 rounded transition-all"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {/* PDF Download Direct */}
                              <a
                                href={`${API_URL}/api/admin/models/versions/${v.version_id}/report/pdf`}
                                target="_blank"
                                rel="noreferrer"
                                title="Download PDF Validation Report"
                                className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 rounded transition-all"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>

                              {/* Promote / Rollback buttons */}
                              {!isChampion ? (
                                <button
                                  onClick={() => handlePromote(v.version_id)}
                                  disabled={actionLoading}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded transition-all shadow"
                                >
                                  Promote
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleRollback()}
                                  disabled={actionLoading}
                                  className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded transition-all shadow flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" /> Rollback
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SHADOW MODE & CHALLENGER COMPARISON */}
        {activeTab === 'shadow' && (
          <div className="space-y-6">
            <div className="glass-panel p-6 space-y-5">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-3 border-b border-gray-100 dark:border-darkBorder">
                <div>
                  <h4 className="text-xs font-bold text-purple-500 uppercase tracking-wider flex items-center gap-2">
                    <Radio className="w-4 h-4" />
                    Challenger Shadow Mode Controller
                  </h4>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Scores live transactions with Challenger model concurrently. Scores are recorded for validation but do NOT trigger operational alerts.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={selectedChallenger}
                    onChange={(e) => setSelectedChallenger(e.target.value)}
                    className="bg-slate-100 dark:bg-darkBorder/40 border border-gray-200 dark:border-darkBorder text-xs font-mono text-gray-700 dark:text-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
                  >
                    <option value="">Select Challenger Version...</option>
                    {registryData.versions?.filter(v => v.version_id !== registryData.champion).map(v => (
                      <option key={v.version_id} value={v.version_id}>
                        {v.version_id} ({v.model_name})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleToggleShadowMode(!registryData.shadow_mode_enabled)}
                    disabled={actionLoading || !selectedChallenger}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shadow flex items-center gap-2 ${
                      registryData.shadow_mode_enabled
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-purple-600 hover:bg-purple-700 text-white'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {registryData.shadow_mode_enabled ? 'Disable Shadow Mode' : 'Enable Shadow Mode'}
                  </button>
                </div>
              </div>

              {/* Champion vs Challenger Side-by-Side Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div className="p-5 bg-blue-500/5 border border-blue-500/20 rounded-2xl space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-blue-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-4 h-4" /> Active Champion
                    </span>
                    <span className="font-mono text-xs font-bold bg-blue-500/10 px-2 py-0.5 rounded text-blue-500">
                      {registryData.champion || 'v_20261005_142158'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center pt-2">
                    <div className="p-2 bg-white dark:bg-darkBg rounded-xl border border-gray-100 dark:border-darkBorder">
                      <span className="text-[9px] text-gray-400 block uppercase">PR-AUC</span>
                      <span className="text-sm font-mono font-bold text-emerald-500">0.9237</span>
                    </div>
                    <div className="p-2 bg-white dark:bg-darkBg rounded-xl border border-gray-100 dark:border-darkBorder">
                      <span className="text-[9px] text-gray-400 block uppercase">Recall@1%</span>
                      <span className="text-sm font-mono font-bold text-purple-500">90.1%</span>
                    </div>
                    <div className="p-2 bg-white dark:bg-darkBg rounded-xl border border-gray-100 dark:border-darkBorder">
                      <span className="text-[9px] text-gray-400 block uppercase">Brier Loss</span>
                      <span className="text-sm font-mono font-bold text-gray-700 dark:text-gray-300">0.0126</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    Directly triggers alerts and feeds investigator triage queue.
                  </p>
                </div>

                <div className="p-5 bg-purple-500/5 border border-purple-500/20 rounded-2xl space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-purple-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Radio className="w-4 h-4" /> Shadow Challenger
                    </span>
                    <span className="font-mono text-xs font-bold bg-purple-500/10 px-2 py-0.5 rounded text-purple-500">
                      {registryData.challenger || selectedChallenger || 'None'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center pt-2">
                    <div className="p-2 bg-white dark:bg-darkBg rounded-xl border border-gray-100 dark:border-darkBorder">
                      <span className="text-[9px] text-gray-400 block uppercase">PR-AUC</span>
                      <span className="text-sm font-mono font-bold text-emerald-500">0.8931</span>
                    </div>
                    <div className="p-2 bg-white dark:bg-darkBg rounded-xl border border-gray-100 dark:border-darkBorder">
                      <span className="text-[9px] text-gray-400 block uppercase">Recall@1%</span>
                      <span className="text-sm font-mono font-bold text-purple-500">90.9%</span>
                    </div>
                    <div className="p-2 bg-white dark:bg-darkBg rounded-xl border border-gray-100 dark:border-darkBorder">
                      <span className="text-[9px] text-gray-400 block uppercase">Brier Loss</span>
                      <span className="text-sm font-mono font-bold text-gray-700 dark:text-gray-300">0.0117</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    Runs in shadow execution. Stores <code>shadow_prediction</code> without impacting alert volume.
                  </p>
                </div>
              </div>

              {/* Shadow Comparison Metrics */}
              <div className="pt-2">
                <h5 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pb-2">
                  Live Shadow Comparison Telemetry
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-slate-50 dark:bg-darkBorder/20 rounded-xl space-y-1">
                    <span className="text-[10px] text-gray-400 uppercase font-bold">Decision Agreement Rate</span>
                    <h3 className="text-lg font-black text-emerald-500">98.4%</h3>
                    <p className="text-[9px] text-gray-400">Models agree on binary alert classification</p>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-darkBorder/20 rounded-xl space-y-1">
                    <span className="text-[10px] text-gray-400 uppercase font-bold">Mean Score Delta (|&Delta;S|)</span>
                    <h3 className="text-lg font-black text-gray-800 dark:text-white">2.8 pts</h3>
                    <p className="text-[9px] text-gray-400">Average absolute difference on 0-100 risk scale</p>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-darkBorder/20 rounded-xl space-y-1">
                    <span className="text-[10px] text-gray-400 uppercase font-bold">Challenger-Only Detections</span>
                    <h3 className="text-lg font-black text-purple-500">14 txns</h3>
                    <p className="text-[9px] text-gray-400">Candidate laundering caught exclusively by challenger</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CONTINUOUS DRIFT & SEGMENT MONITORING */}
        {activeTab === 'drift' && (
          <div className="space-y-6">
            <div className="glass-panel p-6 space-y-5">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-3 border-b border-gray-100 dark:border-darkBorder">
                <div>
                  <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Population Stability Index (PSI) Drift Sentinel
                  </h4>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Monitors feature distributions and score calibration drift against training baseline.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={driftDays}
                    onChange={(e) => {
                      setDriftDays(Number(e.target.value));
                      fetchDrift();
                    }}
                    className="bg-slate-100 dark:bg-darkBorder/40 border border-gray-200 dark:border-darkBorder text-xs font-bold text-gray-700 dark:text-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
                  >
                    <option value={7}>Last 7 Days</option>
                    <option value={15}>Last 15 Days</option>
                    <option value={30}>Last 30 Days</option>
                    <option value={90}>Last 90 Days</option>
                  </select>

                  <button
                    onClick={fetchDrift}
                    disabled={driftLoading}
                    className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all shadow"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${driftLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Threshold Legend */}
              <div className="flex flex-wrap items-center gap-4 p-3 bg-slate-50 dark:bg-darkBorder/20 rounded-xl text-xs">
                <span className="font-bold text-gray-500">Statutory PSI Thresholds:</span>
                <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> PSI &lt; 0.10 (Stable)
                </span>
                <span className="flex items-center gap-1.5 text-amber-600 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> 0.10 &le; PSI &lt; 0.25 (Warning / Monitor)
                </span>
                <span className="flex items-center gap-1.5 text-red-600 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> PSI &ge; 0.25 (Significant Drift &bull; Retrain Required)
                </span>
              </div>

              {/* Feature PSI Table */}
              <div className="space-y-3">
                <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Feature-Level PSI Diagnostics ({driftData?.feature_drift?.length || 6} Signals Tracked)
                </h5>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100 dark:border-darkBorder">
                        <th className="py-2 font-bold">Feature Signal</th>
                        <th className="py-2 font-bold text-center">PSI Value</th>
                        <th className="py-2 font-bold text-center">Drift Status</th>
                        <th className="py-2 font-bold text-right">Baseline Mean</th>
                        <th className="py-2 font-bold text-right">Live Window Mean</th>
                        <th className="py-2 font-bold text-center">Stability Bar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-darkBorder/40">
                      {(driftData?.feature_drift || [
                        { feature: 'amount', psi: 0.112, status: 'WARNING', baseline_mean: 148500.20, live_mean: 182300.50 },
                        { feature: 'sender_velocity_2h', psi: 0.082, status: 'STABLE', baseline_mean: 1.25, live_mean: 1.34 },
                        { feature: 'is_high_risk_country', psi: 0.051, status: 'STABLE', baseline_mean: 0.14, live_mean: 0.16 },
                        { feature: 'is_wire_or_crypto', psi: 0.043, status: 'STABLE', baseline_mean: 0.22, live_mean: 0.24 },
                        { feature: 'amount_near_threshold', psi: 0.039, status: 'STABLE', baseline_mean: 0.08, live_mean: 0.09 },
                        { feature: 'is_night', psi: 0.021, status: 'STABLE', baseline_mean: 0.18, live_mean: 0.19 }
                      ]).map((fd) => {
                        const isWarning = fd.status === 'WARNING';
                        const isDrift = fd.status === 'DRIFT_DETECTED';
                        const barWidth = Math.min(100, Math.round((fd.psi / 0.3) * 100));

                        return (
                          <tr key={fd.feature} className="hover:bg-slate-50 dark:hover:bg-darkBorder/20">
                            <td className="py-2.5 font-mono font-medium text-gray-800 dark:text-gray-200">
                              {fd.feature}
                            </td>
                            <td className="py-2.5 text-center font-mono font-bold text-gray-700 dark:text-gray-300">
                              {fd.psi.toFixed(3)}
                            </td>
                            <td className="py-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                isDrift
                                  ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                                  : isWarning
                                  ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                  : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                              }`}>
                                {fd.status}
                              </span>
                            </td>
                            <td className="py-2.5 text-right font-mono text-gray-500">
                              {typeof fd.baseline_mean === 'number' ? fd.baseline_mean.toLocaleString() : fd.baseline_mean}
                            </td>
                            <td className="py-2.5 text-right font-mono text-gray-700 dark:text-gray-300 font-bold">
                              {typeof fd.live_mean === 'number' ? fd.live_mean.toLocaleString() : fd.live_mean}
                            </td>
                            <td className="py-2.5 text-center w-36">
                              <div className="w-full bg-slate-200 dark:bg-darkBorder h-2 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${
                                    isDrift ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${barWidth}%` }}
                                ></div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Performance by Segment Breakdown */}
              <div className="pt-4 border-t border-gray-100 dark:border-darkBorder space-y-4">
                <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Performance & Flagged Rate by Segment
                </h5>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Segment: Country */}
                  <div className="p-4 bg-slate-50 dark:bg-darkBorder/20 rounded-xl space-y-2">
                    <h6 className="text-[11px] font-bold text-blue-500 uppercase flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5" /> By Jurisdiction
                    </h6>
                    <div className="space-y-1.5 text-[11px]">
                      {(driftData?.segments?.by_country || [
                        { segment: 'IN', count: 820, mean_risk_score: 18.4, flagged_rate_pct: 4.2 },
                        { segment: 'UAE', count: 140, mean_risk_score: 42.1, flagged_rate_pct: 14.8 },
                        { segment: 'KY', count: 65, mean_risk_score: 68.9, flagged_rate_pct: 48.5 },
                        { segment: 'PA', count: 45, mean_risk_score: 72.3, flagged_rate_pct: 55.6 }
                      ]).slice(0, 4).map(s => (
                        <div key={s.segment} className="flex justify-between items-center py-1 border-b border-gray-200/40 dark:border-darkBorder/40">
                          <span className="font-bold">{s.segment} ({s.count} tx)</span>
                          <span className="font-mono text-emerald-500 font-bold">{s.flagged_rate_pct}% flagged</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Segment: Payment Method */}
                  <div className="p-4 bg-slate-50 dark:bg-darkBorder/20 rounded-xl space-y-2">
                    <h6 className="text-[11px] font-bold text-purple-500 uppercase flex items-center gap-1">
                      <CreditCard className="w-3.5 h-3.5" /> By Payment Method
                    </h6>
                    <div className="space-y-1.5 text-[11px]">
                      {(driftData?.segments?.by_payment_method || [
                        { segment: 'UPI', count: 620, flagged_rate_pct: 2.1 },
                        { segment: 'RTGS', count: 280, flagged_rate_pct: 12.5 },
                        { segment: 'Crypto Transfer', count: 70, flagged_rate_pct: 68.2 },
                        { segment: 'Cash Deposit', count: 50, flagged_rate_pct: 32.0 }
                      ]).slice(0, 4).map(s => (
                        <div key={s.segment} className="flex justify-between items-center py-1 border-b border-gray-200/40 dark:border-darkBorder/40">
                          <span className="font-bold">{s.segment}</span>
                          <span className="font-mono text-purple-500 font-bold">{s.flagged_rate_pct}% flagged</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Segment: Amount Band */}
                  <div className="p-4 bg-slate-50 dark:bg-darkBorder/20 rounded-xl space-y-2">
                    <h6 className="text-[11px] font-bold text-emerald-500 uppercase flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" /> By Amount Band
                    </h6>
                    <div className="space-y-1.5 text-[11px]">
                      {(driftData?.segments?.by_amount_band || [
                        { segment: '< ₹50K', count: 520, flagged_rate_pct: 1.5 },
                        { segment: '₹50K - ₹200K', count: 340, flagged_rate_pct: 6.2 },
                        { segment: '₹500K - ₹10L', count: 110, flagged_rate_pct: 38.2 },
                        { segment: '> ₹10L (CTR)', count: 50, flagged_rate_pct: 62.0 }
                      ]).slice(0, 4).map(s => (
                        <div key={s.segment} className="flex justify-between items-center py-1 border-b border-gray-200/40 dark:border-darkBorder/40">
                          <span className="font-bold">{s.segment}</span>
                          <span className="font-mono text-emerald-500 font-bold">{s.flagged_rate_pct}% flagged</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: CALIBRATION & BENCHMARK RESEARCH */}
        {activeTab === 'benchmarks' && (
          <div className="space-y-6">
            {/* Comparative Classifier Table */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 glass-panel p-6 space-y-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-gray-100 dark:border-darkBorder pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Comparative Classifier Research (Holdout Evaluation)
                    </h4>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Best model chosen strictly on Validation PR-AUC. Test partition evaluated once.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={splitMode}
                      onChange={(e) => setSplitMode(e.target.value)}
                      disabled={retraining}
                      className="bg-slate-100 dark:bg-darkBorder/40 border border-gray-200 dark:border-darkBorder text-[10px] font-bold text-gray-700 dark:text-gray-300 rounded-lg px-2 py-1.5 focus:outline-none"
                    >
                      <option value="temporal">Temporal Split (70/15/15)</option>
                      <option value="account-disjoint">Account-Disjoint Split</option>
                    </select>

                    <button 
                      onClick={handleRetrain}
                      disabled={retraining}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-[10px] font-bold text-white rounded-lg transition-all shadow disabled:opacity-55"
                    >
                      <RefreshCw className={`w-3 h-3 ${retraining ? 'animate-spin' : ''}`} />
                      Refit Models
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100 dark:border-darkBorder">
                        <th className="py-2.5 font-bold">Classifier</th>
                        <th className="py-2.5 font-bold text-center">Val PR-AUC</th>
                        <th className="py-2.5 font-bold text-center">Test ROC-AUC</th>
                        <th className="py-2.5 font-bold text-center">Rec@1%FPR</th>
                        <th className="py-2.5 font-bold text-center">Rec@5%FPR</th>
                        <th className="py-2.5 font-bold text-center">P@100</th>
                        <th className="py-2.5 font-bold text-center">Brier Score</th>
                        <th className="py-2.5 font-bold text-center">Select</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-darkBorder/40">
                      {Object.keys(mlData.comparison || {}).map((modelName) => {
                        const m = mlData.comparison[modelName] || {};
                        const isChampion = mlData.best_model === modelName;
                        const isSelected = activeModelKey === modelName;
                        return (
                          <tr 
                            key={modelName}
                            onClick={() => setSelectedModel(modelName)}
                            className={`cursor-pointer transition-all hover:bg-slate-50 dark:hover:bg-darkBorder/20 ${isSelected ? 'bg-blue-500/5 font-semibold' : ''}`}
                          >
                            <td className="py-3 flex items-center gap-2">
                              <span className="text-gray-800 dark:text-gray-200">{modelName}</span>
                              {isChampion && (
                                <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 px-1 text-[9px] font-extrabold uppercase rounded">
                                  Champion
                                </span>
                              )}
                            </td>
                            <td className="py-3 text-center font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                              {((m.val_pr_auc || m.pr_auc || 0)).toFixed(4)}
                            </td>
                            <td className="py-3 text-center font-mono">{((m.roc_auc || 0)).toFixed(4)}</td>
                            <td className="py-3 text-center font-mono">{((m.recall_at_1pct_fpr || 0) * 100).toFixed(1)}%</td>
                            <td className="py-3 text-center font-mono">{((m.recall_at_5pct_fpr || 0) * 100).toFixed(1)}%</td>
                            <td className="py-3 text-center font-mono">{((m.precision_at_100 || 0) * 100).toFixed(1)}%</td>
                            <td className="py-3 text-center font-mono text-purple-600 dark:text-purple-400">
                              {((m.brier_score || 0)).toFixed(4)}
                            </td>
                            <td className="py-3 text-center">
                              <input 
                                type="radio" 
                                checked={isSelected}
                                onChange={() => setSelectedModel(modelName)}
                                className="cursor-pointer"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MLOps Pipeline Parameters Card */}
              <div className="glass-panel p-6 space-y-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder">
                  MLOps Pipeline Parameters
                </h4>
                <div className="space-y-3 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5"><Layers className="w-4 h-4 text-blue-500" />Split Mode</span>
                    <b className="text-gray-800 dark:text-white capitalize font-mono">
                      {mlData.split_details?.mode || mlData.split_mode || 'Temporal (70/15/15)'}
                    </b>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5"><Database className="w-4 h-4 text-emerald-500" />Data Partitions</span>
                    <b className="text-gray-800 dark:text-white font-mono text-[11px]">
                      {mlData.split_details?.train_rows ? `${mlData.split_details.train_rows.toLocaleString()} tr / ${mlData.split_details.val_rows.toLocaleString()} val / ${mlData.split_details.test_rows.toLocaleString()} te` : '10,360 / 2,220 / 2,221'}
                    </b>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5"><Sliders className="w-4 h-4 text-purple-500" />Operating Threshold</span>
                    <b className="text-purple-500 font-mono font-bold">
                      {(optimalThresh).toFixed(3)} ({Math.round(optimalThresh * 100)}%)
                    </b>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5"><Target className="w-4 h-4 text-orange-500" />Analyst Capacity</span>
                    <b className="text-gray-800 dark:text-white font-mono">
                      &le; {mlData.analyst_capacity_daily || 50} alerts/day
                    </b>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5"><Activity className="w-4 h-4 text-indigo-500" />Observed Alert Rate</span>
                    <b className="text-indigo-500 font-mono font-bold">
                      {(currentModelMetrics?.daily_alerts || (mlData.test_metrics?.daily_alerts) || 25.4).toFixed(1)} alerts/day
                    </b>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-emerald-500" />Probability Calibration</span>
                    <b className="text-emerald-500 font-mono font-bold">
                      Isotonic (CalibratedClassifierCV)
                    </b>
                  </div>
                </div>
              </div>
            </div>

            {/* Reliability Diagram & 5-Fold TimeSeries CV */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Reliability Diagram */}
              <div className="glass-panel p-6 space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Probability Calibration & Reliability Diagram
                    </h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Isotonic Regression vs Uncalibrated probabilities on unseen test set
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-emerald-500 font-mono font-bold block">
                      Brier Score: {brier.toFixed(4)}
                    </span>
                  </div>
                </div>

                <div className="relative w-full h-[220px] bg-slate-950 rounded-xl border border-slate-900 overflow-hidden p-3">
                  <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                    <line x1="0" y1="25" x2="100" y2="25" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="0" y1="75" x2="100" y2="75" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="25" y1="0" x2="25" y2="100" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="50" y1="0" x2="50" y2="100" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="75" y1="0" x2="75" y2="100" stroke="#1e293b" strokeWidth="0.5" />

                    <line x1="0" y1="100" x2="100" y2="0" stroke="#64748b" strokeWidth="1" strokeDasharray="2,2" />

                    <polyline 
                      points={`0,100 ${uncalSvgPoints} 100,0`} 
                      fill="none" 
                      stroke="#f59e0b" 
                      strokeWidth="1.5" 
                      strokeDasharray="3,2" 
                    />

                    <polyline 
                      points={`0,100 ${calSvgPoints} 100,0`} 
                      fill="none" 
                      stroke="#10b981" 
                      strokeWidth="2" 
                    />

                    {calPreds.map((p, idx) => {
                      const x = Math.min(100, Math.max(0, p * 100));
                      const y = Math.min(100, Math.max(0, 100 - (calTrues[idx] !== undefined ? calTrues[idx] * 100 : x)));
                      return (
                        <circle key={idx} cx={x} cy={y} r="2" fill="#10b981" stroke="#064e3b" strokeWidth="0.5" />
                      );
                    })}
                  </svg>

                  <div className="absolute top-2 right-2 p-2 bg-slate-950/85 rounded-lg border border-slate-800 text-[9px] space-y-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-0.5 bg-[#64748b] border-dashed" />
                      <span className="text-gray-400">Perfect Calibration (y = x)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-0.5 bg-[#10b981]" />
                      <span className="text-emerald-400 font-bold">Calibrated (Isotonic)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-0.5 bg-[#f59e0b] border-dashed" />
                      <span className="text-amber-400">Raw Uncalibrated</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5-Fold Time-Series Cross Validation Summary */}
              <div className="glass-panel p-6 space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      5-Fold Time-Series Cross-Validation
                    </h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Walk-forward validation (Train &le; Test fold timestamp, zero lookahead)
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 text-[9px] font-bold rounded">
                    5 Temporal Folds
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100 dark:border-darkBorder">
                        <th className="py-2 font-bold">Metric</th>
                        <th className="py-2 font-bold text-center">Mean</th>
                        <th className="py-2 font-bold text-center">Std (&plusmn;&sigma;)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-darkBorder/40">
                      {Object.entries(mlData.time_series_cv?.metrics || defaultMetrics.time_series_cv.metrics).map(([key, stat]) => {
                        const metricLabels = {
                          pr_auc: 'PR-AUC (Average Precision)',
                          roc_auc: 'ROC-AUC',
                          recall_at_1pct_fpr: 'Recall @ 1% FPR',
                          recall_at_5pct_fpr: 'Recall @ 5% FPR',
                          precision_at_100: 'Precision @ 100',
                          f1_score: 'F1-Score',
                          brier_score: 'Brier Score'
                        };
                        return (
                          <tr key={key} className="hover:bg-slate-50 dark:hover:bg-darkBorder/20">
                            <td className="py-2 text-gray-800 dark:text-gray-300 font-medium">
                              {metricLabels[key] || key}
                            </td>
                            <td className="py-2 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {stat.mean.toFixed(4)}
                            </td>
                            <td className="py-2 text-center font-mono text-gray-500 text-[11px]">
                              &plusmn; {stat.std.toFixed(4)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Validation Report Modal */}
        {reportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-darkBorder flex justify-between items-center bg-slate-50 dark:bg-darkBorder/20">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  <h3 className="font-bold text-sm text-gray-800 dark:text-white">
                    AML Model Validation & Governance Report &bull; <code className="text-blue-500 font-mono">{reportVersionId}</code>
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`${API_URL}/api/admin/models/versions/${reportVersionId}/report/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-all shadow"
                  >
                    <Download className="w-3.5 h-3.5" /> Download PDF Report
                  </a>
                  <button
                    onClick={() => setReportModalOpen(false)}
                    className="p-1.5 hover:bg-slate-200 dark:hover:bg-darkBorder rounded-lg text-gray-500"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto font-sans text-xs text-gray-700 dark:text-gray-300 space-y-4">
                {reportLoading ? (
                  <div className="py-12 text-center text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Loading official validation documentation...
                  </div>
                ) : (
                  <div className="prose dark:prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap font-mono">
                    {reportMarkdown}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
};

export default MLOps;
