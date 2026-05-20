const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload.detail) {
      return new Error(payload.detail);
    }
  } catch {
    // Fall through to the generic message when the response is not JSON.
  }
  return new Error(`Request failed: ${response.status}`);
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
