import * as v from 'valibot';

/** Every way a request can fail, so the UI can map each one to clear, safe copy (§16.1). */
export type ApiFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'captive' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network' }
  | { readonly kind: 'auth' }
  | { readonly kind: 'forbidden'; readonly code: string }
  | { readonly kind: 'business'; readonly code: string; readonly status: number }
  | { readonly kind: 'server'; readonly status: number }
  | { readonly kind: 'schema' };

export type ApiResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiFailure };

export interface ClientDeps {
  readonly baseUrl: string;
  readonly anonKey: string;
  readonly fetch: typeof fetch;
  readonly getToken: () => Promise<string | null>;
  readonly online: () => boolean;
}

export interface CallOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const ErrorBody = v.object({ message: v.optional(v.string()), code: v.optional(v.string()) });

export interface Api {
  rpc<T>(
    fn: string,
    args: Record<string, unknown>,
    schema: v.GenericSchema<unknown, T>,
    opts?: CallOptions,
  ): Promise<ApiResult<T>>;
  select<T>(
    path: string,
    schema: v.GenericSchema<unknown, T>,
    opts?: CallOptions,
  ): Promise<ApiResult<T>>;
}

/**
 * Thin PostgREST client (≈ 2 KB) for the dealer critical path: no SDK, explicit timeout,
 * captive-portal detection, and runtime validation of every response.
 */
export function createApi(deps: ClientDeps): Api {
  async function request<T>(
    url: string,
    init: RequestInit,
    schema: v.GenericSchema<unknown, T>,
    opts: CallOptions,
  ): Promise<ApiResult<T>> {
    if (!deps.online()) return fail({ kind: 'offline' });
    const token = await deps.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, opts.timeoutMs ?? 12_000);
    if (opts.signal?.aborted === true) controller.abort();
    opts.signal?.addEventListener('abort', () => {
      controller.abort();
    });
    let res: Response;
    try {
      res = await deps.fetch(url, {
        ...init,
        headers: {
          apikey: deps.anonKey,
          authorization: `Bearer ${token ?? deps.anonKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch {
      return fail(
        controller.signal.aborted
          ? { kind: 'timeout' }
          : deps.online()
            ? { kind: 'network' }
            : { kind: 'offline' },
      );
    } finally {
      clearTimeout(timer);
    }
    return parse(res, schema);
  }
  return {
    rpc: (fn, args, schema, opts = {}) =>
      request(
        `${deps.baseUrl}/rest/v1/rpc/${fn}`,
        { method: 'POST', body: JSON.stringify(args) },
        schema,
        opts,
      ),
    select: (path, schema, opts = {}) =>
      request(`${deps.baseUrl}/rest/v1/${path}`, { method: 'GET' }, schema, opts),
  };
}

async function parse<T>(res: Response, schema: v.GenericSchema<unknown, T>): Promise<ApiResult<T>> {
  // A captive portal or proxy answers with HTML: treat as offline (EC-047).
  if (!(res.headers.get('content-type') ?? '').includes('json') && res.status !== 204)
    return fail({ kind: 'captive' });
  let body: unknown;
  try {
    body = res.status === 204 ? null : await res.json();
  } catch {
    return fail(res.ok ? { kind: 'schema' } : { kind: 'server', status: res.status });
  }
  if (!res.ok) return fail(errorFor(res.status, body));
  const parsed = v.safeParse(schema, body);
  return parsed.success ? { ok: true, data: parsed.output } : fail({ kind: 'schema' });
}

function errorFor(status: number, body: unknown): ApiFailure {
  const err = v.safeParse(ErrorBody, body);
  const code = err.success ? (err.output.message ?? err.output.code ?? '') : '';
  if (status === 401) return { kind: 'auth' };
  if (status === 403) return { kind: 'forbidden', code: code === '' ? 'FORBIDDEN' : code };
  if (status >= 500) return { kind: 'server', status };
  return { kind: 'business', code: code === '' ? String(status) : code, status };
}

function fail<T>(error: ApiFailure): ApiResult<T> {
  return { ok: false, error };
}

/** Failures after which we cannot know whether the server committed the request. */
export function outcomeUnknown(e: ApiFailure): boolean {
  return (
    e.kind === 'timeout' ||
    e.kind === 'network' ||
    e.kind === 'server' ||
    e.kind === 'captive' ||
    e.kind === 'offline'
  );
}
