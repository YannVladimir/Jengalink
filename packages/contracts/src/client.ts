// Typed API client generated from the OpenAPI document (apps/api/openapi.json).
// Paths, bodies, params and responses are all checked by TypeScript:
//   const { data } = unwrap(await api.POST('/v1/auth/otp/start', { body: { channel: 'sms', destination } }));
import createClient from 'openapi-fetch';
import type { ApiErrorBody } from './errors';
import type { components, paths } from './generated/openapi';

export type { components, paths };

export interface JengaClientOptions {
  baseUrl: string;
  /** Returns the current access token, if signed in. */
  getAccessToken?: () => string | null | undefined;
  fetch?: typeof globalThis.fetch;
}

export function createJengaClient({ baseUrl, getAccessToken, fetch }: JengaClientOptions) {
  const client = createClient<paths>({ baseUrl, ...(fetch ? { fetch } : {}) });
  if (getAccessToken) {
    client.use({
      onRequest({ request }) {
        const token = getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      },
    });
  }
  return client;
}

export type JengaClient = ReturnType<typeof createJengaClient>;

/** An API error with the spec's body (code, message, requestId…). status 0 = no connection. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Partial<ApiErrorBody>;
  constructor(status: number, message: string, body: Partial<ApiErrorBody> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Returns `data` or throws ApiError with the server's plain-language message. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    const body = (result.error ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(result.response.status, body.message ?? 'Something went wrong. Please try again.', body);
  }
  return result.data as T;
}

/** Runs a request; a network failure becomes ApiError(0) with a friendly message. */
export async function request<T>(send: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await send();
  } catch {
    throw new ApiError(0, 'No connection to JengaLink. Check your internet and try again.');
  }
  return unwrap(result);
}
