import { browserFunction } from '../_shared/browser.ts';
import { json } from '../_shared/http.ts';
import { readJson, UserStatusInput } from '../_shared/schemas.ts';

/** §10.1 step 5: app_user.status (checked by every function, immediate) + Auth ban to end sessions. */
export const handler = browserFunction(async (req, deps, jwt) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const input = await readJson(req, UserStatusInput);
  if (input === null) return json(400, { error: 'BAD_REQUEST' });
  const r = await deps.supa.asUser<{ auth_user_id: string | null; status: string }>(jwt, 'set_user_status', {
    p_user_id: input.user_id,
    p_status: input.status,
    p_reason: input.reason,
  });
  if (r.auth_user_id !== null) {
    await deps.supa.authAdmin('PUT', `users/${r.auth_user_id}`, {
      ban_duration: input.status === 'INACTIVE' ? '876000h' : 'none',
    });
  }
  deps.log.log('info', 'status_set', { user_id: input.user_id, status: input.status });
  return json(200, { user_id: input.user_id, status: r.status });
});
