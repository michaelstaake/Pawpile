import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { BackgroundImageMode, BootstrapStatus, clearStoredToken, CurrentUser, getStoredToken, LoginResponse, storeToken } from "../lib/session";

type AuthContextValue = {
  token: string;
  user: CurrentUser | null;
  requiresSetup: boolean;
  setupStatus: BootstrapStatus | null;
  bootstrapError: string | null;
  isBootstrapping: boolean;
  isAuthenticating: boolean;
  usersCanRegister: boolean;
  sitename: string;
  backgroundColor: string;
  backgroundImagePath: string | null;
  backgroundImageMode: BackgroundImageMode;
  knowledgeBaseEnabled: boolean;
  refreshAuthState: () => Promise<void>;
  refreshPublicSettings: () => Promise<void>;
  updateProfile: (payload: { email?: string; password?: string }) => Promise<CurrentUser>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  bootstrapAdmin: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const DEFAULT_BACKGROUND_COLOR = "#efe8d2";
const DEFAULT_BACKGROUND_IMAGE_MODE: BackgroundImageMode = "fill";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>(() => getStoredToken());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [setupStatus, setSetupStatus] = useState<BootstrapStatus | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [usersCanRegister, setUsersCanRegister] = useState(false);
  const [sitename, setSitename] = useState("Pawpile");
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND_COLOR);
  const [backgroundImagePath, setBackgroundImagePath] = useState<string | null>(null);
  const [backgroundImageMode, setBackgroundImageMode] = useState<BackgroundImageMode>(DEFAULT_BACKGROUND_IMAGE_MODE);
  const [knowledgeBaseEnabled, setKnowledgeBaseEnabled] = useState(false);

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

  async function refreshPublicSettings() {
    try {
      const bootstrap = await apiGet<BootstrapStatus>("/api/auth/bootstrap-status");
      setUsersCanRegister(bootstrap.users_can_register);
      setSitename(bootstrap.sitename || "Pawpile");
      setBackgroundColor(bootstrap.background_color || DEFAULT_BACKGROUND_COLOR);
      setBackgroundImagePath(bootstrap.background_image_path || null);
      setBackgroundImageMode(bootstrap.background_image_mode || DEFAULT_BACKGROUND_IMAGE_MODE);
      setKnowledgeBaseEnabled(bootstrap.knowledge_base_enabled);
    } catch {
      // silently ignore — UI will retain previous values
    }
  }

  async function refreshAuthState() {
    setIsBootstrapping(true);
    try {
      const bootstrap = await apiGet<BootstrapStatus>("/api/auth/bootstrap-status");
      setBootstrapError(null);
      setSetupStatus(bootstrap);
      setRequiresSetup(bootstrap.requires_setup);
      setUsersCanRegister(bootstrap.users_can_register);
      setSitename(bootstrap.sitename || "Pawpile");
      setBackgroundColor(bootstrap.background_color || DEFAULT_BACKGROUND_COLOR);
      setBackgroundImagePath(bootstrap.background_image_path || null);
      setBackgroundImageMode(bootstrap.background_image_mode || DEFAULT_BACKGROUND_IMAGE_MODE);
      setKnowledgeBaseEnabled(bootstrap.knowledge_base_enabled);

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
      setUsersCanRegister(false);
      setSitename("Pawpile");
      setBackgroundColor(DEFAULT_BACKGROUND_COLOR);
      setBackgroundImagePath(null);
      setBackgroundImageMode(DEFAULT_BACKGROUND_IMAGE_MODE);
      setKnowledgeBaseEnabled(false);
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
      setUsersCanRegister(bootstrap.users_can_register);
      setSitename(bootstrap.sitename || "Pawpile");
      setBackgroundColor(bootstrap.background_color || DEFAULT_BACKGROUND_COLOR);
      setBackgroundImagePath(bootstrap.background_image_path || null);
      setBackgroundImageMode(bootstrap.background_image_mode || DEFAULT_BACKGROUND_IMAGE_MODE);
      setKnowledgeBaseEnabled(bootstrap.knowledge_base_enabled);
      setBootstrapError(null);
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function register(username: string, email: string, password: string) {
    setIsAuthenticating(true);
    try {
      const response = await apiPost<{ username: string; email: string; password: string }, LoginResponse>("/api/auth/register", {
        username,
        email,
        password,
      });
      storeToken(response.access_token);
      setToken(response.access_token);
      const currentUser = await apiGet<CurrentUser>("/api/auth/me", response.access_token);
      const bootstrap = await apiGet<BootstrapStatus>("/api/auth/bootstrap-status");
      setKnowledgeBaseEnabled(bootstrap.knowledge_base_enabled);
      setBootstrapError(null);
      setUser(currentUser);
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function updateProfile(payload: { email?: string; password?: string }) {
    if (!token) {
      throw new Error("You must be signed in to update your profile");
    }

    const currentUser = await apiPatch<{ email?: string; password?: string }, CurrentUser>("/api/auth/me", payload, token);
    setUser(currentUser);
    return currentUser;
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
        usersCanRegister,
        sitename,
        backgroundColor,
        backgroundImagePath,
        backgroundImageMode,
        knowledgeBaseEnabled,
        refreshAuthState,
        refreshPublicSettings,
        updateProfile,
        login,
        register,
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