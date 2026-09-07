import React, { useContext } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import LogoImage from '../assets/FundTrace_Logo.png';
import AdminImage from '../assets/Admin.avif';
import AuditorImage from '../assets/Auditor.png';
import InvestigatorImage from '../assets/Investigator.jpg';
import { 
  LayoutDashboard, 
  Coins, 
  AlertOctagon, 
  Briefcase, 
  History, 
  LogOut,
  Globe
} from 'lucide-react';

const Sidebar = () => {
  const { user, logout } = useContext(AuthContext);

  const getLinks = () => {
    const links = [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Admin', 'Investigator', 'Auditor'] },
      { path: '/transactions', label: 'Transactions', icon: Coins, roles: ['Admin', 'Investigator', 'Auditor'] },
      { path: '/alerts', label: 'Alerts Queue', icon: AlertOctagon, roles: ['Admin', 'Investigator', 'Auditor'] },
      { path: '/risk-map', label: 'World Risk Map', icon: Globe, roles: ['Admin', 'Investigator', 'Auditor'] },
      { path: '/cases', label: 'Case Manager', icon: Briefcase, roles: ['Admin', 'Investigator'] },
      { path: '/admin', label: 'Audit & System', icon: History, roles: ['Admin', 'Auditor'] }
    ];
    return links.filter(link => link.roles.includes(user?.role));
  };

  const getRoleImage = () => {
    if (user?.role === 'Admin') return AdminImage;
    if (user?.role === 'Auditor') return AuditorImage;
    if (user?.role === 'Investigator') return InvestigatorImage;
    return null;
  };
  
  const roleImage = getRoleImage();

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex flex-col w-64 border-r border-gray-200 bg-white dark:border-darkBorder dark:bg-darkPanel">
      {/* Brand Header with India Tricolor accent */}
      <Link to="/" className="flex flex-col border-b border-gray-100 dark:border-darkBorder hover:bg-gray-50/50 dark:hover:bg-darkBg/35 transition-all duration-300 group">
        <div className="flex items-center gap-3 px-6 h-16">
          <div className="w-8 h-8 rounded-xl overflow-hidden flex items-center justify-center p-0.5 bg-slate-50 dark:bg-slate-800 transition-transform duration-300 group-hover:scale-115">
            <img src={LogoImage} className="w-full h-full object-contain" alt="FundTrace Logo" />
          </div>
          <div className="transition-transform duration-300 group-hover:translate-x-1">
            <h1 className="text-sm font-black tracking-wider text-gray-800 dark:text-white">
              FundTrace <span className="text-blue-500">AI</span>
            </h1>
            <span className="text-[9px] uppercase font-bold tracking-wider text-gray-400 block -mt-0.5">
              Explainable Monitoring
            </span>
          </div>
        </div>
        <div className="india-tricolor" />
      </Link>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        {getLinks().map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.path}
              to={link.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all duration-300 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/10'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-darkBg/50 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-4 h-4 transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
                  <span>{link.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User Footer Profile */}
      <div className="p-4 border-t border-gray-100 dark:border-darkBorder bg-gray-50/50 dark:bg-darkBg/30">
        <div className="flex items-center gap-3 mb-4 p-2 rounded-xl bg-gray-100/50 dark:bg-darkBg/40 border border-gray-200/30 dark:border-darkBorder/40">
          {roleImage ? (
            <div className="w-9 h-9 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
              <img src={roleImage} className="w-full h-full object-cover" alt={user?.name || 'User'} />
            </div>
          ) : (
            <div className="flex items-center justify-center w-9 h-9 font-extrabold text-white bg-gradient-to-tr from-orange-500 to-rose-500 rounded-lg shadow-sm shrink-0">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}
          <div className="overflow-hidden">
            <h4 className="text-xs font-bold truncate text-gray-800 dark:text-gray-200">
              {user?.name}
            </h4>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-extrabold uppercase bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border border-orange-200/20 dark:border-orange-900/20">
              {user?.role}
            </span>
          </div>
        </div>

        <button
          onClick={logout}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-xs font-bold text-red-650 dark:text-red-400 border border-red-100 dark:border-red-950/40 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:shadow-red-500/5 active:translate-y-0"
        >
          <LogOut className="w-3.5 h-3.5" />
          Logout Session
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
