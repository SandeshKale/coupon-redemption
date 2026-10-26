import { browserFunction } from '../_shared/browser.ts';
import { clientIp, json } from '../_shared/http.ts';
import { normaliseE164 } from '../_shared/lib/phone.ts';
import { LinkRequestInput, readJson } from '../_shared/schemas.ts';

/**
 * Logged-out "Request new link" (§10.1 step 4). No JWT. The database rate-limits per IP and
 * always answers RECEIVED, so the endpoint cannot be used to discover registered numbers.
 */
export const handler = browserFunction(async (req, deps) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const input = await readJson(req, LinkRequestInput, 1024);
  if (input === null) return json(400, { error: 'BAD_REQUEST' });
  const mobile = normaliseE164(input.mobile);
  if (mobile === null) return json(400, { error: 'BAD_MOBILE' });
  const r = await deps.supa.service<{ result: string }>('record_login_link_request', {
    p_mobile: mobile,
    p_ip: clientIp(req),
  });
  return json(r.result === 'RATE_LIMITED' ? 429 : 202, { result: r.result });
}, { requireJwt: false });
