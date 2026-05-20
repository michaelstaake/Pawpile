const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseError(response: Response): Promise<Error> {
  const bodyText = await response.text();

  try {
    const payload = JSON.parse(bodyText) as { detail?: string | { msg?: string } | Array<{ msg?: string }> };
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
    return new Error(`Request failed: ${response.status} (${text.slice(0, 220)})`);
  }

  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return new Error(`Request failed: ${response.status}${statusText}`);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<TRequest, TResponse>(path: string, payload: TRequest, token?: string): Promise<TResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}

export async function apiPatch<TRequest, TResponse>(path: string, payload: TRequest, token?: string): Promise<TResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}

export async function apiDelete<TResponse>(path: string, token?: string): Promise<TResponse> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}

export async function apiPostForm<TResponse>(path: string, formData: FormData, token?: string): Promise<TResponse> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<TResponse>;
}
