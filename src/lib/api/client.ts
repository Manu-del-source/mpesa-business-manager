/**
 * Centralized Typed API Client for OMNI Financial Infrastructure Console.
 *
 * Implements:
 * - RFC 7807 Problem Details error parsing
 * - Consistent request / response typing
 * - X-Environment & X-Request-Id header propagation
 * - Timeout handling
 * - No raw fetch scattering across UI components
 */

export type ApiProblemDetails = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
};

export class ApiClientError extends Error {
  public status: number;
  public code: string;
  public details?: ApiProblemDetails;
  public validationErrors?: Record<string, string[]>;

  constructor(status: number, message: string, code = "API_ERROR", details?: ApiProblemDetails) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.validationErrors = details?.errors;
  }
}

export type RequestOptions = {
  environment?: "SANDBOX" | "LIVE";
  headers?: Record<string, string>;
  signal?: AbortSignal;
  params?: Record<string, string | number | boolean | undefined | null>;
};

/**
 * Base fetch wrapper with error handling and environment scoping.
 */
export async function apiFetch<T>(
  endpoint: string,
  // Omit RequestInit's `headers` so it does not union with RequestOptions'
  // stricter Record<string, string> form.
  options: Omit<RequestInit, "headers"> & RequestOptions = {}
): Promise<T> {
  const { environment, params, headers: customHeaders, ...fetchInit } = options;

  // Build URL with query params
  let url = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && val !== "") {
        searchParams.set(key, String(val));
      }
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes("?") ? "&" : "?") + query;
    }
  }

  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "X-Request-Id": requestId,
    ...customHeaders,
  };

  if (environment) {
    headers["X-Environment"] = environment;
  }

  if (fetchInit.body && typeof fetchInit.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(url, {
      ...fetchInit,
      headers,
    });

    if (!res.ok) {
      let errorJson: ApiProblemDetails | null = null;
      try {
        errorJson = await res.json();
      } catch {
        // Not JSON
      }

      const status = res.status;
      const message =
        (errorJson as { error?: { message?: string } })?.error?.message ||
        errorJson?.detail ||
        errorJson?.title ||
        `Request failed with status ${status}`;
      const code =
        (errorJson as { error?: { code?: string } })?.error?.code ||
        errorJson?.code ||
        `HTTP_${status}`;

      throw new ApiClientError(status, message, code, errorJson || undefined);
    }

    if (res.status === 204) {
      return {} as T;
    }

    return await res.json();
  } catch (err) {
    if (err instanceof ApiClientError) {
      throw err;
    }
    throw new ApiClientError(
      0,
      err instanceof Error ? err.message : "Network error or connection refused",
      "NETWORK_ERROR"
    );
  }
}
