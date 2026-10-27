import { browserFunction } from '../_shared/browser.ts';
import { clientIp, json } from '../_shared/http.ts';
import { normaliseE164 } from '../_shared/lib/phone.ts';
import { PinLoginInput, readJson } from '../_shared/schemas.ts';

interface Check {
  result: 'OK' | 'FAILED' | 'RATE_LIMITED';
  why?: string;
  email?: string;
}

interface GeneratedLink {
  hashed_token?: string;
  properties?: { hashed_token?: string };
}

/**
 * Mobile + 4-digit PIN login for dealers, distributors and sales reps. The database checks the PIN
 * (rate limit, lockout); this function then turns an accepted login into a normal Supabase session
 * by generating a one-time link and redeeming it at once, so row-level security works as usual.
 * Every failure is the same 401, so the endpoint cannot be used to find registered numbers.
 */
export const handler = browserFunction(async (req, deps) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const input = await readJson(req, PinLoginInput, 1024);
  if (input === null) return json(400, { error: 'BAD_REQUEST' });
  const mobile = normaliseE164(input.mobile);
  if (mobile === null) return json(401, { error: 'LOGIN_FAILED' });

  const check = await deps.supa.service<Check>('pin_login_check', {
    p_mobile: mobile,
    p_pin: input.pin,
    p_ip: clientIp(req),
  });
  if (check.result === 'RATE_LIMITED') return json(429, { error: 'RATE_LIMITED' });
  if (check.result !== 'OK' || check.email === undefined) {
    deps.log.log('warn', 'pin_login_failed', { why: check.why ?? 'unknown' });
    return json(401, { error: 'LOGIN_FAILED' });
  }

  const link = await deps.supa.authAdmin<GeneratedLink>('POST', 'generate_link', {
    type: 'magiclink',
    email: check.email,
  });
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token;
  if (tokenHash === undefined) return json(502, { error: 'SESSION_FAILED' });
  const session = await deps.supa.authVerify(tokenHash);
  deps.log.log('info', 'pin_login_ok', {});
  return json(200, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: 'bearer',
  });
}, { requireJwt: false });
