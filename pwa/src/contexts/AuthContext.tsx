import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthUser } from '../interfaces/types';

interface AuthContextValue {
  user:     AuthUser | null;
  token:    string | null;
  isAdmin:  boolean;
  login:    (email: string, password: string) => Promise<void>;
  logout:   () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user:    null,
  token:   null,
  isAdmin: false,
  login:   async () => {},
  logout:  () => {},
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
    return { token: raw, user: { id: payload.id, email: payload.email, role: payload.role } };
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
    fetch('http://localhost:3000/api/me', {
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
    const res = await fetch(`http://localhost:3000/api/login`, {
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

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, isAdmin: user?.role === 'admin', login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
