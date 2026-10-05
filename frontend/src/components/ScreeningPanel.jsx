import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  ShieldAlert, 
  ShieldCheck, 
  UserCheck, 
  AlertTriangle, 
  FileText, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  ExternalLink,
  Info
} from 'lucide-react';

const ScreeningPanel = ({ 
  API_URL, 
  entityType = 'Transaction', 
  entityId = '', 
  names = [], // [{ label: 'Sender', name: 'John Doe' }]
  initialHits = [],
  onDecisionRecorded
}) => {
  const [hits, setHits] = useState(initialHits || []);
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [decisionModal, setDecisionModal] = useState(null); // { hit, decision: 'TrueMatch' | 'FalsePositive' }
  const [decisionNotes, setDecisionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sync hits when initialHits changes
  useEffect(() => {
    if (initialHits && initialHits.length > 0) {
      setHits(initialHits);
    }
  }, [initialHits]);

  // Fetch past decisions for these names
  const fetchDecisions = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/screening/decisions`, {
        params: { entity_id: entityId }
      });
      if (res.data.success) {
        setDecisions(res.data.data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (entityId) {
      fetchDecisions();
    }
  }, [entityId]);

  // On-demand screen names if initialHits was empty
  const handleRunScreening = async () => {
    try {
      setLoading(true);
      const allNewHits = [];
      for (const item of names) {
        if (!item.name) continue;
        const res = await axios.post(`${API_URL}/api/screening/screen`, {
          name: item.name
        });
        if (res.data.success && res.data.data.hits) {
          const tagged = res.data.data.hits.map(h => ({
            ...h,
            subject: item.label || 'Subject'
          }));
          allNewHits.push(...tagged);
        }
      }
      setHits(allNewHits);
      fetchDecisions();
    } catch (err) {
      console.error('Error running name screening:', err);
    } finally {
      setLoading(false);
    }
  };

  // Submit compliance decision
  const handleSaveDecision = async () => {
    if (!decisionModal) return;
    try {
      setSubmitting(true);
      const { hit, decision } = decisionModal;
      const res = await axios.post(`${API_URL}/api/screening/decisions`, {
        entity_type: entityType,
        entity_id: entityId,
        screened_name: hit.screened_name,
        matched_entity_id: hit.matched_entity_id,
        matched_name: hit.matched_name,
        list_type: hit.list_type,
        match_score: hit.match_score,
        decision,
        notes: decisionNotes
      });

      if (res.data.success) {
        setDecisionModal(null);
        setDecisionNotes('');
        // Update local hit status
        setHits(prev => prev.map(h => {
          if (h.screened_name === hit.screened_name && h.matched_entity_id === hit.matched_entity_id) {
            return {
              ...h,
              is_false_positive: decision === 'FalsePositive',
              status: decision === 'FalsePositive' ? 'FalsePositiveSuppressed' : 'ConfirmedTrueMatch'
            };
          }
          return h;
        }));
        fetchDecisions();
        if (onDecisionRecorded) onDecisionRecorded();
      }
    } catch (err) {
      alert('Failed to save decision: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const getListBadge = (type) => {
    if (type === 'Sanctions') {
      return 'bg-red-500/10 text-red-500 border-red-500/30';
    }
    if (type === 'PEP') {
      return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
    }
    return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
  };

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-darkBorder">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-500" />
          <h4 className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
            Watchlist & PEP Name Screening
          </h4>
        </div>
        <button
          onClick={handleRunScreening}
          disabled={loading}
          className="px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:text-blue-500 rounded-lg hover:bg-gray-100 dark:hover:bg-darkBg transition-all flex items-center gap-1.5"
          title="Re-run fuzzy screening"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          <span>Screen Again</span>
        </button>
      </div>

      {hits.length === 0 ? (
        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-center space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Zero Watchlist Hits</span>
          </div>
          <p className="text-[11px] text-gray-400">
            Names screened against global Sanctions (OFAC/UN), Politically Exposed Persons (PEP), and Adverse Media with fuzzy tolerance.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {hits.map((hit, idx) => {
            const isFp = hit.is_false_positive || hit.status === 'FalsePositiveSuppressed';
            const isConfirmed = hit.status === 'ConfirmedTrueMatch';

            return (
              <div 
                key={idx} 
                className={`p-3.5 rounded-xl border text-xs transition-all space-y-2.5 ${
                  isFp 
                    ? 'bg-gray-50/50 dark:bg-darkBg/30 border-gray-200/60 dark:border-darkBorder/40 opacity-70' 
                    : isConfirmed
                    ? 'bg-red-500/10 border-red-500/40'
                    : 'bg-rose-50/40 dark:bg-rose-950/10 border-rose-200/50 dark:border-rose-900/30'
                }`}
              >
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-gray-200 dark:bg-darkBorder text-gray-700 dark:text-gray-300">
                      {hit.subject || 'Subject'}
                    </span>
                    <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${getListBadge(hit.list_type)}`}>
                      {hit.list_type}
                    </span>
                    <span className="font-bold text-gray-800 dark:text-gray-200">
                      {hit.screened_name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-extrabold text-rose-500">
                      {hit.match_score}%
                    </span>
                    <span className="text-[10px] text-gray-400">
                      ({hit.match_type})
                    </span>
                  </div>
                </div>

                {/* Match details banner */}
                <div className="p-2.5 rounded-lg bg-white/70 dark:bg-darkBg/60 border border-gray-150 dark:border-darkBorder/50 space-y-1">
                  <div className="flex justify-between items-start text-[11px]">
                    <div>
                      <span className="text-gray-400 font-medium">Matched Target: </span>
                      <b className="text-gray-800 dark:text-gray-200 font-semibold">{hit.matched_name}</b>
                      {hit.matched_alias && (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 block">
                          Via alias: <span className="font-mono font-medium">{hit.matched_alias}</span>
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-gray-400">
                      ID: {hit.matched_entity_id}
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed pt-1">
                    {hit.reason}
                  </p>
                </div>

                {/* Status & Decision Actions */}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    {isFp ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-darkBorder/60 px-2 py-0.5 rounded">
                        <CheckCircle className="w-3 h-3 text-emerald-500" /> False Positive (Whitelisted)
                      </span>
                    ) : isConfirmed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-100 dark:bg-red-950/40 px-2 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-red-500" /> Confirmed Watchlist Target
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded">
                        <Info className="w-3 h-3 text-amber-500" /> Pending Compliance Review
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {!isConfirmed && (
                      <button
                        onClick={() => setDecisionModal({ hit, decision: 'TrueMatch' })}
                        className="px-2.5 py-1 text-[10px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-all"
                      >
                        Confirm Match
                      </button>
                    )}
                    {!isFp && (
                      <button
                        onClick={() => setDecisionModal({ hit, decision: 'FalsePositive' })}
                        className="px-2.5 py-1 text-[10px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-darkBorder hover:bg-gray-200 rounded-lg transition-all"
                      >
                        Mark False Positive
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Decision Justification Modal */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-white dark:bg-darkPanel border border-gray-200 dark:border-darkBorder rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-150 dark:border-darkBorder">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {decisionModal.decision === 'TrueMatch' ? 'Confirm True Match Decision' : 'Classify as False Positive'}
              </h3>
              <button
                onClick={() => setDecisionModal(null)}
                className="text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {decisionModal.decision === 'TrueMatch' 
                ? `Confirming that "${decisionModal.hit.screened_name}" is an accurate match for designated entity "${decisionModal.hit.matched_name}" (${decisionModal.hit.list_type}). This will elevate threat classification and mandate STR escalation.`
                : `Classifying "${decisionModal.hit.screened_name}" vs "${decisionModal.hit.matched_name}" as a False Positive. This pairing will be remembered in the compliance registry and suppressed from future alerts.`
              }
            </p>

            <div className="space-y-1.5 text-xs">
              <label className="font-semibold text-gray-600 dark:text-gray-400">
                Compliance Review Notes / Justification:
              </label>
              <textarea
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                placeholder="e.g. Identity verified via KYC documentation; different nationality and date of birth."
                className="w-full h-20 p-2.5 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl outline-none text-xs text-gray-800 dark:text-gray-200 resize-none focus:border-blue-500"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveDecision}
                disabled={submitting}
                className={`flex-1 py-2.5 text-xs font-bold text-white rounded-xl transition-all shadow-md ${
                  decisionModal.decision === 'TrueMatch'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {submitting ? 'Recording Audit...' : `Confirm ${decisionModal.decision}`}
              </button>
              <button
                onClick={() => setDecisionModal(null)}
                className="px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-darkBorder rounded-xl"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreeningPanel;
