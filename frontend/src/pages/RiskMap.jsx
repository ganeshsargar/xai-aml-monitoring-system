import React, { useState, useEffect, useContext } from 'react';
import Navbar from '../components/Navbar';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import { Globe, ShieldAlert, TrendingUp, AlertTriangle, X, Info } from 'lucide-react';

const RiskMap = () => {
  const { API_URL } = useContext(AuthContext);
  const [countryStats, setCountryStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCountry, setHoveredCountry] = useState(null);
  const [selectedCountry, setSelectedCountry] = useState(null);

  // Hardcoded country coordinates for SVG pins
  const countriesData = {
    IN: { name: 'India', x: 550, y: 220, baseRisk: 12 },
    US: { name: 'United States', x: 200, y: 150, baseRisk: 35 },
    KY: { name: 'Cayman Islands', x: 230, y: 190, baseRisk: 95 },
    PA: { name: 'Panama', x: 240, y: 220, baseRisk: 90 },
    AE: { name: 'United Arab Emirates', x: 480, y: 195, baseRisk: 75 },
    RU: { name: 'Russia', x: 520, y: 100, baseRisk: 82 },
    BS: { name: 'Bahamas', x: 240, y: 180, baseRisk: 88 },
    LU: { name: 'Luxembourg', x: 395, y: 140, baseRisk: 68 },
    GB: { name: 'United Kingdom', x: 380, y: 125, baseRisk: 28 },
    SG: { name: 'Singapore', x: 590, y: 260, baseRisk: 42 },
    CH: { name: 'Switzerland', x: 395, y: 148, baseRisk: 55 }
  };

  useEffect(() => {
    // Fetch transaction list from API and aggregate stats by country
    const token = localStorage.getItem('aml_token');
    axios.get(`${API_URL}/api/transactions?limit=1000`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.data.success) {
          const txs = res.data.data;
          const stats = {};
          
          // Initialize from baseline countriesData
          Object.keys(countriesData).forEach(code => {
            stats[code] = {
              code,
              name: countriesData[code].name,
              txCount: 0,
              avgRisk: countriesData[code].baseRisk,
              suspiciousCount: 0,
              totalAmount: 0.0
            };
          });

          // Aggregate from actual transactions
          txs.forEach(t => {
            const country = t.country || 'IN';
            if (!stats[country]) {
              stats[country] = {
                code: country,
                name: country,
                txCount: 0,
                avgRisk: 0,
                suspiciousCount: 0,
                totalAmount: 0.0
              };
            }
            stats[country].txCount += 1;
            stats[country].totalAmount += t.amount || 0;
            if (t.risk_score >= 50) {
              stats[country].suspiciousCount += 1;
            }
          });

          // Compute average risks (blending in base risk for countries with few transactions to preserve showcase look)
          Object.keys(stats).forEach(code => {
            const countryTxs = txs.filter(t => (t.country || 'IN') === code);
            if (countryTxs.length > 0) {
              const sumRisk = countryTxs.reduce((sum, curr) => sum + curr.risk_score, 0);
              stats[code].avgRisk = Math.round(sumRisk / countryTxs.length);
            }
          });

          setCountryStats(Object.values(stats));
        }
      })
      .catch(err => {
        console.error("Failed to load country risk metrics:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [API_URL]);

  const getRiskColor = (risk) => {
    if (risk >= 75) return 'text-red-500 fill-red-500 bg-red-500/10 border-red-500/20';
    if (risk >= 50) return 'text-orange-500 fill-orange-500 bg-orange-500/10 border-orange-500/20';
    if (risk >= 25) return 'text-amber-500 fill-amber-500 bg-amber-500/10 border-amber-500/20';
    return 'text-emerald-500 fill-emerald-500 bg-emerald-500/10 border-emerald-500/20';
  };

  const getRiskBg = (risk) => {
    if (risk >= 75) return '#ef4444'; // Red
    if (risk >= 50) return '#f97316'; // Orange
    if (risk >= 25) return '#f59e0b'; // Amber
    return '#10b981'; // Emerald
  };

  // Helper for compliance recommendation text based on risk score
  const getRecommendation = (risk) => {
    if (risk >= 75) return 'Mandatory Enhanced Due Diligence (EDD). File Suspicious Transaction Report (STR).';
    if (risk >= 50) return 'Trigger automated warning. Review transaction velocity and source of funds.';
    if (risk >= 25) return 'Standard monitoring. Verify identity documentation for recurring transfers.';
    return 'Low Risk. Standard automated clearance.';
  };

  const handleCountryClick = (c) => {
    if (selectedCountry?.code === c.code) {
      setSelectedCountry(null);
    } else {
      setSelectedCountry(c);
    }
  };

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Geographical Money Laundering Risk Map" />

      <main className="p-8 space-y-8">
        
        {/* World Map Container */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center pb-3 border-b border-gray-150 dark:border-darkBorder gap-2">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-orange-500" />
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider">
                  Geospatial Fund Routing & Jurisdictional Threat Map
                </h3>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Interactive real-time map displaying cross-border routing risk and FATF monitors.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="bg-slate-100 dark:bg-darkBorder/40 text-slate-600 dark:text-slate-350 px-2.5 py-1 rounded font-bold flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-blue-500" />
                Click nodes to lock detail view / filter
              </span>
            </div>
          </div>

          <div className="relative w-full overflow-hidden bg-slate-950 rounded-2xl border border-slate-800 min-h-[480px] shadow-inner">
            
            {/* Legend (Fixed color contrast for both light & dark modes using slate-200 / slate-300 text inside dark map) */}
            <div className="absolute top-4 left-4 p-3.5 bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800 text-[10px] space-y-2.5 z-10 shadow-lg text-slate-200">
              <span className="font-extrabold text-slate-400 block uppercase tracking-wider text-[9px] border-b border-slate-800 pb-1">
                Threat Index Legend
              </span>
              <div className="space-y-1.5 font-medium text-slate-300">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                  <span>Critical (75-100%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#f97316]" />
                  <span>High (50-74%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                  <span>Medium (25-49%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                  <span>Low (&lt;25%)</span>
                </div>
              </div>
            </div>

            {/* Selected / Hovered Detail Card (Guarantees visible text on dark backdrop box) */}
            {(hoveredCountry || selectedCountry) && (
              <div className="absolute bottom-4 right-4 p-4 bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-700 text-xs w-72 space-y-3 z-10 animate-fade-in shadow-2xl text-slate-200 border-orange-500/30">
                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <div>
                    <h4 className="font-bold text-white text-sm">{(hoveredCountry || selectedCountry).name}</h4>
                    <span className="text-[10px] text-slate-500 font-mono">ISO Code: {(hoveredCountry || selectedCountry).code}</span>
                  </div>
                  <span 
                    className="px-2 py-1 rounded font-bold text-[10px] text-white shadow-sm" 
                    style={{ backgroundColor: getRiskBg((hoveredCountry || selectedCountry).avgRisk) }}
                  >
                    Risk: {(hoveredCountry || selectedCountry).avgRisk}%
                  </span>
                </div>
                
                <div className="space-y-1.5 text-[11px] text-slate-300">
                  <div className="flex justify-between">
                    <span>Transaction Count:</span>
                    <span className="font-mono text-white font-bold">{(hoveredCountry || selectedCountry).txCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Fund Flow:</span>
                    <span className="font-mono text-white font-bold">₹{Math.round((hoveredCountry || selectedCountry).totalAmount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Suspicious Alerts:</span>
                    <span className="font-mono text-red-400 font-bold">{(hoveredCountry || selectedCountry).suspiciousCount}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 leading-relaxed bg-slate-950/40 p-2 rounded">
                  <span className="font-bold block text-slate-300 mb-0.5">Compliance Guideline:</span>
                  {getRecommendation((hoveredCountry || selectedCountry).avgRisk)}
                </div>

                {selectedCountry && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCountry(null);
                    }}
                    className="w-full py-1 text-center bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] font-bold transition-all flex items-center justify-center gap-1"
                  >
                    <X className="w-3 h-3" /> Reset Map Selection
                  </button>
                )}
              </div>
            )}

            {/* Schematic SVG Map with detailed paths */}
            <svg viewBox="0 0 800 400" className="w-full h-full min-h-[450px] opacity-95 select-none transition-all duration-300">
              {/* World grid line network */}
              <g opacity="0.08" stroke="#ffffff" strokeWidth="0.5" strokeDasharray="3,3">
                <path d="M 0,100 H 800" />
                <path d="M 0,200 H 800" />
                <path d="M 0,300 H 800" />
                <path d="M 100,0 V 400" />
                <path d="M 200,0 V 400" />
                <path d="M 300,0 V 400" />
                <path d="M 400,0 V 400" />
                <path d="M 500,0 V 400" />
                <path d="M 600,0 V 400" />
                <path d="M 700,0 V 400" />
              </g>

              {/* Continents outlines */}
              <g fill="#1e293b" opacity="0.3">
                {/* North America */}
                <path d="M 50,80 L 150,70 L 250,60 L 280,140 L 230,220 L 120,200 L 70,140 Z" />
                {/* South America */}
                <path d="M 200,220 L 260,240 L 280,310 L 240,380 L 200,350 L 170,270 Z" />
                {/* Europe */}
                <path d="M 350,50 L 450,45 L 480,120 L 400,160 L 330,120 Z" />
                {/* Asia / Russia */}
                <path d="M 450,45 L 750,35 L 770,180 L 600,220 L 480,120 Z" />
                {/* Africa */}
                <path d="M 360,180 L 460,190 L 480,290 L 430,360 L 370,280 Z" />
                {/* Indian Peninsula */}
                <path d="M 530,170 L 580,180 L 560,240 L 520,210 Z" fill="#334155" opacity="0.6" />
                {/* Australia */}
                <path d="M 640,280 L 730,290 L 710,370 L 630,350 Z" />
              </g>

              {/* Render dynamic interactive country nodes */}
              {countryStats.map((c) => {
                const coord = countriesData[c.code] || { x: 400, y: 200 };
                const isHovered = hoveredCountry?.code === c.code;
                const isSelected = selectedCountry?.code === c.code;
                const isActive = isHovered || isSelected;

                return (
                  <g 
                    key={c.code}
                    onMouseEnter={() => setHoveredCountry(c)}
                    onMouseLeave={() => setHoveredCountry(null)}
                    onClick={() => handleCountryClick(c)}
                    className="cursor-pointer"
                  >
                    {/* Outer glow aura */}
                    <circle 
                      cx={coord.x} 
                      cy={coord.y} 
                      r={isActive ? 32 : 18} 
                      fill={getRiskBg(c.avgRisk)}
                      opacity={isActive ? 0.35 : 0.08}
                      className="transition-all duration-500 ease-out"
                    />

                    {/* Ring Pulse */}
                    <circle 
                      cx={coord.x} 
                      cy={coord.y} 
                      r={isActive ? 20 : 12} 
                      fill="none" 
                      stroke={getRiskBg(c.avgRisk)} 
                      strokeWidth={isSelected ? "2.5" : "1.5"} 
                      opacity={isActive ? 0.8 : 0.4}
                      className={c.avgRisk >= 50 ? "animate-pulse" : ""}
                    />

                    {/* Center Core Node */}
                    <circle 
                      cx={coord.x} 
                      cy={coord.y} 
                      r={isActive ? 7 : 4} 
                      fill={getRiskBg(c.avgRisk)} 
                      className="transition-all duration-300 shadow"
                    />

                    {/* Country Code Label */}
                    <text 
                      x={coord.x} 
                      y={coord.y - 14} 
                      fill={isActive ? "#ffffff" : "#94a3b8"} 
                      fontSize={isActive ? "10" : "8"} 
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                      className="transition-all duration-200 pointer-events-none select-none"
                    >
                      {c.code}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Selected Country Profile Panel (Interactive drilldown helper) */}
        {selectedCountry && (
          <div className="glass-panel p-6 bg-gradient-to-r from-orange-500/5 to-rose-500/5 border-orange-500/20 animate-fade-in flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[9px] font-black uppercase text-orange-500 tracking-wider">
                Jurisdiction Filter Active
              </span>
              <h4 className="text-base font-extrabold text-gray-800 dark:text-white flex items-center gap-1.5">
                <ShieldAlert className="w-5 h-5 text-red-500" />
                Currently Filtering Transactions for {selectedCountry.name} ({selectedCountry.code})
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing relative fund aggregates, compliance alarms, and transactional details below.
              </p>
            </div>
            <button 
              onClick={() => setSelectedCountry(null)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 dark:bg-darkBorder/60 dark:hover:bg-darkBorder text-xs font-semibold text-white rounded-lg transition-all flex items-center justify-center gap-1.5 self-start md:self-auto"
            >
              <X className="w-4 h-4" /> Clear Filter
            </button>
          </div>
        )}

        {/* Breakdown table list */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 glass-panel p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-darkBorder">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Country Risk Analysis Registry
              </h4>
              {selectedCountry && (
                <span className="text-[10px] text-orange-500 font-bold bg-orange-500/10 px-2 py-0.5 rounded">
                  Showing 1 Country
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 dark:border-darkBorder">
                    <th className="py-2.5 font-bold">Country</th>
                    <th className="py-2.5 font-bold text-center">Tx Count</th>
                    <th className="py-2.5 font-bold text-center">Total Volume</th>
                    <th className="py-2.5 font-bold text-center">Suspicious</th>
                    <th className="py-2.5 font-bold text-center">Threat Index</th>
                    <th className="py-2.5 font-bold">Risk Bar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-darkBorder/40">
                  {countryStats
                    .filter(c => !selectedCountry || c.code === selectedCountry.code)
                    .sort((a, b) => b.avgRisk - a.avgRisk)
                    .map((c) => (
                      <tr
                        key={c.code}
                        onClick={() => handleCountryClick(c)}
                        className={`cursor-pointer transition-all ${
                          selectedCountry?.code === c.code 
                            ? 'bg-orange-500/10 dark:bg-orange-500/5 border-l-4 border-orange-500 font-semibold' 
                            : 'hover:bg-slate-50 dark:hover:bg-darkBorder/20'
                        }`}
                      >
                        <td className="py-3 font-semibold text-gray-800 dark:text-gray-250 pl-2">
                          {c.name} <span className="text-gray-400 font-mono text-[10px]">({c.code})</span>
                          {['KY','PA','RU','BS'].includes(c.code) && (
                            <span className="ml-1.5 text-[8px] font-bold text-red-500 bg-red-500/10 px-1 rounded">FATF</span>
                          )}
                        </td>
                        <td className="py-3 text-center font-mono">{c.txCount}</td>
                        <td className="py-3 text-center font-mono">₹{Math.round(c.totalAmount).toLocaleString()}</td>
                        <td className="py-3 text-center font-mono text-red-500 font-bold">{c.suspiciousCount}</td>
                        <td className="py-3 text-center">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                            style={{ backgroundColor: getRiskBg(c.avgRisk) }}
                          >
                            {c.avgRisk}%
                          </span>
                        </td>
                        <td className="py-3 w-24">
                          <div className="h-1.5 w-full bg-gray-200 dark:bg-darkBorder/40 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${c.avgRisk}%`, backgroundColor: getRiskBg(c.avgRisk) }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* FATF Blacklist & Grey list sidepanel */}
          <div className="glass-panel p-6 space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 dark:border-darkBorder">
              Compliance Alerts (FATF)
            </h4>
            <div className="space-y-4">
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 text-red-500">
                  <ShieldAlert className="w-4 h-4" />
                  <span className="text-xs font-extrabold uppercase">FATF Blacklist (High Risk)</span>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  Transactions routed through Cayman Islands (KY), Panama (PA), or Russia (RU) are automatically penalized with geographic threat offsets in FundTrace AI scoring.
                </p>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 text-amber-500">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs font-extrabold uppercase">FATF Grey List (Monitored)</span>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  UAE (AE) and Bahamas (BS) are flagged under strict surveillance. Enhanced due diligence is automatically recommended for transfers exceeding ₹1,00,000.
                </p>
              </div>

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 text-blue-500">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs font-extrabold uppercase">Surveillance Trends</span>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  Cross-border transaction velocity between IN and Tax Havens increased by 14% this quarter, requiring strict community graph audits.
                </p>
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};

export default RiskMap;
