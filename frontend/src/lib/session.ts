export const AUTH_TOKEN_KEY = "pawpile.authToken";
const LEGACY_ADMIN_TOKEN_KEY = "pawpile.adminToken";

export type BackgroundImageMode = "fill" | "stretch" | "repeat";

export type BootstrapStatus = {
  requires_setup: boolean;
  has_admin_user: boolean;
  has_enabled_device: boolean;
  has_active_model: boolean;
  users_can_register: boolean;
  sitename: string;
  background_color: string;
  background_image_path: string | null;
  background_image_mode: BackgroundImageMode;
};

export type CurrentUser = {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
};

export function getStoredToken(): string {
  const authToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (authToken) {
    return authToken;
  }

  const legacyToken = window.localStorage.getItem(LEGACY_ADMIN_TOKEN_KEY) ?? "";
  if (legacyToken) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, legacyToken);
    window.localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  }
  return legacyToken;
}

export function storeToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  window.localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: AUTH_TOKEN_KEY, newValue: token }));
}

export function clearStoredToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: AUTH_TOKEN_KEY, newValue: null }));
}