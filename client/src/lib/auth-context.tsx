import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type PresenceStatus = "active" | "busy" | "break" | "offline";

interface AuthUser {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  role: "superadmin" | "businessadmin" | "teamleader" | "employee";
  tenantId?: string;
  teamIds?: string[];
  acwTimeLimit?: number;
  presenceStatus?: PresenceStatus;
  presenceReason?: string;
  allowedBusyReasons?: string[];
  busyReasons?: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  updatePresence: (status: PresenceStatus, reason?: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get("_t");
    if (urlToken) {
      localStorage.setItem("auth_token", urlToken);
      const urlUser = urlParams.get("_u");
      if (urlUser) {
        try { localStorage.setItem("auth_user", decodeURIComponent(urlUser)); } catch {}
      }
      urlParams.delete("_t");
      urlParams.delete("_u");
      const cleanUrl = window.location.pathname + (urlParams.toString() ? `?${urlParams.toString()}` : "");
      window.history.replaceState({}, "", cleanUrl);
      return urlToken;
    }
    return localStorage.getItem("auth_token");
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Skip token validation if an OTC code is in the URL — the OTC exchange will handle auth
    const hasOtc = !!new URLSearchParams(window.location.search).get("otc");
    if (hasOtc) {
      setIsLoading(false);
      return;
    }
    if (token) {
      validateToken();
    } else {
      setIsLoading(false);
    }
  }, []);

  async function validateToken() {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        localStorage.removeItem("auth_token");
        setToken(null);
      }
    } catch {
      localStorage.removeItem("auth_token");
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    localStorage.setItem("auth_token", newToken);
    localStorage.setItem("auth_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const updatePresence = useCallback((status: PresenceStatus, reason?: string) => {
    setUser(prev => prev ? { ...prev, presenceStatus: status, presenceReason: reason || "" } : prev);
  }, []);

  const logout = useCallback(async () => {
    const loginPath = localStorage.getItem("login_path") || "/login";
    try {
      if (token) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      localStorage.removeItem("login_path");
      setToken(null);
      setUser(null);
      window.location.href = loginPath;
    }
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        updatePresence,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
