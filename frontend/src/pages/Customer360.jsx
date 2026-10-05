import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import {
  Users,
  Search,
  Building,
  User,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Briefcase,
  CreditCard,
  TrendingUp,
  Clock,
  Globe,
  ArrowRight,
  ChevronRight,
  ExternalLink,
  Activity,
  Layers,
  Percent,
  CheckCircle2,
  DollarSign
} from 'lucide-react';
import ScreeningPanel from '../components/ScreeningPanel';

const Customer360 = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { API_URL } = useContext(AuthContext);

  const [customers, setCustomers] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState(id || '');
  const [customerData, setCustomerData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorDetail, setErrorDetail] = useState(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');

  // Fetch list of customers
  const fetchCustomerList = async () => {
    try {
      setLoadingList(true);
      const params = { limit: 100 };
      if (searchQuery) params.search = searchQuery;
      if (typeFilter) params.type = typeFilter;
      if (riskFilter) params.kyc_risk_rating = riskFilter;

      const res = await axios.get(`${API_URL}/api/customers`, { params });
      if (res.data.success) {
        setCustomers(res.data.data);
        // If no selectedCustomerId yet and we have data, select the first
        if (!selectedCustomerId && res.data.data.length > 0 && !id) {
          setSelectedCustomerId(res.data.data[0].customer_id);
        }
      }
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchCustomerList();
  }, [searchQuery, typeFilter, riskFilter]);

  // Update selected customer if URL parameter changes
  useEffect(() => {
    if (id && id !== selectedCustomerId) {
      setSelectedCustomerId(id);
    }
  }, [id]);

  // Fetch detail for selected customer
  useEffect(() => {
    if (!selectedCustomerId) return;
    const fetchDetail = async () => {
      try {
        setLoadingDetail(true);
        setErrorDetail(null);
        const res = await axios.get(`${API_URL}/api/customers/${selectedCustomerId}`);
        if (res.data.success) {
          setCustomerData(res.data.data);
        } else {
          setErrorDetail('Customer not found');
        }
      } catch (err) {
        console.error('Error fetching customer detail:', err);
        setErrorDetail(err.response?.data?.error || 'Failed to load customer profile');
      } finally {
        setLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [selectedCustomerId, API_URL]);

  const handleSelectCustomer = (custId) => {
    setSelectedCustomerId(custId);
    navigate(`/customers/${custId}`, { replace: true });
  };

  const formatCurrency = (amt) => {
    if (amt === undefined || amt === null) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amt);
  };

  const getRiskBadgeColor = (rating) => {
    const r = (rating || '').toUpperCase();
    if (r === 'HIGH' || r === 'CRITICAL') return 'bg-rose-500/15 text-rose-500 border-rose-500/30';
    if (r === 'MED' || r === 'MEDIUM') return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
    return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
  };

  const profile = customerData?.profile;
  const baselines = customerData?.baselines;
  const riskSummary = customerData?.risk_summary;
  const accounts = customerData?.accounts || [];
  const alerts = customerData?.alerts || [];
  const cases = customerData?.cases || [];
  const recentTransactions = customerData?.recent_transactions || [];

  return (
    <div className="flex-1 pl-64 pt-16 min-h-screen bg-gray-50 dark:bg-darkBg">
      <Navbar title="Customer 360 Entity Intelligence" />

      <main className="p-8 space-y-6">
        {/* Top Header Card */}
        <div className="glass-panel p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-500 dark:bg-blue-500/20">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-black text-gray-900 dark:text-white tracking-wide">
                  Customer 360 Intelligence
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Behavioral Profiling, Peer Cohort Baselines, Entity Resolution & Risk Lineage
                </p>
              </div>
            </div>
          </div>

          {/* Quick Counter Stats */}
          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-gray-100/80 dark:bg-darkBg/60 border border-gray-200/50 dark:border-darkBorder">
              <span className="text-[10px] uppercase font-bold text-gray-400 block">Profiles Indexed</span>
              <span className="text-sm font-black text-gray-800 dark:text-gray-200">{customers.length} Entities</span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200/40 dark:border-rose-900/30">
              <span className="text-[10px] uppercase font-bold text-rose-500 block">High Risk Entities</span>
              <span className="text-sm font-black text-rose-600 dark:text-rose-400">
                {customers.filter(c => (c.kyc_risk_rating || '').toUpperCase() === 'HIGH').length}
              </span>
            </div>
          </div>
        </div>

        {/* Layout: Sidebar Selector (1/3) + Detail View (2/3) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Customer Directory Column */}
          <div className="lg:col-span-4 space-y-4">
            <div className="glass-panel p-4 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search Customer ID, Name, Country..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-darkBg rounded-xl border border-transparent focus:border-blue-500 text-xs text-gray-800 dark:text-gray-200 outline-none"
                />
              </div>

              {/* Filters */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-gray-100 dark:bg-darkBg rounded-lg border border-transparent focus:border-blue-500 text-gray-600 dark:text-gray-300 outline-none"
                >
                  <option value="">All Types</option>
                  <option value="individual">Individual</option>
                  <option value="business">Business</option>
                </select>

                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-gray-100 dark:bg-darkBg rounded-lg border border-transparent focus:border-blue-500 text-gray-600 dark:text-gray-300 outline-none"
                >
                  <option value="">All KYC</option>
                  <option value="High">High Risk</option>
                  <option value="Med">Medium Risk</option>
                  <option value="Low">Low Risk</option>
                </select>
              </div>
            </div>

            {/* Customer List Card */}
            <div className="glass-panel p-3 max-h-[680px] overflow-y-auto space-y-2">
              {loadingList ? (
                <div className="text-center py-12 text-xs text-gray-400">Loading customer profiles...</div>
              ) : customers.length === 0 ? (
                <div className="text-center py-12 text-xs text-gray-400">No matching customer records</div>
              ) : (
                customers.map((c) => {
                  const isSelected = c.customer_id === selectedCustomerId;
                  const isBusiness = c.type === 'business';
                  return (
                    <div
                      key={c.customer_id}
                      onClick={() => handleSelectCustomer(c.customer_id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20'
                          : 'bg-white/50 dark:bg-darkBg/40 border-gray-100 dark:border-darkBorder hover:bg-gray-100/80 dark:hover:bg-darkBg/80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isBusiness ? (
                            <Building className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-purple-500'}`} />
                          ) : (
                            <User className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-blue-500'}`} />
                          )}
                          <span className={`text-xs font-black truncate max-w-[150px] ${isSelected ? 'text-white' : 'text-gray-800 dark:text-gray-200'}`}>
                            {c.name}
                          </span>
                        </div>
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded-full font-black border ${
                            isSelected
                              ? 'bg-white/20 text-white border-white/30'
                              : getRiskBadgeColor(c.kyc_risk_rating)
                          }`}
                        >
                          {c.kyc_risk_rating || 'Low'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-2 text-[10px]">
                        <span className={isSelected ? 'text-blue-100 font-mono' : 'text-gray-400 font-mono'}>
                          {c.customer_id}
                        </span>
                        <span className={isSelected ? 'text-blue-100 font-semibold' : 'text-gray-500 dark:text-gray-400'}>
                          {formatCurrency(c.declared_monthly_income_or_turnover)}/mo
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Customer 360 Detail View (8 Cols) */}
          <div className="lg:col-span-8 space-y-6">
            {loadingDetail ? (
              <div className="glass-panel p-16 text-center text-xs text-gray-400">
                <div className="w-8 h-8 mx-auto mb-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Aggregating customer history, accounts, behavioral baselines and alerts...
              </div>
            ) : errorDetail ? (
              <div className="glass-panel p-12 text-center text-xs text-rose-500">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-500" />
                {errorDetail}
              </div>
            ) : !customerData ? (
              <div className="glass-panel p-16 text-center text-xs text-gray-400">
                Select a customer from the directory to view the 360 profile.
              </div>
            ) : (
              <>
                {/* Profile Master Card */}
                <div className="glass-panel p-6 relative overflow-hidden">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-100 dark:border-darkBorder">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-500/20 shrink-0">
                        {profile?.type === 'business' ? <Building className="w-7 h-7" /> : <User className="w-7 h-7" />}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-black text-gray-900 dark:text-white">
                            {profile?.name}
                          </h2>
                          <span className="font-mono text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-darkBg text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-darkBorder">
                            {profile?.customer_id}
                          </span>
                          <span className={`text-[10px] uppercase font-black px-2.5 py-0.5 rounded-full border ${getRiskBadgeColor(profile?.kyc_risk_rating)}`}>
                            KYC: {profile?.kyc_risk_rating} Risk
                          </span>
                          {profile?.is_pep && (
                            <span className="text-[10px] uppercase font-black px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-500 border border-rose-500/30 animate-pulse">
                              PEP Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">
                          {profile?.type} Entity • {profile?.occupation_or_business_type || 'General'} • Residence: <span className="font-semibold text-gray-800 dark:text-gray-200">{profile?.country_of_residence || 'IN'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-gray-400 block">Declared Monthly {profile?.type === 'business' ? 'Turnover' : 'Income'}</span>
                        <span className="text-lg font-black text-gray-900 dark:text-white">
                          {formatCurrency(profile?.declared_monthly_income_or_turnover)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Profile Metadata Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 text-xs">
                    <div>
                      <span className="text-[10px] uppercase text-gray-400 block font-semibold">Onboarding Date</span>
                      <span className="font-bold text-gray-700 dark:text-gray-300">
                        {profile?.onboarding_date ? new Date(profile.onboarding_date).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-gray-400 block font-semibold">Linked Accounts</span>
                      <span className="font-bold text-gray-700 dark:text-gray-300">{accounts.length} active</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-gray-400 block font-semibold">Jurisdiction</span>
                      <span className="font-bold text-gray-700 dark:text-gray-300">{profile?.country_of_residence || 'IN'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-gray-400 block font-semibold">Beneficial Owners</span>
                      <span className="font-bold text-gray-700 dark:text-gray-300">
                        {profile?.beneficial_owner_ids?.length ? profile.beneficial_owner_ids.join(', ') : 'Direct / None'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Behavioral Baselines & Peer Group Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Baselines Card */}
                  <div className="glass-panel p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-2">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-500" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
                          Behavioral Baselines
                        </h3>
                      </div>
                      <span className="text-[10px] text-gray-400 font-semibold">Rolling 30-Day Window</span>
                    </div>

                    {/* Actual Volume vs Declared Income Gauge */}
                    <div className="p-3.5 rounded-xl bg-gray-50/70 dark:bg-darkBg/50 border border-gray-150 dark:border-darkBorder space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-gray-600 dark:text-gray-400">Actual Monthly Volume:</span>
                        <span className="font-black text-gray-900 dark:text-white">
                          {formatCurrency(baselines?.typical_monthly_volume)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-gray-400">
                        <span>Declared Profile Baseline:</span>
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          {formatCurrency(profile?.declared_monthly_income_or_turnover)}
                        </span>
                      </div>

                      {/* Discrepancy Bar */}
                      <div className="pt-1">
                        <div className="w-full bg-gray-200 dark:bg-darkBorder rounded-full h-2 overflow-hidden flex">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              (riskSummary?.volume_to_income_ratio || 0) > 2.5
                                ? 'bg-rose-500'
                                : (riskSummary?.volume_to_income_ratio || 0) > 1.2
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{
                              width: `${Math.min(100, Math.max(5, (riskSummary?.volume_to_income_ratio || 0) * 35))}%`
                            }}
                          />
                        </div>
                        <div className="flex justify-between items-center text-[10px] mt-1.5 font-bold">
                          <span className="text-gray-400">Profile Deviation Multiple:</span>
                          <span
                            className={
                              (riskSummary?.volume_to_income_ratio || 0) > 2.5
                                ? 'text-rose-500 font-black'
                                : (riskSummary?.volume_to_income_ratio || 0) > 1.2
                                ? 'text-amber-500'
                                : 'text-emerald-500'
                            }
                          >
                            {(riskSummary?.volume_to_income_ratio || 0).toFixed(2)}x Declared
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Baseline Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-gray-50/50 dark:bg-darkBg/30 border border-gray-150/50 dark:border-darkBorder/40">
                        <span className="text-[10px] uppercase font-semibold text-gray-400 block">Median Tx Amount</span>
                        <span className="font-black text-gray-800 dark:text-gray-200">
                          {formatCurrency(baselines?.rolling_median_amount)}
                        </span>
                        <span className="text-[10px] text-gray-400 block mt-0.5">
                          Std: {formatCurrency(baselines?.rolling_std_amount)}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-gray-50/50 dark:bg-darkBg/30 border border-gray-150/50 dark:border-darkBorder/40">
                        <span className="text-[10px] uppercase font-semibold text-gray-400 block">Counterparties</span>
                        <span className="font-black text-gray-800 dark:text-gray-200">
                          {baselines?.counterparties_count || 0} Distinct
                        </span>
                        <span className="text-[10px] text-gray-400 block mt-0.5">Network breadth</span>
                      </div>

                      <div className="p-3 rounded-xl bg-gray-50/50 dark:bg-darkBg/30 border border-gray-150/50 dark:border-darkBorder/40">
                        <span className="text-[10px] uppercase font-semibold text-gray-400 block">Active Hours</span>
                        <span className="font-bold text-gray-700 dark:text-gray-300">
                          {baselines?.usual_hours?.length ? `${baselines.usual_hours[0]}:00 - ${baselines.usual_hours[baselines.usual_hours.length - 1]}:00` : 'Standard daytime'}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-gray-50/50 dark:bg-darkBg/30 border border-gray-150/50 dark:border-darkBorder/40">
                        <span className="text-[10px] uppercase font-semibold text-gray-400 block">Usual Jurisdictions</span>
                        <span className="font-bold text-gray-700 dark:text-gray-300">
                          {baselines?.usual_countries?.length ? baselines.usual_countries.join(', ') : profile?.country_of_residence || 'IN'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Peer Group & Risk Factors Card */}
                  <div className="glass-panel p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-2">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-purple-500" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
                          Peer Group Baseline & Risk
                        </h3>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-500 font-bold">
                        {baselines?.peer_group?.key || 'peer_general'}
                      </span>
                    </div>

                    {/* Peer Percentile Meter */}
                    <div className="p-3.5 rounded-xl bg-gray-50/70 dark:bg-darkBg/50 border border-gray-150 dark:border-darkBorder space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-gray-600 dark:text-gray-400">Peer Percentile Rank:</span>
                        <span className="font-black text-purple-600 dark:text-purple-400">
                          {((riskSummary?.peer_percentile_estimate || 0.5) * 100).toFixed(0)}th Percentile
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-gray-400">
                        <span>Cohort Typical Median:</span>
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          {formatCurrency(baselines?.peer_group?.peer_median_volume)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-gray-400">
                        <span>Cohort 75th Percentile:</span>
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          {formatCurrency(baselines?.peer_group?.peer_q75_volume)}
                        </span>
                      </div>
                    </div>

                    {/* Dynamic Risk Factors List */}
                    <div className="space-y-2">
                      <span className="text-[10px] uppercase font-bold text-gray-400 block">
                        Observed Risk Signals ({riskSummary?.risk_factors?.length || 0})
                      </span>
                      {riskSummary?.risk_factors?.length === 0 ? (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-xs font-semibold">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Customer behavior strictly aligns with declared profile and peer cohort.</span>
                        </div>
                      ) : (
                        riskSummary?.risk_factors?.map((rf, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold"
                          >
                            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{rf}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Linked Accounts Section */}
                <div className="glass-panel p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-2">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-500" />
                      <h3 className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
                        Linked Account Portfolio ({accounts.length})
                      </h3>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50/50 dark:bg-darkBg/50 text-[10px] uppercase tracking-wider text-gray-400">
                        <tr>
                          <th className="py-2.5 px-3">Account Number</th>
                          <th className="py-2.5 px-3">Product Type</th>
                          <th className="py-2.5 px-3">Opened Date</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-darkBorder font-medium">
                        {accounts.map((acc) => (
                          <tr key={acc.account_id} className="hover:bg-gray-50/50 dark:hover:bg-darkBg/30">
                            <td className="py-2.5 px-3 font-mono font-bold text-gray-800 dark:text-gray-200">
                              {acc.account_id}
                            </td>
                            <td className="py-2.5 px-3 capitalize text-gray-600 dark:text-gray-400">
                              {acc.product_type} Account
                            </td>
                            <td className="py-2.5 px-3 text-gray-500">
                              {acc.open_date ? new Date(acc.open_date).toLocaleDateString() : 'N/A'}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                Active
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <Link
                                to={`/transactions?search=${acc.account_id}`}
                                className="text-blue-500 hover:text-blue-600 font-bold text-[11px] inline-flex items-center gap-1"
                              >
                                View Ledger <ChevronRight className="w-3 h-3" />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Linked Alerts & Cases Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Active Alerts */}
                  <div className="glass-panel p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-500" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
                          Compliance Alerts ({alerts.length})
                        </h3>
                      </div>
                      <Link to="/alerts" className="text-[10px] text-blue-500 font-bold hover:underline">
                        View All Alerts →
                      </Link>
                    </div>

                    {alerts.length === 0 ? (
                      <div className="text-center py-8 text-xs text-gray-400">
                        No compliance alerts triggered on linked accounts.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {alerts.map((al) => (
                          <div
                            key={al.alert_id}
                            className="p-3 rounded-xl bg-gray-50/70 dark:bg-darkBg/50 border border-gray-200/50 dark:border-darkBorder flex items-center justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded ${getRiskBadgeColor(al.level)}`}>
                                  {al.level}
                                </span>
                                <span className="font-mono text-xs font-bold text-gray-800 dark:text-gray-200">
                                  {al.alert_id}
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                                {al.details?.typology || al.status} • Risk Score: {(al.risk_score * 100).toFixed(0)}%
                              </p>
                            </div>
                            <Link
                              to="/alerts"
                              className="px-2.5 py-1 text-[11px] font-bold text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition-colors"
                            >
                              Inspect
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Active Cases */}
                  <div className="glass-panel p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-2">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-amber-500" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
                          Investigative Cases ({cases.length})
                        </h3>
                      </div>
                      <Link to="/cases" className="text-[10px] text-blue-500 font-bold hover:underline">
                        Case Management →
                      </Link>
                    </div>

                    {cases.length === 0 ? (
                      <div className="text-center py-8 text-xs text-gray-400">
                        No investigation cases registered for this entity.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {cases.map((cs) => (
                          <div
                            key={cs.case_id}
                            className="p-3 rounded-xl bg-gray-50/70 dark:bg-darkBg/50 border border-gray-200/50 dark:border-darkBorder flex items-center justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-gray-800 dark:text-gray-200">
                                  {cs.case_id}
                                </span>
                                <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-500">
                                  {cs.status}
                                </span>
                              </div>
                              <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mt-1 truncate max-w-[200px]">
                                {cs.title}
                              </p>
                            </div>
                            <Link
                              to="/cases"
                              className="px-2.5 py-1 text-[11px] font-bold text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition-colors"
                            >
                              Open Case
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Watchlist & PEP Name Screening */}
                <ScreeningPanel
                  API_URL={API_URL}
                  entityType="Customer"
                  entityId={profile?.customer_id}
                  names={[
                    { label: 'Primary Entity', name: profile?.name },
                    ...(profile?.beneficial_owner_ids || []).map(b => ({ label: 'Beneficial Owner', name: b }))
                  ]}
                  initialHits={customerData?.screening?.hits || profile?.screening_hits || []}
                  onDecisionRecorded={() => {
                    if (selectedCustomerId) {
                      axios.get(`${API_URL}/api/customers/${selectedCustomerId}`)
                        .then(res => res.data.success && setCustomerData(res.data.data));
                    }
                  }}
                />

                {/* Recent Transactions Stream */}
                {recentTransactions.length > 0 && (
                  <div className="glass-panel p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 dark:border-darkBorder pb-2">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-800 dark:text-gray-200">
                          Recent Transaction Activity Ledger ({recentTransactions.length})
                        </h3>
                      </div>
                      <Link to="/transactions" className="text-[10px] text-blue-500 font-bold hover:underline">
                        All Transactions →
                      </Link>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50/50 dark:bg-darkBg/50 text-[10px] uppercase tracking-wider text-gray-400">
                          <tr>
                            <th className="py-2.5 px-3">Tx ID</th>
                            <th className="py-2.5 px-3">Sender</th>
                            <th className="py-2.5 px-3">Receiver</th>
                            <th className="py-2.5 px-3">Amount</th>
                            <th className="py-2.5 px-3">Timestamp</th>
                            <th className="py-2.5 px-3 text-right">Risk Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-darkBorder font-medium">
                          {recentTransactions.map((tx) => (
                            <tr key={tx.transaction_id || tx._id} className="hover:bg-gray-50/50 dark:hover:bg-darkBg/30">
                              <td className="py-2.5 px-3 font-mono font-bold text-gray-800 dark:text-gray-200">
                                {tx.transaction_id}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-gray-600 dark:text-gray-400">
                                {tx.sender_account}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-gray-600 dark:text-gray-400">
                                {tx.receiver_account}
                              </td>
                              <td className="py-2.5 px-3 font-bold text-gray-900 dark:text-white">
                                {formatCurrency(tx.amount)}
                              </td>
                              <td className="py-2.5 px-3 text-gray-400">
                                {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : 'N/A'}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                    (tx.risk_score || 0) > 0.6
                                      ? 'bg-rose-500/15 text-rose-500'
                                      : (tx.risk_score || 0) > 0.3
                                      ? 'bg-amber-500/15 text-amber-500'
                                      : 'bg-emerald-500/15 text-emerald-500'
                                  }`}
                                >
                                  {((tx.risk_score || 0) * 100).toFixed(0)}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Customer360;
