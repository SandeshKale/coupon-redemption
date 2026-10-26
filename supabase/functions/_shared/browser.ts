import type { Deps } from './deps.ts';
import { bearer, corsHeaders, json } from './http.ts';
import { ApiError, statusFor } from './supabase.ts';

export type BrowserHandler = (req: Request, deps: Deps, jwt: string) => Promise<Response>;

/** Wraps a browser-called function: CORS (app origin only), JWT required, typed error mapping. */
export function browserFunction(
  inner: BrowserHandler,
  opts: { requireJwt?: boolean } = {},
): (req: Request, deps: Deps) => Promise<Response> {
  return async (req: Request, deps: Deps): Promise<Response> => {
    const cors = corsHeaders(deps.env.appUrl);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const jwt = bearer(req);
    if ((opts.requireJwt ?? true) && jwt === null) return json(401, { error: 'AUTH_REQUIRED' }, cors);
    try {
      const res = await inner(req, deps, jwt ?? '');
      for (const [k, val] of Object.entries(cors)) res.headers.set(k, val);
      return res;
    } catch (e) {
      const status = statusFor(e);
      const code = e instanceof ApiError ? e.message : 'INTERNAL';
      deps.log.log(status >= 500 ? 'error' : 'warn', 'failed', { status, code });
      return json(status, { error: status >= 500 ? 'INTERNAL' : code }, cors);
    }
  };
}
