import type { Page, Route } from '@playwright/test';

export const API = 'http://api.e2e.test';

type Handler = (args: Record<string, unknown>, route: Route) => unknown;

/** Stubs PostgREST RPC/table calls and Edge Functions by name. Unknown calls fail loudly. */
export async function stubApi(
  page: Page,
  rpc: Record<string, Handler | object>,
  rest: Record<string, unknown> = {},
): Promise<void> {
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    if (m?.[1] !== undefined) {
      const h = rpc[m[1]];
      if (h === undefined)
        return route.fulfill({ status: 404, json: { message: `unstubbed ${m[1]}` } });
      const args = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      const out = typeof h === 'function' ? await (h as Handler)(args, route) : h;
      if (out === 'handled') return undefined;
      return route.fulfill({ json: out });
    }
    const table = url.pathname.replace('/rest/v1/', '');
    return route.fulfill({ json: rest[table] ?? [] });
  });
}

export function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}

/** Puts a dealer session in storage, exactly where the auth SDK keeps it. */
export async function signInDealer(page: Page): Promise<void> {
  await page.addInitScript(
    (token) => {
      // Shape written by @supabase/auth-js (it discards anything less complete).
      localStorage.setItem(
        'sb-24m-auth',
        JSON.stringify({
          access_token: token,
          refresh_token: 'refresh-e2e',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: 'u-1',
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
      );
    },
    jwt({ sub: 'u-1', aal: 'aal1' }),
  );
}

export const CODE = '7KQ2M9XHTB4RC';

export const VALID = {
  result: 'VALID',
  serial: 'P24-0000001',
  value_paise: 10000,
  product: '24M Primer 1 L',
};
export const REDEEMED = {
  result: 'REDEEMED',
  batch_id: 42,
  count: 1,
  value_paise: 10000,
  lines: [],
  at: '2026-10-26T10:00:00Z',
};
export const HOME = {
  today_count: 1,
  today_paise: 10000,
  month_count: 1,
  month_paise: 10000,
  dealer: { name: 'Shree Ganesh Paints', status: 'ACTIVE' },
  user: { name: 'Owner A', role: 'DEALER_OWNER' },
  wa_business_number: '919000000000',
  helpline: '+91 20 0000 0000',
  as_of: '2026-10-26T10:00:00Z',
};
export const PROFILE = [
  { id: 1, name: 'Owner A', role: 'DEALER_OWNER', dealer_id: 1, distributor_id: null },
];
