import React, { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, AuthContext } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Alerts from './pages/Alerts';
import Cases from './pages/Cases';
import AdminPanel from './pages/AdminPanel';
import RiskMap from './pages/RiskMap';
import Home from './pages/Home';

// Protected Route Wrapper enforcing JWT validation and Role checks
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-darkBg transition-colors duration-300">
        <div className="flex flex-col items-center space-y-4">
          <img src="/favicon.png" className="w-16 h-16 animate-pulse object-contain" alt="FundTrace AI Logo" />
          <div className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 animate-pulse">
            Establishing Secure Link...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900 transition-colors duration-200 dark:bg-darkBg dark:text-gray-100">
      <Sidebar />
      {children}
    </div>
  );
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public Home Landing */}
      <Route path="/" element={<Home />} />

      {/* Public Login */}
      <Route path="/login" element={<Login />} />

      {/* Protected Compliance Core Views */}
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute allowedRoles={['Admin', 'Investigator', 'Auditor']}>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/transactions" 
        element={
          <ProtectedRoute allowedRoles={['Admin', 'Investigator', 'Auditor']}>
            <Transactions />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/alerts" 
        element={
          <ProtectedRoute allowedRoles={['Admin', 'Investigator', 'Auditor']}>
            <Alerts />
          </ProtectedRoute>
        } 
      />

      {/* World Risk Map */}
      <Route 
        path="/risk-map" 
        element={
          <ProtectedRoute allowedRoles={['Admin', 'Investigator', 'Auditor']}>
            <RiskMap />
          </ProtectedRoute>
        } 
      />

      {/* Investigator Escapes */}
      <Route 
        path="/cases" 
        element={
          <ProtectedRoute allowedRoles={['Admin', 'Investigator']}>
            <Cases />
          </ProtectedRoute>
        } 
      />

      {/* Auditor Console */}
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute allowedRoles={['Admin', 'Auditor']}>
            <AdminPanel />
          </ProtectedRoute>
        } 
      />

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
