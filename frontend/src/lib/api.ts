const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export const BACKEND_UNAVAILABLE_EVENT = "pawpile:backend-unavailable";
export const BACKEND_UNAVAILABLE_MESSAGE = "Connection to backend lost. Please check container status. You may want to refresh the page.";

let backendUnavailableLocked = false;

type ApiErrorPayload = {
  detail?: string | { msg?: string } | Array<{ msg?: string }>;
};

type UploadProgress = {
  loaded: number;
  total: number;
};

function notifyBackendUnavailable() {
  backendUnavailableLocked = true;
  window.dispatchEvent(new Event(BACKEND_UNAVAILABLE_EVENT));
}

function buildBackendUnavailableError(): Error {
  return new Error(BACKEND_UNAVAILABLE_MESSAGE);
}

export function isBackendUnavailableLocked(): boolean {
  return backendUnavailableLocked;
}

export function resolveApiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

function ensureBackendAvailable() {
  if (backendUnavailableLocked) {
    throw buildBackendUnavailableError();
  }
}

export function isBackendUnavailableResponse(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

export function handleBackendUnavailableError(error: unknown): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    throw error;
  }

  if (error instanceof TypeError) {
    notifyBackendUnavailable();
    throw buildBackendUnavailableError();
  }

  throw error;
}

function buildApiError(status: number, statusText: string, bodyText: string): Error {
  try {
    const payload = JSON.parse(bodyText) as ApiErrorPayload;
    if (typeof payload.detail === "string" && payload.detail) {
      return new Error(payload.detail);
    }
    if (Array.isArray(payload.detail) && payload.detail.length > 0 && payload.detail[0]?.msg) {
      return new Error(payload.detail[0].msg);
    }
    if (payload.detail && typeof payload.detail === "object" && "msg" in payload.detail && typeof payload.detail.msg === "string") {
      return new Error(payload.detail.msg);
    }
  } catch {
    // Fall through to status/body based error handling when the response is not JSON.
  }

  const text = bodyText.trim();
  if (text && !text.startsWith("<!DOCTYPE") && !text.startsWith("<html")) {
    return new Error(`Request failed: ${status} (${text.slice(0, 220)})`);
  }

  const readableStatusText = statusText ? ` ${statusText}` : "";
  return new Error(`Request failed: ${status}${readableStatusText}`);
}

async function parseError(response: Response): Promise<Error> {
  const bodyText = await response.text();
  return buildApiError(response.status, response.statusText, bodyText);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  ensureBackendAvailable();

  let response: Response;

  try {
    response = await fetch(resolveApiUrl(path), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  } catch (error) {
    handleBackendUnavailableError(error);
  }

  if (isBackendUnavailableResponse(response.status)) {
    notifyBackendUnavailable();
    throw buildBackendUnavailableError();
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<TRequest, TResponse>(path: string, payload: TRequest, token?: string): Promise<TResponse> {
  ensureBackendAvailable();

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(resolveApiUrl(path), {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    handleBackendUnavailableError(error);
  }

  if (isBackendUnavailableResponse(response.status)) {
    notifyBackendUnavailable();
    throw buildBackendUnavailableError();
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}

export async function apiPatch<TRequest, TResponse>(path: string, payload: TRequest, token?: string): Promise<TResponse> {
  ensureBackendAvailable();

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(resolveApiUrl(path), {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    handleBackendUnavailableError(error);
  }

  if (isBackendUnavailableResponse(response.status)) {
    notifyBackendUnavailable();
    throw buildBackendUnavailableError();
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}

export async function apiDelete<TResponse>(path: string, token?: string): Promise<TResponse> {
  ensureBackendAvailable();

  let response: Response;

  try {
    response = await fetch(resolveApiUrl(path), {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  } catch (error) {
    handleBackendUnavailableError(error);
  }

  if (isBackendUnavailableResponse(response.status)) {
    notifyBackendUnavailable();
    throw buildBackendUnavailableError();
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}

export async function apiPostForm<TResponse>(path: string, formData: FormData, token?: string): Promise<TResponse> {
  ensureBackendAvailable();

  let response: Response;

  try {
    response = await fetch(resolveApiUrl(path), {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData
    });
  } catch (error) {
    handleBackendUnavailableError(error);
  }

  if (isBackendUnavailableResponse(response.status)) {
    notifyBackendUnavailable();
    throw buildBackendUnavailableError();
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}

export async function apiPostFormWithProgress<TResponse>(
  path: string,
  formData: FormData,
  token?: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<TResponse> {
  ensureBackendAvailable();

  return new Promise<TResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", resolveApiUrl(path));
    request.responseType = "text";

    if (token) {
      request.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    request.upload.addEventListener("progress", (event) => {
      if (!onProgress) {
        return;
      }

      onProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : 0,
      });
    });

    request.addEventListener("load", () => {
      const responseText = request.responseText ?? "";

      if (isBackendUnavailableResponse(request.status)) {
        notifyBackendUnavailable();
        reject(buildBackendUnavailableError());
        return;
      }

      if (request.status < 200 || request.status >= 300) {
        reject(buildApiError(request.status, request.statusText, responseText));
        return;
      }

      try {
        resolve(JSON.parse(responseText) as TResponse);
      } catch {
        reject(new Error("Request succeeded but returned invalid JSON"));
      }
    });

    request.addEventListener("error", () => {
      notifyBackendUnavailable();
      reject(buildBackendUnavailableError());
    });

    request.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
    });

    request.send(formData);
  });
}

export async function fetchWebSearchProviders<T>(token?: string): Promise<T> {
  return apiGet<T>("/api/admin/web-search/providers", token);
}

export async function updateWebSearchProvider<TRequest, TResponse>(
  providerType: string,
  payload: TRequest,
  token?: string,
): Promise<TResponse> {
  return apiPatch<TRequest, TResponse>(`/api/admin/web-search/providers/${providerType}`, payload, token);
}

export async function fetchActiveWebSearchProvider<T>(token?: string): Promise<T> {
  return apiGet<T>("/api/admin/web-search/active", token);
}

export async function setActiveWebSearchProvider<T>(providerType: string | null, token?: string): Promise<T> {
  return apiPatch<{ provider_type: string | null }, T>("/api/admin/web-search/active", { provider_type: providerType }, token);
}
