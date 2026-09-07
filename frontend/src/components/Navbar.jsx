import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import axios from 'axios';
import { Sun, Moon, AlertTriangle, CheckCircle, Database } from 'lucide-react';

const Navbar = ({ title }) => {
  const { API_URL } = useContext(AuthContext);
  const { theme, toggleTheme } = useContext(ThemeContext);
  const [systemState, setSystemState] = useState({ db: 'checking', ml: 'checking' });

  // Check backend server & database status
  useEffect(() => {
    const checkStatus = () => {
      axios.get(`${API_URL}/api/admin/system-stats`)
        .then(res => {
          if (res.data.success) {
            const dbMode = res.data.data.database.mode;
            const mlStatus = res.data.data.ml_model.status ? 'down' : 'up';
            setSystemState({
              db: dbMode.includes('Fallback') ? 'fallback' : 'connected',
              ml: mlStatus === 'up' ? 'connected' : 'disconnected'
            });
          }
        })
        .catch(() => {
          setSystemState({ db: 'disconnected', ml: 'disconnected' });
        });
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check status every 30 seconds
    return () => clearInterval(interval);
  }, [API_URL]);


  return (
    <header className="fixed top-0 right-0 left-64 z-10 flex items-center justify-between px-8 h-16 bg-white/80 dark:bg-darkBg/80 backdrop-blur-md border-b border-gray-200 dark:border-darkBorder">
      <h2 className="text-sm font-extrabold tracking-wider uppercase text-gray-500 dark:text-gray-400">
        {title}
      </h2>

      <div className="flex items-center gap-6">
        {/* System Status Indicators */}
        <div className="flex items-center gap-4 text-xs font-semibold">
          {/* DB Indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-darkPanel/50 border border-gray-150 dark:border-darkBorder/40 text-gray-650 dark:text-gray-300">
            <Database className="w-3.5 h-3.5 text-orange-500" />
            <span>DB Registry:</span>
            {systemState.db === 'connected' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 shadow-glow-green/10">
                MongoDB
              </span>
            )}
            {systemState.db === 'fallback' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-orange-500/15 text-orange-500 border border-orange-500/20 shadow-glow-orange/10">
                JSON File Mock
              </span>
            )}
            {systemState.db === 'disconnected' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-red-500/15 text-red-500 border border-red-500/20 shadow-glow-red/10 animate-pulse">
                Offline
              </span>
            )}
          </div>

          {/* ML Indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-darkPanel/50 border border-gray-150 dark:border-darkBorder/40 text-gray-650 dark:text-gray-300">
            <CheckCircle className="w-3.5 h-3.5 text-rose-500" />
            <span>Risk Engine:</span>
            {systemState.ml === 'connected' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 shadow-glow-green/10">
                XAI Active
              </span>
            )}
            {systemState.ml === 'disconnected' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-orange-500/15 text-orange-500 border border-orange-500/20 shadow-glow-orange/10" title="Flask server offline, running fallback rules">
                Heuristic Fallback
              </span>
            )}
          </div>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 bg-gray-100 hover:bg-gray-250 dark:bg-darkPanel dark:hover:bg-darkBorder/70 rounded-xl border border-transparent dark:border-darkBorder/30 transition-all duration-300"
          aria-label="Toggle Theme Mode"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-orange-500" /> : <Moon className="w-4 h-4 text-slate-700" />}
        </button>
      </div>
    </header>
  );
};

export default Navbar;
