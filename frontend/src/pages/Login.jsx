import React, { useState, useContext, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import LogoImage from '../assets/FundTrace_Logo.png';
import { Shield, Lock, User as UserIcon, AlertCircle, Fingerprint, Building, Sparkles, ArrowLeft } from 'lucide-react';

const Login = () => {
  const { login, user } = useContext(AuthContext);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Pre-configured Quick Login Credentials for Testing Efficiency
  const roles = [
    { name: 'Admin Staff', user: 'admin', pass: 'admin123', desc: 'System Setup & Audits' },
    { name: 'Investigator', user: 'investigator', pass: 'investigator123', desc: 'Case & Alert Workflows' },
    { name: 'Auditor Team', user: 'auditor', pass: 'auditor123', desc: 'Read-only Inspections' }
  ];

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg('Please fill in all credentials.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    
    const result = await login(username, password);
    setLoading(false);

    if (result.success) {
      navigate('/dashboard');
    } else {
      setErrorMsg(result.error || 'Authentication failed. Please verify credentials.');
    }
  };

  const handleQuickLogin = (selectedUser, selectedPass) => {
    setUsername(selectedUser);
    setPassword(selectedPass);
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen px-4 py-12 overflow-hidden bg-slate-50 text-slate-800 dark:bg-gray-950 dark:text-gray-100 font-sans transition-colors duration-300">
      
      {/* Decorative India-themed background radial gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-orange-600/10 to-transparent blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-emerald-600/10 to-transparent blur-[120px] pointer-events-none" />
      <div className="absolute top-[30%] left-[40%] w-[400px] h-[400px] rounded-full bg-blue-600/5 blur-[100px] pointer-events-none" />

      {/* Back button */}
      <div className="absolute top-6 left-6 z-20">
        <Link 
          to="/" 
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-gray-900/80 hover:bg-slate-100 dark:hover:bg-gray-805 text-slate-655 dark:text-gray-300 transition-all shadow-sm btn-premium-glow"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Homepage
        </Link>
      </div>

      {/* Main Glassmorphic Container */}
      <div className="relative w-full max-w-lg p-0.5 rounded-3xl overflow-hidden shadow-xl dark:shadow-2xl bg-gradient-to-b from-orange-500/20 via-slate-200/40 dark:via-white/5 to-emerald-500/20">
        <div className="w-full p-8 md:p-10 rounded-[22px] bg-white/95 dark:bg-gray-900/90 backdrop-blur-xl border border-slate-100 dark:border-white/5 space-y-8">
          
          {/* Indian Tricolor Header Strip */}
          <div className="absolute top-0 left-0 right-0 h-1.5 flex">
            <div className="flex-1 bg-orange-500" />
            <div className="flex-1 bg-white" />
            <div className="flex-1 bg-emerald-500" />
          </div>

          {/* Branding Header */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center p-1 bg-slate-100 dark:bg-slate-800 shadow-sm border border-slate-200/50 dark:border-slate-700/50">
              <img src={LogoImage} className="w-full h-full object-contain" alt="FundTrace Logo" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                FundTrace <span className="text-blue-600 dark:text-blue-500">AI</span> Portal
              </h1>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold tracking-wider uppercase mt-1">
                FIU-IND Compliance Command Center
              </p>
              <div className="mt-2 flex items-center justify-center gap-1.5 px-3 py-1 bg-slate-50 dark:bg-white/5 border border-slate-250/60 dark:border-white/10 rounded-full w-fit mx-auto">
                <Building className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-[10px] text-slate-600 dark:text-gray-300 font-medium">
                  RBI Master Circular & AML/CFT Directive Aligned
                </span>
              </div>
            </div>
          </div>

          {/* Quick Login Presets for Efficiency */}
          <div className="space-y-3">
            <label className="text-[10px] font-extrabold text-slate-550 dark:text-slate-400 uppercase tracking-widest block text-center">
              Quick Authorization Profiles
            </label>
            <div className="grid grid-cols-3 gap-2">
              {roles.map((role) => (
                <button
                  key={role.user}
                  type="button"
                  onClick={() => handleQuickLogin(role.user, role.pass)}
                  className={`group p-3 rounded-xl border text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${
                    username === role.user
                      ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-300 shadow-md'
                      : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-750'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold block truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {role.name}
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-500 dark:text-slate-400 block mt-1 leading-tight line-clamp-1">
                    {role.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-200 dark:border-white/5"></div>
            <span className="flex-shrink mx-4 text-[9px] text-slate-450 dark:text-gray-500 uppercase tracking-widest font-bold">Or Manual Credentials</span>
            <div className="flex-grow border-t border-slate-200 dark:border-white/5"></div>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-650 dark:text-red-400 text-sm animate-shake">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Credentials Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider block">
                Username / Officer ID
              </label>
              <div className="relative group">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400 dark:text-gray-500 group-focus-within:text-blue-500 transition-colors">
                  <UserIcon className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter officer username..."
                  className="w-full pl-10 pr-4 py-3.5 bg-slate-50 dark:bg-gray-900/80 border border-slate-250 dark:border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm outline-none transition-all placeholder-slate-400 dark:placeholder-gray-600 text-slate-800 dark:text-white shadow-inner"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider block">
                Secret Access Key
              </label>
              <div className="relative group">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400 dark:text-gray-500 group-focus-within:text-blue-500 transition-colors">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3.5 bg-slate-50 dark:bg-gray-900/80 border border-slate-250 dark:border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm outline-none transition-all placeholder-slate-400 dark:placeholder-gray-600 text-slate-800 dark:text-white shadow-inner"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative w-full py-4 overflow-hidden rounded-xl font-bold text-sm text-white bg-gradient-to-r from-orange-500 to-emerald-600 hover:from-orange-600 hover:to-emerald-700 active:translate-y-0.5 transition-all shadow-xl shadow-orange-950/20 hover:shadow-orange-500/10 outline-none flex items-center justify-center gap-2 group disabled:opacity-70 disabled:pointer-events-none btn-premium-glow-emerald"
            >
              <div className="absolute inset-0 w-full h-full bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              {loading ? (
                <>
                  <Fingerprint className="w-5 h-5 animate-pulse text-white" />
                  <span>Verifying FIU Biometrics...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Secure Portal Authentication</span>
                </>
              )}
            </button>
          </form>

          {/* Secure system audit seal */}
          <div className="text-center pt-2 border-t border-slate-200 dark:border-white/5">
            <span className="text-[9px] text-slate-455 dark:text-gray-505 flex items-center justify-center gap-1">
              <Shield className="w-3 h-3 text-emerald-500" /> Authorized personnel only. Access logs audited by FIU-IND.
            </span>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Login;
