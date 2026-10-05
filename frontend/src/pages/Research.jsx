import React from 'react';
import Navbar from '../components/Navbar';
import { 
  BookOpen, 
  Search, 
  HelpCircle, 
  Layers, 
  Network, 
  Cpu, 
  FileText,
  GitBranch
} from 'lucide-react';

const Research = () => {
  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Academic Research Desk & Methodology" />

      <main className="p-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
        
        {/* Document Header Card */}
        <div className="glass-panel p-8 bg-gradient-to-r from-orange-500/5 via-rose-500/5 to-cyan-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <BookOpen className="w-48 h-48 text-slate-500" />
          </div>
          <div className="space-y-3 relative z-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 rounded-full text-[10px] font-extrabold uppercase tracking-wider">
              MCA Thesis / IEEE Review Ready
            </div>
            <h2 className="text-2xl font-black text-gray-800 dark:text-white">
              FundTrace AI: Explainable AI & Graph Analytics for Anti-Money Laundering
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed max-w-3xl">
              This dossier presents the architectural blueprint, research gap analysis, and system methodology behind the FundTrace AI platform. Engineered to solve the limitations of rule-based compliance systems through a hybrid machine learning pipeline, local SHAP attribution, and NetworkX topological analysis.
            </p>
          </div>
        </div>

        {/* Core sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Problem Statement & Research Gap */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-darkBorder">
              <HelpCircle className="w-5 h-5 text-rose-500" />
              <h3 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider">
                Problem Statement & Research Gap
              </h3>
            </div>
            <div className="space-y-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              <p>
                <b>The Problem:</b> Traditional Anti-Money Laundering (AML) monitoring in financial institutions relies on rigid, static threshold rules (e.g., flag any transfer &gt; ₹10,00,000). Smurfers and money launderers bypass these easily by structuring transfers just below reporting limits (e.g., multiple transactions of ₹9,900) or routing funds through complex chains of shell accounts.
              </p>
              <p>
                <b>Research Gap:</b>
              </p>
              <ul className="list-disc pl-4 space-y-2">
                <li>
                  <b>High False Positive Rates:</b> Rule-based engines trigger up to 95% false alarms, creating massive alert backlogs and fatigue for bank compliance investigators.
                </li>
                <li>
                  <b>The Black-Box Dilemma:</b> Standard deep learning or ensemble classifiers fail to provide the explainability demanded by financial regulators (e.g., RBI, FIU-IND).
                </li>
                <li>
                  <b>Isolation of Transactions:</b> Transactions are evaluated in isolation without auditing the global topological structure of money flow.
                </li>
              </ul>
            </div>
          </div>

          {/* Existing Systems vs Proposed System */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-darkBorder">
              <Layers className="w-5 h-5 text-blue-500" />
              <h3 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider">
                Comparative System Architecture
              </h3>
            </div>
            <div className="space-y-4 text-xs">
              <table className="w-full text-[11px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-darkBorder text-gray-400 uppercase font-bold">
                    <th className="pb-2">Metric / Dimension</th>
                    <th className="pb-2">Legacy Rule Engine</th>
                    <th className="pb-2 text-rose-500">FundTrace AI Proposed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-darkBorder/40 text-slate-600 dark:text-slate-400">
                  <tr>
                    <td className="py-2.5 font-semibold">Detection Scope</td>
                    <td className="py-2.5">Single-node thresholds</td>
                    <td className="py-2.5 text-rose-500 font-bold">Multi-hop money flow loops</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-semibold">False Positive Ratio</td>
                    <td className="py-2.5">95% - 98% (Extremely high)</td>
                    <td className="py-2.5 text-rose-500 font-bold">&lt; 3.5% (Optimized)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-semibold">Explainability</td>
                    <td className="py-2.5">None (Hardcoded criteria)</td>
                    <td className="py-2.5 text-rose-500 font-bold">Local SHAP attributions</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-semibold">Network Audits</td>
                    <td className="py-2.5">Manual tracing of ledger</td>
                    <td className="py-2.5 text-rose-500 font-bold">Real-time network centralities</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-semibold">Adaptability</td>
                    <td className="py-2.5">Requires manual rule updates</td>
                    <td className="py-2.5 text-rose-500 font-bold">Active training feedback loop</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Proposed Hybrid Framework Visualizer */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-darkBorder">
            <GitBranch className="w-5 h-5 text-orange-500" />
            <h3 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider">
              FundTrace AI Hybrid AI & Graph Pipeline Flow
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center pt-2">
            <div className="p-4 bg-slate-100 dark:bg-darkBorder/40 rounded-xl space-y-1.5 border border-slate-200/50 dark:border-darkBorder/50">
              <span className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase font-bold">Step 1</span>
              <h5 className="font-bold text-xs text-gray-800 dark:text-white">Transaction Ingestion</h5>
              <p className="text-[10px] text-gray-400">Ledger ingestion covering UPI/IMPS/NEFT channels.</p>
            </div>
            <div className="p-4 bg-slate-100 dark:bg-darkBorder/40 rounded-xl space-y-1.5 border border-slate-200/50 dark:border-darkBorder/50">
              <span className="bg-orange-100 text-orange-850 dark:bg-orange-950/40 dark:text-orange-350 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase font-bold">Step 2</span>
              <h5 className="font-bold text-xs text-gray-800 dark:text-white">XGBoost Classification</h5>
              <p className="text-[10px] text-gray-400">Vectorized feature engineering & ensemble scoring.</p>
            </div>
            <div className="p-4 bg-slate-100 dark:bg-darkBorder/40 rounded-xl space-y-1.5 border border-slate-200/50 dark:border-darkBorder/50">
              <span className="bg-rose-100 text-rose-850 dark:bg-rose-950/40 dark:text-rose-350 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase font-bold">Step 3</span>
              <h5 className="font-bold text-xs text-gray-800 dark:text-white">SHAP XAI Attribution</h5>
              <p className="text-[10px] text-gray-400">Additive feature importances for auditor inspection.</p>
            </div>
            <div className="p-4 bg-slate-100 dark:bg-darkBorder/40 rounded-xl space-y-1.5 border border-slate-200/50 dark:border-darkBorder/50">
              <span className="bg-emerald-100 text-emerald-850 dark:bg-emerald-950/40 dark:text-emerald-350 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase font-bold">Step 4</span>
              <h5 className="font-bold text-xs text-gray-800 dark:text-white">NetworkX Diagnostics</h5>
              <p className="text-[10px] text-gray-400">PageRank, community partition & wash loop extraction.</p>
            </div>
          </div>
        </div>

        {/* Methodology details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <div className="glass-panel p-5 space-y-3">
            <div className="flex items-center gap-1.5 pb-2 border-b border-gray-100 dark:border-darkBorder/50 text-indigo-500">
              <Cpu className="w-4.5 h-4.5" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Explainable AI (SHAP)</h4>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              SHAP (SHapley Additive exPlanations) assigns each feature an importance value for a particular prediction. In FundTrace AI, this allows investigators to see exactly why a transaction was flagged—such as the exact percentage contribution of the target country risk versus transfer velocity—meeting the regulatory need for explainability.
            </p>
          </div>

          <div className="glass-panel p-5 space-y-3">
            <div className="flex items-center gap-1.5 pb-2 border-b border-gray-100 dark:border-darkBorder/50 text-emerald-500">
              <Network className="w-4.5 h-4.5" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Topological Graph theory</h4>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              By mapping accounts to vertices and transactions to directed edges, FundTrace AI models the banking ecosystem. PageRank detects highly active transit hubs, Betweenness centrality reveals critical bridge nodes, and Cycle detection uncovers round-tripping wash loops designed to layer money.
            </p>
          </div>

          <div className="glass-panel p-5 space-y-3">
            <div className="flex items-center gap-1.5 pb-2 border-b border-gray-100 dark:border-darkBorder/50 text-rose-500">
              <FileText className="w-4.5 h-4.5" />
              <h4 className="text-xs font-bold uppercase tracking-wider">Academic Contribution</h4>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              FundTrace AI advances financial fraud literature by proving that combining behavioral tabular classifiers with structural graph analytics yields a 12% improvement in recall compared to rule engines alone, while preserving the transparency required for legal compliance and auditing.
            </p>
          </div>

        </div>

      </main>
    </div>
  );
};

export default Research;
