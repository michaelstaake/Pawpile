import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { BootstrapStatus, clearStoredToken, CurrentUser, getStoredToken, LoginResponse, storeToken } from "../lib/session";

type AuthContextValue = {
  token: string;
  user: CurrentUser | null;
  requiresSetup: boolean;
  setupStatus: BootstrapStatus | null;
  bootstrapError: string | null;
  isBootstrapping: boolean;
  isAuthenticating: boolean;
  refreshAuthState: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  bootstrapAdmin: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>(() => getStoredToken());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [setupStatus, setSetupStatus] = useState<BootstrapStatus | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "pawpile.authToken") {
        setToken(event.newValue ?? "");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    void refreshAuthState();
  }, [token]);

  async function refreshAuthState() {
    setIsBootstrapping(true);
    try {
      const bootstrap = await apiGet<BootstrapStatus>("/api/auth/bootstrap-status");
      setBootstrapError(null);
      setSetupStatus(bootstrap);
      setRequiresSetup(bootstrap.requires_setup);

      if (!token) {
        setUser(null);
        return;
      }

      try {
        const currentUser = await apiGet<CurrentUser>("/api/auth/me", token);
        setUser(currentUser);
      } catch (error) {
        setUser(null);
        clearStoredToken();
        setToken("");
        throw error;
      }
    } catch (error) {
      setUser(null);
      setSetupStatus(null);
      setRequiresSetup(false);
      setBootstrapError(error instanceof Error ? error.message : "Unable to load installation state");
    } finally {
      setIsBootstrapping(false);
    }
  }

  async function login(username: string, password: string) {
    setIsAuthenticating(true);
    try {
      const response = await apiPost<{ username: string; password: string }, LoginResponse>("/api/auth/login", { username, password });
      storeToken(response.access_token);
      setToken(response.access_token);
      const currentUser = await apiGet<CurrentUser>("/api/auth/me", response.access_token);
      setBootstrapError(null);
      setUser(currentUser);
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function bootstrapAdmin(username: string, email: string, password: string) {
    setIsAuthenticating(true);
    try {
      const response = await apiPost<{ username: string; email: string; password: string }, LoginResponse>("/api/auth/bootstrap-admin", {
        username,
        email,
        password,
      });
      storeToken(response.access_token);
      setToken(response.access_token);
      const currentUser = await apiGet<CurrentUser>("/api/auth/me", response.access_token);
      const bootstrap = await apiGet<BootstrapStatus>("/api/auth/bootstrap-status");
      setUser(currentUser);
      setSetupStatus(bootstrap);
      setRequiresSetup(bootstrap.requires_setup);
      setBootstrapError(null);
    } finally {
      setIsAuthenticating(false);
    }
  }

  function logout() {
    clearStoredToken();
    setToken("");
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        requiresSetup,
        setupStatus,
        bootstrapError,
        isBootstrapping,
        isAuthenticating,
        refreshAuthState,
        login,
        bootstrapAdmin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}