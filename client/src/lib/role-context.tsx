import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { UserRole } from "@shared/schema";

interface RoleContextValue {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  currentTenantId: string | null;
  setCurrentTenantId: (id: string | null) => void;
  currentUserId: string | null;
  setCurrentUserId: (id: string | null) => void;
  currentUserName: string | null;
  setCurrentUserName: (name: string | null) => void;
  canAccess: (requiredRoles: UserRole[]) => boolean;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [currentRole, setCurrentRoleState] = useState<UserRole>(() => {
    return (localStorage.getItem("app_role") as UserRole) || "superadmin";
  });
  const [currentTenantId, setCurrentTenantIdState] = useState<string | null>(() => {
    return localStorage.getItem("app_tenantId") || null;
  });
  const [currentUserId, setCurrentUserIdState] = useState<string | null>(() => {
    return localStorage.getItem("app_userId") || null;
  });
  const [currentUserName, setCurrentUserNameState] = useState<string | null>(() => {
    return localStorage.getItem("app_userName") || null;
  });

  const setCurrentRole = useCallback((role: UserRole) => {
    setCurrentRoleState(role);
    localStorage.setItem("app_role", role);
  }, []);

  const setCurrentTenantId = useCallback((id: string | null) => {
    setCurrentTenantIdState(id);
    if (id) localStorage.setItem("app_tenantId", id);
    else localStorage.removeItem("app_tenantId");
  }, []);

  const setCurrentUserId = useCallback((id: string | null) => {
    setCurrentUserIdState(id);
    if (id) localStorage.setItem("app_userId", id);
    else localStorage.removeItem("app_userId");
  }, []);

  const setCurrentUserName = useCallback((name: string | null) => {
    setCurrentUserNameState(name);
    if (name) localStorage.setItem("app_userName", name);
    else localStorage.removeItem("app_userName");
  }, []);

  const canAccess = useCallback(
    (requiredRoles: UserRole[]) => requiredRoles.includes(currentRole),
    [currentRole]
  );

  return (
    <RoleContext.Provider value={{ currentRole, setCurrentRole, currentTenantId, setCurrentTenantId, currentUserId, setCurrentUserId, currentUserName, setCurrentUserName, canAccess }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
