import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthUser } from '../interfaces/types';
import { API_BASE } from '../constants';

interface AuthContextValue {
  user:     AuthUser | null;
  token:    string | null;
  isAdmin:  boolean;
  isUser:   boolean;
  login:    (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout:   () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user:     null,
  token:    null,
  isAdmin:  false,
  isUser:   false,
  login:    async () => {},
  register: async () => {},
  logout:   () => {},
});

const TOKEN_KEY = 'auth_token';

const loadStoredToken = (): { token: string; user: AuthUser } | null => {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    // Decode payload (middle segment of JWT) to check expiry without a library
    const payload = JSON.parse(atob(raw.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return { token: raw, user: { id: payload.id, email: payload.email, role: payload.role, tier: payload.tier ?? payload.role } };
  } catch {
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const stored = loadStoredToken();
  const [token, setToken]     = useState<string | null>(stored?.token ?? null);
  const [user,  setUser]      = useState<AuthUser | null>(stored?.user ?? null);
  const [ready, setReady]     = useState(!stored); // skip check if no stored token

  // Verify stored token against the server on startup
  useEffect(() => {
    if (!stored) return;
    fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${stored.token}` },
    }).then(res => {
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      }
    }).catch(() => {
      // Server unreachable — keep token, let individual API calls fail naturally
    }).finally(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep storage in sync whenever token changes
  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  if (!ready) return null;

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Login failed');
    }
    const data = await res.json();
    setToken(data.token);
    setUser(data.user);
  };

  const register = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Registration failed');
    }
    const data = await res.json();
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  // Gate on the role's *tier* (roles-table ladder), so custom roles aliased
  // onto a tier pass its rung. Pre-tier tokens carry only the role name —
  // for the three system roles name === tier.
  const tier = user ? (user.tier ?? user.role) : null;

  return (
    <AuthContext.Provider value={{
      user, token,
      isAdmin: tier === 'admin',
      isUser:  tier === 'user' || tier === 'admin',
      login, register, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
