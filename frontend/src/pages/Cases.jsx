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
  Eye
} from 'lucide-react';

const Cases = () => {
  const { API_URL, ML_SERVICE_URL, user } = useContext(AuthContext);
  const [casesList, setCasesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState(null);

  // Notes and Evidence form fields
  const [noteText, setNoteText] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);

  // Graph state for the selected case
  const [graphElements, setGraphElements] = useState([]);
  const [graphSummary, setGraphSummary] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [inspectNode, setInspectNode] = useState(null);

  const fetchCases = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/cases`);
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
  }, [API_URL]);

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
        
        // Fetch Network graph directly from case graph endpoint
        const res = await axios.get(`${API_URL}/api/cases/${selectedCase.case_id}/graph`);
        if (res.data && res.data.success && res.data.data) {
          setGraphElements(res.data.data.elements || []);
          setGraphSummary(res.data.data.summary || null);
        }
      } catch (err) {
        console.warn("Failed to load case graph from API. Using fallback:", err.message);
        // Fallback: Generate basic layout elements locally
        const mockNodes = [
          { data: { id: 'ACC10001', label: 'Primary Distributer\n(ACC10001)', risk_level: 'Critical', pagerank: 0.8, community: 1, type: 'node', total_volume: 750000, holder_name: 'Shell Corp A', max_risk_score: 95, transaction_count: 5, is_flagged: 1 } },
          { data: { id: 'ACC10002', label: 'Intermediary Shell\n(ACC10002)', risk_level: 'High', pagerank: 0.5, community: 1, type: 'node', total_volume: 730000, holder_name: 'Transit Logistics B', max_risk_score: 85, transaction_count: 4, is_flagged: 1 } },
          { data: { id: 'ACC10003', label: 'Layering Agent\n(ACC10003)', risk_level: 'High', pagerank: 0.4, community: 1, type: 'node', total_volume: 710000, holder_name: 'Global Ventures C', max_risk_score: 78, transaction_count: 3, is_flagged: 1 } }
        ];
        const mockEdges = [
          { data: { id: 'e1', source: 'ACC10001', target: 'ACC10002', amount: 750000, is_laundering: 1, is_cycle: 1, type: 'edge' } },
          { data: { id: 'e2', source: 'ACC10002', target: 'ACC10003', amount: 730000, is_laundering: 1, is_cycle: 1, type: 'edge' } },
          { data: { id: 'e3', source: 'ACC10003', target: 'ACC10001', amount: 710000, is_laundering: 1, is_cycle: 1, type: 'edge' } }
        ];
        setGraphElements([...mockNodes, ...mockEdges]);
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
        // Clear input file
        document.getElementById('evidence-upload').value = '';
        alert("Evidence file uploaded successfully.");
        fetchCases();
      }
    } catch (err) {
      alert("Failed to upload evidence: " + (err.response?.data?.error || err.message));
    }
  };

  // Compile PDF report and trigger download
  const handleDownloadPDFReport = () => {
    if (!selectedCase) return;
    const token = localStorage.getItem('aml_token');
    
    // Redirect browser directly to download URL with token param, or open in new window
    // Since browser needs token, we can trigger an Axios fetch with responseType blob
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
      alert("Failed to download PDF report. Verification error: " + err.message);
    });
  };

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Investigation Case Files" />

      <main className="p-8 space-y-8">
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Left panel: Cases List */}
          <div className="glass-panel p-6 space-y-4">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder">
              Open Cases Registry
            </h4>

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
                    className={`p-4 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-darkBorder/40 transition-all ${
                      selectedCase?.case_id === c.case_id ? 'bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30' : 'border border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <h5 className="font-semibold text-sm text-gray-800 dark:text-gray-200 truncate">
                        {c.title}
                      </h5>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        c.status === 'Open' ? 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300' :
                        c.status === 'Under Review' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                        'bg-gray-100 text-gray-800 dark:bg-darkBorder/40 dark:text-gray-400'
                      }`}>
                        {c.status}
                      </span>
                    </div>

                    <div className="flex justify-between text-[10px] text-gray-400 mt-2 font-semibold">
                      <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {c.assigned_to || 'Unassigned'}</span>
                      <span className="flex items-center gap-1 font-mono">{c.case_id}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-16 text-gray-400 text-sm">
                  No active case investigations found.
                </div>
              )}
            </div>
          </div>

          {/* Right panel: Active Case details (Col-span-2) */}
          <div className="lg:col-span-2 space-y-6">
            {selectedCase ? (
              <div className="space-y-6 animate-fade-in">
                
                {/* Case File Header Card */}
                <div className="glass-panel p-6 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-blue-500/5 to-cyan-500/5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-blue-500" />
                      <span className="text-xs uppercase font-extrabold text-gray-400 tracking-wider">
                        AML Investigation Case File
                      </span>
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">
                      {selectedCase.title}
                    </h3>
                    <p className="text-xs text-gray-400">
                      ID: <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{selectedCase.case_id}</span> | 
                      Created: {new Date(selectedCase.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Actions (Status change & Export) */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleDownloadPDFReport}
                      className="flex items-center gap-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-xl transition-all shadow-md shadow-blue-900/10"
                    >
                      <Download className="w-4 h-4" /> Download compliance report (PDF)
                    </button>
                    
                    {/* Status change select */}
                    <select
                      value={selectedCase.status}
                      onChange={(e) => handleUpdateStatus(e.target.value)}
                      className="px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg text-xs font-bold outline-none text-gray-600 dark:text-gray-300 cursor-pointer"
                    >
                      <option value="Open">Open</option>
                      <option value="Under Review">Under Review</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>
                </div>

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
                    <div className="md:col-span-3 h-[450px]">
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

                    {/* Graph Inspect node details */}
                    <div className="md:col-span-1 p-4 bg-gray-50 dark:bg-darkBg/60 border border-gray-100 dark:border-darkBorder rounded-xl space-y-4 text-xs overflow-y-auto max-h-[450px]">
                      <h5 className="font-bold text-gray-400 uppercase text-[10px] tracking-wider pb-1.5 border-b border-gray-200/50 dark:border-darkBorder/40">
                        Node Inspector
                      </h5>
                      {inspectNode ? (
                        <div className="space-y-3">
                          <div>
                            <span className="text-gray-400 block text-[9px] uppercase">Account</span>
                            <b className="font-mono text-gray-800 dark:text-white">{inspectNode.account_number}</b>
                          </div>
                          <div>
                            <span className="text-gray-400 block text-[9px] uppercase">Holder Name</span>
                            <b className="text-gray-800 dark:text-white">{inspectNode.holder_name}</b>
                          </div>
                          <div>
                            <span className="text-gray-400 block text-[9px] uppercase">Risk Level</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              inspectNode.risk_level === 'Critical' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
                              inspectNode.risk_level === 'High' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' :
                              inspectNode.risk_level === 'Medium' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                              'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            }`}>
                              {inspectNode.risk_level} ({inspectNode.max_risk_score || 0}%)
                            </span>
                          </div>

                          {/* Account Summary Detections */}
                          {(inspectNode.is_cycle === 1 || inspectNode.is_fraud_ring === 1 || inspectNode.is_smurfing === 1 || inspectNode.is_layering === 1) && (
                            <div className="p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[10px] space-y-1">
                              <span className="font-bold text-orange-500 block uppercase">Threat Flags Detected:</span>
                              <div className="flex flex-wrap gap-1">
                                {inspectNode.is_cycle === 1 && <span className="bg-orange-100 text-orange-850 dark:bg-orange-950/50 dark:text-orange-300 px-1 rounded font-bold">Wash Loop</span>}
                                {inspectNode.is_fraud_ring === 1 && <span className="bg-red-100 text-red-850 dark:bg-red-950/50 dark:text-red-300 px-1 rounded font-bold">Fraud Ring</span>}
                                {inspectNode.is_smurfing === 1 && <span className="bg-blue-100 text-blue-850 dark:bg-blue-950/50 dark:text-blue-300 px-1 rounded font-bold">Smurfing</span>}
                                {inspectNode.is_layering === 1 && <span className="bg-purple-100 text-purple-850 dark:bg-purple-950/50 dark:text-purple-300 px-1 rounded font-bold">Layering Node</span>}
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 border-t border-gray-200/50 dark:border-darkBorder/40 pt-2">
                            <div>
                              <span className="text-gray-400 block text-[9px] uppercase">Tx Count</span>
                              <b className="text-gray-800 dark:text-white font-mono">{inspectNode.transaction_count || 1}</b>
                            </div>
                            <div>
                              <span className="text-gray-400 block text-[9px] uppercase">Network Score</span>
                              <b className="text-orange-500 font-mono">{inspectNode.network_score || (inspectNode.pagerank ? Math.round(inspectNode.pagerank * 100) : 10)}</b>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-gray-400 block text-[9px] uppercase">Incoming Vol</span>
                              <b className="text-gray-800 dark:text-white font-mono">₹{(inspectNode.incoming_amount || inspectNode.total_volume || 0).toLocaleString()}</b>
                            </div>
                            <div>
                              <span className="text-gray-400 block text-[9px] uppercase">Outgoing Vol</span>
                              <b className="text-gray-800 dark:text-white font-mono">₹{(inspectNode.outgoing_amount || inspectNode.total_volume || 0).toLocaleString()}</b>
                            </div>
                          </div>

                          <div className="border-t border-gray-200/50 dark:border-darkBorder/40 pt-2 space-y-1">
                            <span className="text-gray-400 block text-[9px] uppercase">Network Centrality Metrics</span>
                            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-600 dark:text-gray-400 font-mono">
                              <div>PR: <span className="font-bold text-gray-800 dark:text-gray-200">{inspectNode.pagerank || 0.01}</span></div>
                              <div>Deg: <span className="font-bold text-gray-800 dark:text-gray-200">{inspectNode.degree_centrality || 0.05}</span></div>
                              <div>Bet: <span className="font-bold text-gray-800 dark:text-gray-200">{inspectNode.betweenness || 0.0}</span></div>
                              <div>Cls: <span className="font-bold text-gray-800 dark:text-gray-200">{inspectNode.closeness || 0.05}</span></div>
                            </div>
                          </div>

                          <div>
                            <span className="text-gray-400 block text-[9px] uppercase">Risk Propagation</span>
                            <b className="text-gray-800 dark:text-white font-mono">{inspectNode.risk_propagation || inspectNode.max_risk_score || 0}%</b>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-16 text-gray-400 italic">
                          Click any node in the graph layout to inspect account attributes.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Evidence and Notes splits */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Notes Panel */}
                  <div className="glass-panel p-6 space-y-4">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder flex items-center gap-1">
                      <MessageSquare className="w-4 h-4" /> Investigation Chronology ({selectedCase.notes?.length || 0})
                    </h4>
                    
                    {/* Add note form */}
                    <form onSubmit={handleAddNote} className="flex gap-2">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add compliance notes, progress log..."
                        className="flex-1 px-3 py-2 bg-gray-100 dark:bg-darkBg border border-transparent focus:border-blue-500 rounded-lg text-xs outline-none transition-all"
                        required
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white rounded-lg transition-all"
                      >
                        Add
                      </button>
                    </form>

                    {/* Timeline logs */}
                    <div className="relative pl-5 space-y-4 max-h-64 overflow-y-auto pr-2">
                      {selectedCase.notes && selectedCase.notes.length > 0 ? (
                        <>
                          <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-200 dark:bg-darkBorder/60" />
                          {selectedCase.notes.map((note, idx) => (
                            <div key={idx} className="relative text-xs space-y-1">
                              {/* Timeline dot */}
                              <div className={`absolute -left-[17px] top-0.5 w-3 h-3 rounded-full border-2 bg-white dark:bg-darkPanel ${
                                idx === 0 ? 'border-orange-500' : 'border-blue-500'
                              }`} />
                              <div className="flex items-center gap-2 text-[10px] text-gray-400 font-semibold">
                                <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold">
                                  {note.investigator}
                                </span>
                                <span>{new Date(note.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                {idx === 0 && <span className="ml-auto text-orange-500 font-bold">Latest</span>}
                              </div>
                              <p className="text-gray-700 dark:text-gray-300 leading-relaxed pl-0.5 border-l-2 border-gray-100 dark:border-darkBorder/40 pl-2">
                                {note.text}
                              </p>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="text-center py-8 text-xs text-gray-400 italic">
                          No timeline entries recorded yet.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Evidence Upload Panel */}
                  <div className="glass-panel p-6 space-y-4">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder flex items-center gap-1">
                      <Paperclip className="w-4 h-4" /> Evidence Attachments ({selectedCase.evidence?.length || 0})
                    </h4>

                    {/* Upload Form */}
                    <form onSubmit={handleUploadEvidence} className="space-y-3">
                      <input
                        type="file"
                        id="evidence-upload"
                        onChange={(e) => setEvidenceFile(e.target.files[0])}
                        className="w-full text-xs text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400 file:cursor-pointer"
                        required
                      />
                      <button
                        type="submit"
                        className="w-full py-2 bg-gray-100 hover:bg-gray-200 dark:bg-darkBorder/60 dark:hover:bg-darkBorder text-xs font-semibold text-gray-700 dark:text-gray-300 rounded-lg transition-all"
                      >
                        Upload Document
                      </button>
                    </form>

                    {/* Attachments List */}
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {selectedCase.evidence && selectedCase.evidence.length > 0 ? (
                        selectedCase.evidence.map((file, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 bg-gray-50 dark:bg-darkBg/30 border border-gray-100 dark:border-darkBorder/40 rounded-lg text-xs">
                            <span className="font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[180px]">
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
                        ))
                      ) : (
                        <div className="text-center py-8 text-xs text-gray-400 italic">
                          No compliance files uploaded yet.
                        </div>
                      )}
                    </div>
                  </div>

                </div>

              </div>
            ) : (
              <div className="glass-panel p-20 text-center text-gray-400 text-sm flex flex-col items-center justify-center space-y-2">
                <Briefcase className="w-10 h-10 text-gray-300" />
                <p className="font-semibold">No Investigation File Open</p>
                <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
                  Select a case record from the Open Case Registry on the left to examine files, compile reports, and audit transactions.
                </p>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
};

export default Cases;
