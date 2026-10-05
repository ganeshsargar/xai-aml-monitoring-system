import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import GraphView from '../components/GraphView';
import { 
  Briefcase, 
  User, 
  Calendar, 
  FolderPlus, 
  FileText, 
  Download, 
  MessageSquare,
  FileCheck,
  Paperclip,
  CheckCircle,
  Eye,
  GitMerge,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Send,
  X,
  FileSpreadsheet,
  CheckSquare,
  Share2,
  Lock,
  FileCode,
  Save,
  FilePlus
} from 'lucide-react';

const Cases = () => {
  const { API_URL, user } = useContext(AuthContext);
  const [casesList, setCasesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'str'

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Notes and Evidence form fields
  const [noteText, setNoteText] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);

  // Graph state for the selected case
  const [graphElements, setGraphElements] = useState([]);
  const [graphSummary, setGraphSummary] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [inspectNode, setInspectNode] = useState(null);

  // Merge Case Modal
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [sourceCaseId, setSourceCaseId] = useState('');
  const [mergeRationale, setMergeRationale] = useState('');

  // STR Regulatory State
  const [caseSTR, setCaseSTR] = useState(null);
  const [strLoading, setStrLoading] = useState(false);
  const [narrativeEdit, setNarrativeEdit] = useState('');
  const [suspicionCode, setSuspicionCode] = useState('G01');
  const [isAckModalOpen, setIsAckModalOpen] = useState(false);
  const [ackRefInput, setAckRefInput] = useState('');
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState('');

  const fetchCases = async () => {
    try {
      setLoading(true);
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (searchQuery) params.search = searchQuery;

      const res = await axios.get(`${API_URL}/api/cases`, { params });
      if (res.data.success) {
        setCasesList(res.data.data);
        // Reselect if already open
        if (selectedCase) {
          const updated = res.data.data.find(c => c.case_id === selectedCase.case_id);
          if (updated) setSelectedCase(updated);
        }
      }
    } catch (err) {
      console.error("Error fetching cases:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [statusFilter, searchQuery, API_URL]);

  // Load Graph for the selected Case
  useEffect(() => {
    const loadCaseGraph = async () => {
      if (!selectedCase) {
        setGraphElements([]);
        setGraphSummary(null);
        return;
      }

      try {
        setGraphLoading(true);
        setInspectNode(null);
        
        const res = await axios.get(`${API_URL}/api/cases/${selectedCase.case_id}/graph`);
        if (res.data && res.data.success && res.data.data) {
          setGraphElements(res.data.data.elements || []);
          setGraphSummary(res.data.data.summary || null);
        }
      } catch (err) {
        console.warn("Failed to load case graph from API. Using fallback:", err.message);
      } finally {
        setGraphLoading(false);
      }
    };

    loadCaseGraph();
  }, [selectedCase, API_URL]);

  const handleUpdateStatus = async (newStatus) => {
    if (!selectedCase) return;
    try {
      const res = await axios.put(`${API_URL}/api/cases/${selectedCase.case_id}/status`, { status: newStatus });
      if (res.data.success) {
        alert(`Case status updated to ${newStatus}`);
        fetchCases();
      }
    } catch (err) {
      alert("Failed to update status: " + (err.response?.data?.error || err.message));
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteText.trim() || !selectedCase) return;

    try {
      const res = await axios.post(`${API_URL}/api/cases/${selectedCase.case_id}/notes`, { text: noteText });
      if (res.data.success) {
        setNoteText('');
        fetchCases();
      }
    } catch (err) {
      alert("Failed to add note: " + (err.response?.data?.error || err.message));
    }
  };

  const handleUploadEvidence = async (e) => {
    e.preventDefault();
    if (!evidenceFile || !selectedCase) return;

    const formData = new FormData();
    formData.append('file', evidenceFile);

    try {
      const res = await axios.post(
        `${API_URL}/api/cases/${selectedCase.case_id}/evidence`, 
        formData, 
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      if (res.data.success) {
        setEvidenceFile(null);
        const fileInput = document.getElementById('evidence-upload');
        if (fileInput) fileInput.value = '';
        alert("Evidence file uploaded successfully.");
        fetchCases();
      }
    } catch (err) {
      alert("Failed to upload evidence: " + (err.response?.data?.error || err.message));
    }
  };

  const handleMergeSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCase || !sourceCaseId) return;

    try {
      const res = await axios.post(`${API_URL}/api/cases/${selectedCase.case_id}/merge`, {
        source_case_id: sourceCaseId,
        rationale: mergeRationale
      });

      if (res.data.success) {
        alert(res.data.message);
        setIsMergeModalOpen(false);
        setSourceCaseId('');
        setMergeRationale('');
        fetchCases();
      }
    } catch (err) {
      alert("Merge failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleDownloadPDFReport = () => {
    if (!selectedCase) return;
    
    axios.get(`${API_URL}/api/cases/${selectedCase.case_id}/report`, { 
      responseType: 'blob' 
    })
    .then(res => {
      const file = new Blob([res.data], { type: 'application/pdf' });
      const fileURL = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = fileURL;
      link.setAttribute('download', `AML_CaseReport_${selectedCase.case_id}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    })
    .catch(err => {
      alert("Failed to download PDF report: " + err.message);
    });
  };

  // Fetch STR for the current case
  const fetchCaseSTR = async (caseId) => {
    if (!caseId) return;
    try {
      setStrLoading(true);
      const res = await axios.get(`${API_URL}/api/reports/str`, { params: { case_id: caseId } });
      if (res.data && res.data.length > 0) {
        const found = res.data[0];
        setCaseSTR(found);
        setNarrativeEdit(found.narrative || '');
        setSuspicionCode(found.ground_for_suspicion_code || 'G01');
      } else {
        setCaseSTR(null);
        setNarrativeEdit('');
      }
    } catch (err) {
      console.warn("Could not fetch STR for case:", err.message);
    } finally {
      setStrLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCase) {
      fetchCaseSTR(selectedCase.case_id);
    } else {
      setCaseSTR(null);
    }
  }, [selectedCase, API_URL]);

  const handleGenerateSTR = async () => {
    if (!selectedCase) return;
    try {
      setStrLoading(true);
      const res = await axios.post(`${API_URL}/api/reports/str/generate`, { case_id: selectedCase.case_id });
      if (res.data.str) {
        setCaseSTR(res.data.str);
        setNarrativeEdit(res.data.str.narrative || '');
        setSuspicionCode(res.data.str.ground_for_suspicion_code || 'G01');
        alert("STR draft generated successfully with deterministic AML narrative!");
        fetchCases();
      }
    } catch (err) {
      alert("Failed to generate STR: " + (err.response?.data?.error || err.message));
    } finally {
      setStrLoading(false);
    }
  };

  const handleSaveSTR = async () => {
    if (!caseSTR) return;
    try {
      setStrLoading(true);
      const res = await axios.put(`${API_URL}/api/reports/str/${caseSTR.str_id}`, {
        narrative: narrativeEdit,
        ground_for_suspicion_code: suspicionCode
      });
      if (res.data.str) {
        setCaseSTR(res.data.str);
        alert("STR draft changes saved successfully.");
      }
    } catch (err) {
      alert("Failed to save STR: " + (err.response?.data?.error || err.message));
    } finally {
      setStrLoading(false);
    }
  };

  const handleApproveSTR = async () => {
    if (!caseSTR) return;
    try {
      const res = await axios.post(`${API_URL}/api/reports/str/${caseSTR.str_id}/approve`);
      if (res.data.str) {
        setCaseSTR(res.data.str);
        alert("STR approved successfully under Four-Eyes validation policy!");
        fetchCases();
      }
    } catch (err) {
      alert("Approval Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleFileSTR = async (e) => {
    e.preventDefault();
    if (!caseSTR) return;
    try {
      const res = await axios.post(`${API_URL}/api/reports/str/${caseSTR.str_id}/file`, {
        acknowledgement_reference: ackRefInput
      });
      if (res.data.str) {
        setCaseSTR(res.data.str);
        setIsAckModalOpen(false);
        setAckRefInput('');
        alert("STR successfully marked as FILED with FIU-IND! Case status updated to Closed (True Positive - STR Filed).");
        fetchCases();
      }
    } catch (err) {
      alert("Filing Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleRejectSTR = async (e) => {
    e.preventDefault();
    if (!caseSTR) return;
    try {
      const res = await axios.post(`${API_URL}/api/reports/str/${caseSTR.str_id}/reject`, {
        reason: rejectReasonInput
      });
      if (res.data.str) {
        setCaseSTR(res.data.str);
        setIsRejectModalOpen(false);
        setRejectReasonInput('');
        alert("STR marked as REJECTED.");
        fetchCases();
      }
    } catch (err) {
      alert("Rejection Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleExportSTR = (format) => {
    if (!caseSTR) return;
    if (format === 'pdf') {
      window.open(`${API_URL}/api/reports/str/${caseSTR.str_id}/pdf`, '_blank');
    } else {
      window.open(`${API_URL}/api/reports/str/${caseSTR.str_id}/export?format=${format}`, '_blank');
    }
  };

  // Compile combined activity chronology (timeline events + legacy notes)
  const combinedChronology = React.useMemo(() => {
    if (!selectedCase) return [];
    const events = [];

    // Structured timeline entries
    if (Array.isArray(selectedCase.timeline)) {
      for (const t of selectedCase.timeline) {
        events.push({
          type: t.event_type || 'system',
          user: t.user || 'System',
          role: t.role || 'Investigator',
          action: t.action,
          details: t.details,
          timestamp: t.timestamp
        });
      }
    }

    // Legacy notes (if not in timeline)
    if (Array.isArray(selectedCase.notes) && (!selectedCase.timeline || selectedCase.timeline.length === 0)) {
      for (const n of selectedCase.notes) {
        events.push({
          type: 'note',
          user: n.investigator,
          role: 'Investigator',
          action: 'Note Added',
          details: n.text,
          timestamp: n.timestamp
        });
      }
    }

    // Sort descending by timestamp
    return events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [selectedCase]);

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Investigation Case Management" />

      <main className="p-8 space-y-8">
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Left panel: Cases Registry List */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Case Files ({casesList.length})
              </h4>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2 py-1 bg-gray-100 dark:bg-darkBg border border-transparent rounded text-[10px] font-semibold text-gray-600 dark:text-gray-300 outline-none"
              >
                <option value="">All Statuses</option>
                <option value="Open">Open</option>
                <option value="Under Review">Under Review</option>
                <option value="Pending STR">Pending STR</option>
                <option value="Closed">Closed</option>
              </select>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-darkBorder space-y-1">
              {loading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="py-4 space-y-2">
                    <div className="h-4 w-32 skeleton" />
                    <div className="h-3 w-48 skeleton" />
                  </div>
                ))
              ) : casesList.length > 0 ? (
                casesList.map((c) => (
                  <div
                    key={c.case_id}
                    onClick={() => setSelectedCase(c)}
                    className={`p-3.5 rounded-xl cursor-pointer transition-all ${
                      selectedCase?.case_id === c.case_id 
                        ? 'bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 shadow-sm' 
                        : 'hover:bg-gray-100 dark:hover:bg-darkBorder/40 border border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <h5 className="font-semibold text-xs text-gray-800 dark:text-gray-200 truncate max-w-[180px]">
                        {c.title}
                      </h5>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        c.status === 'Open' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300' :
                        c.status === 'Under Review' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                        c.status === 'Pending STR' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' :
                        'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                      }`}>
                        {c.status}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-gray-400 mt-2 font-semibold">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {c.assigned_to || 'Unassigned'}
                      </span>
                      <span className="font-mono text-gray-500">{c.case_id}</span>
                    </div>

                    {c.merged_into_case_id && (
                      <div className="mt-1.5 text-[9px] text-purple-600 dark:text-purple-400 font-bold flex items-center gap-1">
                        <GitMerge className="w-3 h-3" /> Merged into {c.merged_into_case_id}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-16 text-gray-400 text-xs">
                  No active case files found.
                </div>
              )}
            </div>
          </div>

          {/* Right panel: Active Case Details (Col-span-2) */}
          <div className="lg:col-span-2 space-y-6">
            {selectedCase ? (
              <div className="space-y-6 animate-fade-in">
                
                {/* Case File Header Card */}
                <div className="glass-panel p-6 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-blue-500/5 to-indigo-500/5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-blue-500" />
                      <span className="text-[10px] uppercase font-extrabold text-gray-400 tracking-wider">
                        AML Investigation Case File
                      </span>
                      {selectedCase.merged_cases && selectedCase.merged_cases.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                          <GitMerge className="w-3 h-3" /> {selectedCase.merged_cases.length} Merged Case(s)
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white mt-1">
                      {selectedCase.title}
                    </h3>
                    <p className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                      <span>ID: <b className="font-mono font-bold text-gray-700 dark:text-gray-300">{selectedCase.case_id}</b></span>
                      <span>•</span>
                      <span>Created: {new Date(selectedCase.createdAt).toLocaleString()}</span>
                      <span>•</span>
                      <span>Linked Alerts: <b>{(selectedCase.alerts || []).length}</b></span>
                    </p>
                  </div>

                  {/* Actions (Status change, Merge & Report) */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleDownloadPDFReport}
                      className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-lg transition-all shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" /> PDF Report
                    </button>

                    <button
                      onClick={() => setIsMergeModalOpen(true)}
                      className="flex items-center gap-1 px-3 py-2 border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 text-purple-700 dark:text-purple-300 text-xs font-semibold rounded-lg transition-all"
                    >
                      <GitMerge className="w-3.5 h-3.5" /> Merge Case
                    </button>
                    
                    {/* Status change select */}
                    <select
                      value={selectedCase.status}
                      onChange={(e) => handleUpdateStatus(e.target.value)}
                      className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg text-xs font-bold outline-none text-gray-700 dark:text-gray-300 cursor-pointer"
                    >
                      <option value="Open">Open</option>
                      <option value="Under Review">Under Review</option>
                      <option value="Pending STR">Pending STR</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>
                </div>

                {/* Case Navigation Tabs */}
                <div className="flex border-b border-gray-200 dark:border-darkBorder gap-2">
                  <button
                    onClick={() => setActiveTab('overview')}
                    className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
                      activeTab === 'overview'
                        ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                        : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" /> Investigation & Graph
                  </button>
                  <button
                    onClick={() => setActiveTab('str')}
                    className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
                      activeTab === 'str'
                        ? 'border-rose-600 text-rose-600 dark:text-rose-400 dark:border-rose-400'
                        : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" /> STR Regulatory Filing (FIU-IND)
                    {caseSTR ? (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                        caseSTR.status === 'Filed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                        caseSTR.status === 'Pending Approval' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                        caseSTR.status === 'Rejected' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                        'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                      }`}>
                        {caseSTR.status}
                      </span>
                    ) : (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-200 text-gray-700 dark:bg-darkBorder dark:text-gray-300">
                        Not Drafted
                      </span>
                    )}
                  </button>
                </div>

                {activeTab === 'overview' ? (
                  <>
                    {/* Graph Analytics Visualizer widget */}
                    <div className="glass-panel p-6 space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                          Money Flow Network Analytics (NetworkX & Cytoscape)
                        </h4>
                        {graphSummary && (
                          <span className="text-[10px] bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 font-bold px-2 py-0.5 rounded">
                            Loops: {graphSummary.cycles_count} | Communities: {graphSummary.num_communities}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Graph Canvas */}
                        <div className="md:col-span-3 h-[420px]">
                          {graphLoading ? (
                            <div className="w-full h-full skeleton flex items-center justify-center text-xs text-gray-400">
                              Mapping network connections...
                            </div>
                          ) : (
                            <GraphView 
                              elements={graphElements} 
                              onNodeClick={(node) => setInspectNode(node)} 
                            />
                          )}
                        </div>

                        {/* Node Inspector */}
                        <div className="md:col-span-1 p-3.5 bg-gray-50 dark:bg-darkBg/60 border border-gray-100 dark:border-darkBorder rounded-xl space-y-3 text-xs overflow-y-auto max-h-[420px]">
                          <h5 className="font-bold text-gray-400 uppercase text-[10px] tracking-wider pb-1 border-b border-gray-200/50 dark:border-darkBorder/40">
                            Node Inspector
                          </h5>
                          {inspectNode ? (
                            <div className="space-y-2.5">
                              <div>
                                <span className="text-gray-400 block text-[9px] uppercase">Account</span>
                                <b className="font-mono text-gray-800 dark:text-white">{inspectNode.account_number}</b>
                              </div>
                              <div>
                                <span className="text-gray-400 block text-[9px] uppercase">Holder</span>
                                <b className="text-gray-800 dark:text-white">{inspectNode.holder_name}</b>
                              </div>
                              <div>
                                <span className="text-gray-400 block text-[9px] uppercase">Risk Level</span>
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300">
                                  {inspectNode.risk_level || 'High'} ({inspectNode.max_risk_score || 0}%)
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-center py-16 text-gray-400 italic text-[11px]">
                              Click any node to inspect account attributes.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Activity Timeline & Evidence Split */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Activity Timeline Panel */}
                      <div className="glass-panel p-6 space-y-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-blue-500" />
                            Investigation Activity Timeline
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {combinedChronology.length} events
                          </span>
                        </h4>
                        
                        {/* Add note form */}
                        <form onSubmit={handleAddNote} className="flex gap-2">
                          <input
                            type="text"
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="Add compliance notes or progress update..."
                            className="flex-1 px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg text-xs outline-none transition-all"
                            required
                          />
                          <button
                            type="submit"
                            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-lg transition-all flex items-center gap-1"
                          >
                            <Send className="w-3 h-3" />
                          </button>
                        </form>

                        {/* Timeline Feed */}
                        <div className="relative pl-5 space-y-3.5 max-h-72 overflow-y-auto pr-1">
                          {combinedChronology.length > 0 ? (
                            <>
                              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-200 dark:bg-darkBorder/60" />
                              {combinedChronology.map((event, idx) => (
                                <div key={idx} className="relative text-xs space-y-1">
                                  <div className={`absolute -left-[17px] top-1 w-3 h-3 rounded-full border-2 bg-white dark:bg-darkPanel ${
                                    event.type === 'case_merged' ? 'border-purple-500 bg-purple-50' :
                                    event.type === 'status_change' ? 'border-orange-500 bg-orange-50' :
                                    event.type === 'evidence' ? 'border-emerald-500 bg-emerald-50' :
                                    'border-blue-500 bg-blue-50'
                                  }`} />
                                  
                                  <div className="flex items-center gap-2 text-[10px] text-gray-400 font-semibold flex-wrap">
                                    <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${
                                      event.type === 'case_merged' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300' :
                                      event.type === 'status_change' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' :
                                      event.type === 'evidence' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                                      'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                    }`}>
                                      {event.action}
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-300">by {event.user}</span>
                                    <span className="ml-auto text-[9px] text-gray-400">
                                      {new Date(event.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed text-[11px] pl-1">
                                    {event.details}
                                  </p>
                                </div>
                              ))}
                            </>
                          ) : (
                            <div className="text-center py-8 text-xs text-gray-400 italic">
                              No activity timeline entries recorded yet.
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Evidence Attachments Panel */}
                      <div className="glass-panel p-6 space-y-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Paperclip className="w-3.5 h-3.5 text-blue-500" />
                            Evidence Artifacts
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {(selectedCase.evidence || []).length} files
                          </span>
                        </h4>

                        {/* Upload Form */}
                        <form onSubmit={handleUploadEvidence} className="space-y-3">
                          <input
                            type="file"
                            id="evidence-upload"
                            onChange={(e) => setEvidenceFile(e.target.files[0])}
                            className="w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400 file:cursor-pointer"
                            required
                          />
                          <button
                            type="submit"
                            className="w-full py-2 bg-gray-100 hover:bg-gray-200 dark:bg-darkBorder/60 dark:hover:bg-darkBorder text-xs font-semibold text-gray-700 dark:text-gray-300 rounded-lg transition-all"
                          >
                            Upload Compliance Document
                          </button>
                        </form>

                        {/* Attachments List */}
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {selectedCase.evidence && selectedCase.evidence.length > 0 ? (
                            selectedCase.evidence.map((file, idx) => (
                              <div key={idx} className="p-2.5 bg-gray-50 dark:bg-darkBg/30 border border-gray-100 dark:border-darkBorder/40 rounded-lg text-xs space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <span className="font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[180px]" title={file.originalName}>
                                    {file.originalName}
                                  </span>
                                  <a
                                    href={`${API_URL}/uploads/${file.filename}`}
                                    download={file.originalName}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:text-blue-600 font-bold flex items-center gap-0.5"
                                  >
                                    <Download className="w-3.5 h-3.5" /> Get
                                  </a>
                                </div>
                                {file.checksum_sha256 && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono bg-white dark:bg-darkBg/60 px-2 py-0.5 rounded border border-gray-100 dark:border-darkBorder/30">
                                    <span className="text-emerald-500 font-bold">SHA-256:</span>
                                    <span className="truncate" title={file.checksum_sha256}>{file.checksum_sha256}</span>
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-8 text-xs text-gray-400 italic">
                              No compliance files uploaded yet.
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  </>
                ) : (
                  /* ========================================================= */
                  /* STR REGULATORY FILING WORKFLOW TAB */
                  /* ========================================================= */
                  <div className="space-y-6 animate-fade-in">
                    {!caseSTR ? (
                      <div className="glass-panel p-12 text-center space-y-4">
                        <FileText className="w-12 h-12 text-rose-500 mx-auto" />
                        <h4 className="text-base font-bold text-gray-800 dark:text-white">
                          No Suspicious Transaction Report Drafted
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
                          Generate a formal FIU-IND Form STR-1 draft. FundTraceAI will compile subject profile, linked accounts, transaction schedules, detected AML typologies, and an auto-drafted deterministic narrative without external LLM dependencies.
                        </p>
                        <button
                          onClick={handleGenerateSTR}
                          disabled={strLoading}
                          className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-900/20 transition-all inline-flex items-center gap-2"
                        >
                          <FilePlus className="w-4 h-4" />
                          {strLoading ? 'Compiling STR Draft...' : 'Generate Deterministic STR Draft'}
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* STR Metadata Header */}
                        <div className="glass-panel p-5 bg-gradient-to-r from-rose-500/10 via-amber-500/5 to-indigo-500/5 border-l-4 border-l-rose-500 flex flex-wrap items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-extrabold px-2 py-0.5 bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 rounded">
                                {caseSTR.str_id}
                              </span>
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                FIU-IND Form STR-1 Draft
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                caseSTR.status === 'Filed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                                caseSTR.status === 'Pending Approval' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                                caseSTR.status === 'Rejected' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                                'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                              }`}>
                                {caseSTR.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap pt-1">
                              <span>Preparer: <b className="text-gray-700 dark:text-gray-300">{caseSTR.prepared_by || 'Investigator'}</b></span>
                              <span>•</span>
                              <span>Approver: <b className="text-gray-700 dark:text-gray-300">{caseSTR.approved_by || 'Pending Review'}</b></span>
                              <span>•</span>
                              <span className={caseSTR.is_overdue ? 'text-red-600 font-bold' : ''}>
                                Due Date: <b>{new Date(caseSTR.due_date).toLocaleDateString('en-IN')}</b>
                                {caseSTR.is_overdue && ' (OVERDUE)'}
                              </span>
                            </div>
                            {caseSTR.filing_date && (
                              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold pt-1">
                                Filed on {new Date(caseSTR.filing_date).toLocaleString()} | Ack Ref: <span className="font-mono font-bold">{caseSTR.acknowledgement_reference}</span>
                              </div>
                            )}
                          </div>

                          {/* Export Action Buttons */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleExportSTR('pdf')}
                              className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white dark:bg-darkBorder dark:hover:bg-gray-800 text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm"
                            >
                              <Download className="w-3.5 h-3.5" /> PDF
                            </button>
                            <button
                              onClick={() => handleExportSTR('xml')}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm"
                            >
                              <FileCode className="w-3.5 h-3.5" /> XML
                            </button>
                            <button
                              onClick={() => handleExportSTR('json')}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" /> JSON
                            </button>
                          </div>
                        </div>

                        {/* Subject & Ground for Suspicion Card */}
                        <div className="glass-panel p-6 space-y-4">
                          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder">
                            Subject Profile & Suspicion Classification
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                            <div className="p-3 bg-gray-50 dark:bg-darkBg rounded-lg">
                              <span className="text-gray-400 block text-[10px] uppercase font-bold">Primary Subject</span>
                              <b className="text-gray-800 dark:text-white text-sm">{caseSTR.subject?.name || 'N/A'}</b>
                              <div className="text-gray-500 text-[11px] mt-1 font-mono">ID: {caseSTR.subject?.customer_id || 'N/A'}</div>
                            </div>
                            <div className="p-3 bg-gray-50 dark:bg-darkBg rounded-lg">
                              <span className="text-gray-400 block text-[10px] uppercase font-bold">KYC & PEP Status</span>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 rounded font-bold text-[10px]">
                                  {caseSTR.subject?.kyc_risk_rating || 'High'} Risk
                                </span>
                                {caseSTR.subject?.is_pep && (
                                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-[10px]">
                                    PEP
                                  </span>
                                )}
                              </div>
                              <div className="text-gray-500 text-[10px] mt-1">
                                Linked Accounts: {(caseSTR.linked_accounts || []).join(', ') || 'N/A'}
                              </div>
                            </div>
                            <div className="p-3 bg-gray-50 dark:bg-darkBg rounded-lg">
                              <span className="text-gray-400 block text-[10px] uppercase font-bold">Grounds for Suspicion (PMLA)</span>
                              <select
                                value={suspicionCode}
                                onChange={(e) => setSuspicionCode(e.target.value)}
                                disabled={caseSTR.status === 'Filed'}
                                className="w-full mt-1.5 px-2 py-1.5 bg-white dark:bg-darkPanel border border-gray-200 dark:border-darkBorder rounded text-xs font-bold text-gray-700 dark:text-gray-200 outline-none"
                              >
                                <option value="G01">G01 - Unusual Volume / Velocity Out of Profile</option>
                                <option value="G02">G02 - Rapid Movement of Funds / Pass-Through Mule</option>
                                <option value="G03">G03 - Structuring / Smurfing below Cash Threshold</option>
                                <option value="G04">G04 - Transactions with High-Risk Geography</option>
                                <option value="G05">G05 - Sanctions / PEP Watchlist True Match</option>
                                <option value="G06">G06 - Multi-hop Graph Cycle / Wash Trading Loop</option>
                                <option value="G07">G07 - Shared Device / IP Funnel Network Ring</option>
                                <option value="G08">G08 - Inconsistent with Declared Occupation/Income</option>
                              </select>
                            </div>
                          </div>

                          {/* Exposure Summary Banner */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                            <div className="p-3 rounded-lg border border-gray-100 dark:border-darkBorder bg-gray-50/50 dark:bg-darkBg/40">
                              <span className="text-[10px] text-gray-400 font-bold block uppercase">Total Reported Flow</span>
                              <b className="text-sm text-gray-800 dark:text-white">INR {(caseSTR.total_amount || 0).toLocaleString('en-IN')}</b>
                            </div>
                            <div className="p-3 rounded-lg border border-gray-100 dark:border-darkBorder bg-gray-50/50 dark:bg-darkBg/40">
                              <span className="text-[10px] text-gray-400 font-bold block uppercase">Reported Tx Count</span>
                              <b className="text-sm text-gray-800 dark:text-white">{caseSTR.transaction_count || 0} Transactions</b>
                            </div>
                            <div className="p-3 rounded-lg border border-gray-100 dark:border-darkBorder bg-gray-50/50 dark:bg-darkBg/40">
                              <span className="text-[10px] text-gray-400 font-bold block uppercase">Detected Typologies</span>
                              <b className="text-sm text-rose-600">{(caseSTR.detected_typologies || []).length} Typologies</b>
                            </div>
                            <div className="p-3 rounded-lg border border-gray-100 dark:border-darkBorder bg-gray-50/50 dark:bg-darkBg/40">
                              <span className="text-[10px] text-gray-400 font-bold block uppercase">Reporting Entity</span>
                              <b className="text-xs text-gray-700 dark:text-gray-300 font-mono">RE-IN-BAN-00941</b>
                            </div>
                          </div>
                        </div>

                        {/* Narrative Editor */}
                        <div className="glass-panel p-6 space-y-4">
                          <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
                            <div>
                              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                                Deterministic STR Narrative Editor
                              </h4>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                // DRAFT FOR ANALYST EDIT - FIU-IND REGULATORY STR NARRATIVE (Generated deterministically from case models, graph loops, and rule hits)
                              </p>
                            </div>
                            {caseSTR.status !== 'Filed' && (
                              <button
                                onClick={handleSaveSTR}
                                disabled={strLoading}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-all shadow-sm flex items-center gap-1"
                              >
                                <Save className="w-3.5 h-3.5" /> Save Changes
                              </button>
                            )}
                          </div>

                          <textarea
                            rows={14}
                            value={narrativeEdit}
                            onChange={(e) => setNarrativeEdit(e.target.value)}
                            disabled={caseSTR.status === 'Filed'}
                            className="w-full p-4 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-xl text-xs font-mono text-gray-800 dark:text-gray-200 outline-none leading-relaxed focus:border-blue-500 resize-y"
                            placeholder="Regulatory narrative..."
                          />
                        </div>

                        {/* Four-Eyes Approval & Regulatory Filing Action Bar */}
                        <div className="glass-panel p-5 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-gray-50 to-blue-50/30 dark:from-darkPanel dark:to-blue-950/20">
                          <div className="space-y-0.5">
                            <h5 className="font-bold text-xs text-gray-800 dark:text-white flex items-center gap-1.5">
                              <ShieldCheck className="w-4 h-4 text-emerald-500" />
                              Four-Eyes Compliance Workflow & Filing Actions
                            </h5>
                            <p className="text-[10px] text-gray-400">
                              Enforcing FIU-IND dual verification. Approver cannot be identical to the preparer ({caseSTR.prepared_by || 'analyst'}).
                            </p>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Four-Eyes Approval Button */}
                            {caseSTR.status === 'Draft' || caseSTR.status === 'Rejected' ? (
                              <button
                                onClick={handleApproveSTR}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-sm"
                                title={user?.username === caseSTR.prepared_by ? 'Four-Eyes Principle: Approver must differ from Preparer' : ''}
                              >
                                <CheckSquare className="w-3.5 h-3.5" /> Approve STR (Four-Eyes)
                              </button>
                            ) : null}

                            {/* Mark as Filed Button */}
                            {caseSTR.status === 'Pending Approval' && (
                              <>
                                <button
                                  onClick={() => setIsAckModalOpen(true)}
                                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-sm"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" /> File with FIU-IND
                                </button>
                                <button
                                  onClick={() => setIsRejectModalOpen(true)}
                                  className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow-sm"
                                >
                                  <X className="w-3.5 h-3.5" /> Reject
                                </button>
                              </>
                            )}

                            {caseSTR.status === 'Filed' && (
                              <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold text-xs rounded-lg flex items-center gap-1">
                                <CheckCircle className="w-3.5 h-3.5" /> Regulatory Filing Complete
                              </span>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

              </div>
            ) : (
              <div className="glass-panel p-20 text-center text-gray-400 text-xs flex flex-col items-center justify-center space-y-2">
                <Briefcase className="w-10 h-10 text-gray-300" />
                <p className="font-semibold text-sm">No Investigation File Selected</p>
                <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
                  Select a case from the registry on the left to review network graph visualizer, activity timeline, and evidence documents.
                </p>
              </div>
            )}
          </div>

        </div>

      </main>

      {/* STR FIU Acknowledgement Modal */}
      {isAckModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                File STR with FIU-IND
              </h4>
              <button onClick={() => setIsAckModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleFileSTR} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  FIU-IND Acknowledgement Reference Number
                </label>
                <input
                  type="text"
                  value={ackRefInput}
                  onChange={(e) => setAckRefInput(e.target.value)}
                  placeholder="e.g. FIU-ACK-2026-990412"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none font-mono text-xs text-gray-700 dark:text-gray-200"
                />
                <p className="text-[10px] text-gray-400">Leave blank to auto-generate a provisional FIU acknowledgement token.</p>
              </div>

              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-[11px] text-emerald-800 dark:text-emerald-300">
                <p className="font-bold">Statutory Notice:</p>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                  Filing this STR will transition the report to "Filed", record the submission timestamp, and close the underlying Case as "True Positive - STR Filed".
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAckModalOpen(false)}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-md shadow-emerald-900/10"
                >
                  Confirm Filing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STR Reject Modal */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                Reject STR Draft
              </h4>
              <button onClick={() => setIsRejectModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRejectSTR} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Reason for Rejection
                </label>
                <textarea
                  rows={3}
                  value={rejectReasonInput}
                  onChange={(e) => setRejectReasonInput(e.target.value)}
                  placeholder="Explain why this STR is rejected (e.g. legitimate commercial explanation, insufficient evidence)..."
                  required
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none text-xs text-gray-700 dark:text-gray-200 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRejectModalOpen(false)}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-md shadow-red-900/10"
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Case Merge Modal */}
      {isMergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 bg-white dark:bg-darkPanel shadow-2xl rounded-2xl border border-gray-100 dark:border-darkBorder">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-1.5">
                <GitMerge className="w-4 h-4 text-purple-500" />
                Merge Case into {selectedCase?.case_id}
              </h4>
              <button 
                onClick={() => setIsMergeModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleMergeSubmit} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Select Source Case to Merge
                </label>
                <select
                  value={sourceCaseId}
                  onChange={(e) => setSourceCaseId(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none font-semibold text-gray-700 dark:text-gray-200"
                >
                  <option value="">-- Select Case to Merge --</option>
                  {casesList
                    .filter(c => c.case_id !== selectedCase?.case_id && c.status !== 'Closed')
                    .map(c => (
                      <option key={c.case_id} value={c.case_id}>
                        {c.case_id} - {c.title} ({c.status})
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block uppercase text-[10px]">
                  Merge Justification & Rationale
                </label>
                <textarea
                  rows={3}
                  value={mergeRationale}
                  onChange={(e) => setMergeRationale(e.target.value)}
                  placeholder="Explain why these investigations are interconnected (e.g. shared counterparties, identical mule network)..."
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-darkBg border border-gray-200 dark:border-darkBorder rounded-lg outline-none text-xs text-gray-700 dark:text-gray-200 resize-none"
                />
              </div>

              <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-[11px] text-purple-700 dark:text-purple-300">
                <p className="font-bold">Merge Consequence:</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  All alerts, evidence attachments, and timeline events from the source case will be consolidated into {selectedCase?.case_id}. The source case will be closed with a cross-reference link.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsMergeModalOpen(false)}
                  className="flex-1 py-2 border border-gray-200 dark:border-darkBorder hover:bg-gray-100 dark:hover:bg-darkBorder text-gray-600 dark:text-gray-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold shadow-md shadow-purple-900/10"
                >
                  Confirm Case Merge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Cases;
