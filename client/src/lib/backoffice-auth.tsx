import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface BackofficeUser {
  userId: string;
  tenantId: string;
  role: string;
  name: string;
}

interface BackofficeAuthContextType {
  user: BackofficeUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, user: BackofficeUser) => void;
  logout: () => void;
}

const BackofficeAuthContext = createContext<BackofficeAuthContextType | null>(null);

const TOKEN_KEY = "backoffice_jwt";

export function BackofficeAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<BackofficeUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    fetch("/api/v1/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error("invalid");
        return res.json();
      })
      .then((data) => setUser(data.user))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback((newToken: string, newUser: BackofficeUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    window.location.href = "/backoffice/login";
  }, []);

  return (
    <BackofficeAuthContext.Provider value={{ user, token, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </BackofficeAuthContext.Provider>
  );
}

export function useBackofficeAuth() {
  const ctx = useContext(BackofficeAuthContext);
  if (!ctx) throw new Error("useBackofficeAuth must be used within BackofficeAuthProvider");
  return ctx;
}
