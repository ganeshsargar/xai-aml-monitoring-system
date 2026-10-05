import React from 'react';

const StatCard = ({ title, value, icon: Icon, description, subtext, trend, color = 'blue' }) => {
  const colorMap = {
    blue: 'text-blue-500 bg-blue-500/10 border-blue-500/20 dark:bg-blue-500/20 dark:border-blue-400/40 dark:text-blue-400 shadow-glow-blue/15',
    red: 'text-red-500 bg-red-500/10 border-red-500/20 dark:bg-red-500/20 dark:border-red-400/40 dark:text-red-400 shadow-glow-red/15',
    rose: 'text-rose-500 bg-rose-500/10 border-rose-500/20 dark:bg-rose-500/20 dark:border-rose-400/40 dark:text-rose-400 shadow-glow-red/15',
    amber: 'text-amber-500 bg-amber-500/10 border-amber-500/20 dark:bg-amber-500/20 dark:border-amber-400/40 dark:text-amber-400 shadow-glow-orange/15',
    green: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 dark:bg-emerald-500/20 dark:border-emerald-400/40 dark:text-emerald-400 shadow-glow-green/15',
    emerald: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 dark:bg-emerald-500/20 dark:border-emerald-400/40 dark:text-emerald-400 shadow-glow-green/15',
    indigo: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20 dark:bg-indigo-500/20 dark:border-indigo-400/40 dark:text-indigo-400 shadow-glow-blue/15',
    purple: 'text-purple-500 bg-purple-500/10 border-purple-500/20 dark:bg-purple-500/20 dark:border-purple-400/40 dark:text-purple-400 shadow-glow-purple/15',
  };

  const displayText = description || subtext;

  return (
    <div className="glass-panel glass-panel-hover p-5 flex items-center justify-between relative overflow-hidden group border border-gray-150 dark:border-slate-800 shadow-sm rounded-2xl bg-white dark:bg-darkPanel">
      {/* Background radial highlight gradient */}
      <div className="absolute -right-16 -bottom-16 w-36 h-36 rounded-full bg-blue-500/10 blur-3xl group-hover:bg-blue-500/20 transition-all duration-500" />
      
      <div className="space-y-1.5 relative z-10 min-w-0 flex-1 pr-2">
        <span className="text-[10px] uppercase font-extrabold tracking-widest text-slate-500 dark:text-slate-300 block truncate">
          {title}
        </span>
        <h3 className="text-2xl lg:text-3xl font-black tracking-tight text-gray-900 dark:text-white truncate">
          {value}
        </h3>
        {displayText && (
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-300 truncate">
            {trend && (
              <span className={`font-bold mr-1.5 ${trend.startsWith('+') ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {trend}
              </span>
            )}
            {displayText}
          </p>
        )}
      </div>
      
      {Icon && (
        <div className={`p-3 border rounded-2xl transition-all duration-300 group-hover:scale-110 flex-shrink-0 ${colorMap[color] || colorMap.blue}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  );
};

export default StatCard;
