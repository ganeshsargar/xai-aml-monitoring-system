import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  FileSpreadsheet,
  Trash2,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
  Clock,
  Hash,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

export default function TemplateManager({ API_URL }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/uploads/mapping-templates`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (res.data.success) {
        setTemplates(res.data.templates || []);
      }
    } catch (err) {
      console.error('Failed to load mapping templates:', err);
      setFeedback({ type: 'error', message: 'Failed to load templates: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, [API_URL]);

  const handleDeleteTemplate = async (templateId, templateName) => {
    if (!window.confirm(`Are you sure you want to delete the mapping template "${templateName}"?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await axios.delete(`${API_URL}/api/uploads/mapping-templates/${templateId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (res.data.success) {
        setFeedback({ type: 'success', message: `Template "${templateName}" deleted successfully.` });
        setTemplates(prev => prev.filter(t => t.template_id !== templateId));
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Delete failed: ' + (err.response?.data?.error || err.message) });
    }
  };

  return (
    <div className="space-y-4">
      {/* Feedback banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center justify-between border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
              : 'bg-red-500/10 border-red-500/30 text-red-500'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-gray-400 hover:text-gray-200">
            ×
          </button>
        </div>
      )}

      {/* Header with Refresh */}
      <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-darkBorder">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-500" /> Saved Column Mapping Templates
          </h4>
          <p className="text-[11px] text-gray-400">
            Templates are automatically matched and applied when an uploaded CSV shares the same header signature.
          </p>
        </div>
        <button
          onClick={fetchTemplates}
          disabled={loading}
          className="p-2 rounded-xl bg-gray-100 dark:bg-darkBg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 transition-all"
          title="Refresh Templates"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Template List */}
      {loading ? (
        <div className="py-12 flex justify-center items-center">
          <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-gray-200 dark:border-darkBorder rounded-2xl bg-gray-50/50 dark:bg-darkBg/20 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-gray-400 mx-auto" />
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            No Saved Mapping Templates Found
          </div>
          <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
            When you import a CSV, check "Remember this mapping for future files" to save a reusable template for that column signature.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {templates.map((tmpl) => {
            const isExpanded = expandedId === tmpl.template_id;
            return (
              <div
                key={tmpl.template_id}
                className="border border-gray-200 dark:border-darkBorder rounded-2xl p-4 bg-white dark:bg-darkBg/40 hover:border-blue-500/40 transition-all space-y-3 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                        {tmpl.template_name}
                      </span>
                      <span className="px-2 py-0.5 text-[9px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full">
                        {tmpl.headers_count || tmpl.headers?.length || 0} Columns
                      </span>
                      <span className="px-2 py-0.5 text-[9px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full">
                        Used {tmpl.usage_count} {tmpl.usage_count === 1 ? 'time' : 'times'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-[10px] text-gray-400">
                      <span className="flex items-center gap-1 font-mono">
                        <Hash className="w-3 h-3" /> Sig: {tmpl.source_signature?.substring(0, 12)}...
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Last used: {new Date(tmpl.last_used_at || tmpl.created_at).toLocaleDateString()}
                      </span>
                      {tmpl.created_by && (
                        <span>By: {tmpl.created_by}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : tmpl.template_id)}
                      className="px-2.5 py-1.5 text-[11px] font-semibold bg-gray-100 dark:bg-darkBg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg flex items-center gap-1 transition-all"
                    >
                      <span>{isExpanded ? 'Hide Mapping' : 'View Mapping'}</span>
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    <button
                      onClick={() => handleDeleteTemplate(tmpl.template_id, tmpl.template_name)}
                      className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                      title="Delete Template"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Mapping Table */}
                {isExpanded && tmpl.mapping && (
                  <div className="pt-3 border-t border-gray-100 dark:border-darkBorder animate-fade-in">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-2">
                      Configured Field Translations:
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs font-mono">
                      {Object.entries(tmpl.mapping)
                        .filter(([_, raw]) => Boolean(raw))
                        .map(([canonical, raw]) => (
                          <div
                            key={canonical}
                            className="p-2 bg-gray-50 dark:bg-darkBg rounded-lg border border-gray-100 dark:border-darkBorder"
                          >
                            <div className="text-[10px] text-gray-400 truncate">{canonical}</div>
                            <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 truncate">
                              ← {raw}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
