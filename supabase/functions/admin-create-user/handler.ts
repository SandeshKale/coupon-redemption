import { browserFunction } from '../_shared/browser.ts';
import { json } from '../_shared/http.ts';
import { normaliseE164 } from '../_shared/lib/phone.ts';
import { CreateUserInput, readJson } from '../_shared/schemas.ts';
import { ApiError } from '../_shared/supabase.ts';

interface AuthUser {
  id: string;
}

/**
 * Creates the Auth user (internal email, never emailed) and the app_user row, with the 4-digit PIN
 * the creator chose. For a new dealer (role DEALER_OWNER, no dealer_id) the dealer record is created
 * in the same database step. Authorisation is decided by the database (precheck_new_user, under
 * the caller's JWT).
 */
export const handler = browserFunction(async (req, deps, jwt) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const input = await readJson(req, CreateUserInput);
  if (input === null) return json(400, { error: 'BAD_REQUEST' });
  const isM24 = input.role.startsWith('M24_');
  const mobile = input.mobile === undefined ? null : normaliseE164(input.mobile);
  if (input.mobile !== undefined && mobile === null) return json(400, { error: 'BAD_MOBILE' });
  if (!isM24 && mobile === null) return json(400, { error: 'MOBILE_REQUIRED' });
  if (isM24 && input.email === undefined) return json(400, { error: 'EMAIL_REQUIRED' });
  if (!isM24 && input.pin === undefined) return json(400, { error: 'PIN_REQUIRED' });

  const pre = await deps.supa.asUser<{ created_by: number; email_domain: string }>(jwt, 'precheck_new_user', {
    p_name: input.name,
    p_mobile: mobile,
    p_role: input.role,
    p_dealer_id: input.dealer_id ?? null,
    p_distributor_id: input.distributor_id ?? null,
    p_parent_distributor: input.parent_distributor_id ?? null,
    p_is_rep: input.is_rep ?? false,
  });

  const placeholder = `pending-${crypto.randomUUID()}@${pre.email_domain}`;
  const email = isM24 ? (input.email ?? placeholder) : placeholder;
  const authUser = await deps.supa.authAdmin<AuthUser>('POST', 'users', {
    email,
    email_confirm: true,
    user_metadata: { name: input.name },
  });

  let userId: number;
  try {
    userId = await deps.supa.service<number>('register_app_user', {
      p_auth_user_id: authUser.id,
      p_name: input.name,
      p_mobile: mobile,
      p_email: email,
      p_role: input.role,
      p_dealer_id: input.dealer_id ?? null,
      p_distributor_id: input.distributor_id ?? null,
      p_created_by: pre.created_by,
      p_request_id: input.request_id ?? null,
      p_pin: input.pin ?? null,
      p_is_rep: input.is_rep ?? false,
      p_gst: input.gst ?? null,
      p_parent_distributor_id: input.parent_distributor_id ?? null,
    });
  } catch (e) {
    // Compensate: never leave an Auth user without an app_user.
    await deps.supa.authAdmin('DELETE', `users/${authUser.id}`).catch(() => undefined);
    throw e instanceof ApiError ? e : new ApiError(500, 'INTERNAL', 'register failed');
  }

  if (!isM24) {
    // Plan §10.1: internal email u<id>@users.<domain>; best effort (the placeholder also works).
    const internal = `u${userId}@${pre.email_domain}`;
    try {
      await deps.supa.authAdmin('PUT', `users/${authUser.id}`, { email: internal, email_confirm: true });
      await deps.supa.service('set_app_user_email', { p_user_id: userId, p_email: internal });
    } catch {
      deps.log.log('warn', 'internal_email_not_set', { user_id: userId });
    }
  }
  deps.log.log('info', 'created', { user_id: userId, role: input.role });
  return json(201, { user_id: userId });
});
