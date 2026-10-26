import type { Env } from './env.ts';

/** Thin PostgREST / GoTrue client: no SDK, fully mockable through the injected fetch. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface Supa {
  /** RPC as the service role. */
  service<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** RPC as the end user (their JWT): database functions enforce roles via assert_role. */
  asUser<T>(jwt: string, fn: string, args: Record<string, unknown>): Promise<T>;
  /** GoTrue admin API (service role). */
  authAdmin<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>;
}

export function makeSupa(env: Env, fetchImpl: typeof fetch, timeoutMs = 8000): Supa {
  async function call<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    const body: unknown = text === '' ? null : JSON.parse(text);
    if (!res.ok) {
      const b = (body ?? {}) as { message?: string; msg?: string; code?: string; error_code?: string };
      throw new ApiError(
        res.status,
        b.code ?? b.error_code ?? String(res.status),
        b.message ?? b.msg ?? text,
      );
    }
    return body as T;
  }
  const rpc = <T>(key: string, jwt: string, fn: string, args: Record<string, unknown>): Promise<T> =>
    call<T>(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
  return {
    service: (fn, args) => rpc(env.serviceRoleKey, env.serviceRoleKey, fn, args),
    asUser: (jwt, fn, args) => rpc(env.anonKey, jwt, fn, args),
    authAdmin: (method, path, body) =>
      call(`${env.supabaseUrl}/auth/v1/admin/${path}`, {
        method,
        headers: {
          apikey: env.serviceRoleKey,
          authorization: `Bearer ${env.serviceRoleKey}`,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

/** Maps a database business error to an HTTP response status. */
export function statusFor(e: unknown): number {
  if (e instanceof ApiError) return e.status >= 400 && e.status < 600 ? e.status : 500;
  return 500;
}
