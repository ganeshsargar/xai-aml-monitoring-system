import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';

export const AuthContext = createContext();

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050';
const ML_SERVICE_URL = import.meta.env.VITE_ML_SERVICE_URL || 'http://localhost:5000';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize Axios and restore user session on mount
  useEffect(() => {
    const token = localStorage.getItem('aml_token');
    const storedUser = localStorage.getItem('aml_user');

    if (token && storedUser) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setUser(JSON.parse(storedUser));
      
      // Verify token validity by calling profile API
      axios.get(`${API_URL}/api/auth/profile`)
        .then(res => {
          if (res.data.success) {
            setUser(res.data.user);
            localStorage.setItem('aml_user', JSON.stringify(res.data.user));
          }
        })
        .catch(err => {
          console.warn("Session validation failed. Logging out.");
          logout();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
      if (res.data.success) {
        const { token, user: loggedUser } = res.data;
        
        localStorage.setItem('aml_token', token);
        localStorage.setItem('aml_user', JSON.stringify(loggedUser));
        
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        setUser(loggedUser);
        setLoading(false);
        return { success: true };
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check network.');
      setLoading(false);
      return { success: false, error: err.response?.data?.error || 'Login failed.' };
    }
  };

  const logout = () => {
    localStorage.removeItem('aml_token');
    localStorage.removeItem('aml_user');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const updateProfile = async (name, password) => {
    try {
      const res = await axios.put(`${API_URL}/api/auth/profile`, { name, password });
      if (res.data.success) {
        const updated = res.data.user;
        setUser(updated);
        localStorage.setItem('aml_user', JSON.stringify(updated));
        return { success: true };
      }
    } catch (err) {
      return { success: false, error: err.response?.data?.error || 'Failed to update profile.' };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, updateProfile, API_URL, ML_SERVICE_URL }}>
      {children}
    </AuthContext.Provider>
  );
};
