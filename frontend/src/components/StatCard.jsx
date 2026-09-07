import React from 'react';

const StatCard = ({ title, value, icon: Icon, description, trend, color = 'blue' }) => {
  const colorMap = {
    blue: 'text-blue-500 bg-blue-500/10 border-blue-500/20 shadow-glow-blue/10',
    red: 'text-red-500 bg-red-500/10 border-red-500/20 shadow-glow-red/10',
    amber: 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-glow-orange/10',
    green: 'text-green-500 bg-emerald-500/10 border-emerald-500/20 shadow-glow-green/10',
    indigo: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20 shadow-glow-blue/10',
  };

  return (
    <div className="glass-panel glass-panel-hover p-6 flex items-center justify-between relative overflow-hidden group">
      {/* Background radial highlight gradient */}
      <div className="absolute -right-16 -bottom-16 w-36 h-36 rounded-full bg-orange-500/5 blur-3xl group-hover:bg-orange-500/10 transition-all duration-500" />
      
      <div className="space-y-2.5 relative z-10">
        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block">
          {title}
        </span>
        <h3 className="text-3xl font-black tracking-tight bg-gradient-to-r from-slate-800 to-slate-650 dark:from-white dark:to-slate-200 bg-clip-text text-transparent">
          {value}
        </h3>
        <p className="text-xs font-semibold text-slate-400">
          {trend && (
            <span className={`font-bold mr-1.5 ${trend.startsWith('+') ? 'text-emerald-500' : 'text-red-500'}`}>
              {trend}
            </span>
          )}
          {description}
        </p>
      </div>
      
      <div className={`p-3.5 border rounded-2xl transition-all duration-300 group-hover:scale-110 ${colorMap[color] || colorMap.blue}`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
};

export default StatCard;
