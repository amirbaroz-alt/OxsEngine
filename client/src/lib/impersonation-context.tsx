import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "./auth-context";

interface ImpersonationContextType {
  isImpersonated: boolean;
  impersonatorId: string | null;
}

const ImpersonationContext = createContext<ImpersonationContextType>({
  isImpersonated: false,
  impersonatorId: null,
});

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(atob(pad.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();

  const value = useMemo<ImpersonationContextType>(() => {
    if (!token) return { isImpersonated: false, impersonatorId: null };
    const payload = decodeJwtPayload(token);
    return {
      isImpersonated: payload?.isImpersonated === true,
      impersonatorId: (payload?.impersonatorId as string) ?? null,
    };
  }, [token]);

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
