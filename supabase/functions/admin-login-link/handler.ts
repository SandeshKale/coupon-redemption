import { browserFunction } from '../_shared/browser.ts';
import { json } from '../_shared/http.ts';
import { waShareLink } from '../_shared/lib/whatsapp.ts';
import { LoginLinkInput, readJson } from '../_shared/schemas.ts';

interface Target {
  user_id: number;
  email: string;
  mobile_e164: string | null;
  name: string;
  issued_by: number;
}

/** §10.1 step 2: one-time magic link, returned for sharing from the admin's own WhatsApp (₹0). */
export const handler = browserFunction(async (req, deps, jwt) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const input = await readJson(req, LoginLinkInput);
  if (input === null) return json(400, { error: 'BAD_REQUEST' });
  const t = await deps.supa.asUser<Target>(jwt, 'login_link_target', { p_user_id: input.user_id });
  const link = await deps.supa.authAdmin<{ action_link?: string; properties?: { action_link?: string } }>(
    'POST',
    'generate_link',
    {
      type: 'magiclink',
      email: t.email,
      redirect_to: `${deps.env.appUrl}/auth/callback`,
    },
  );
  const actionLink = link.action_link ?? link.properties?.action_link;
  if (actionLink === undefined) return json(502, { error: 'LINK_FAILED' });
  await deps.supa.service('record_login_link_issued', { p_user_id: t.user_id, p_issued_by: t.issued_by });
  const text =
    `नमस्ते ${t.name} 🙏 24M कूपन ऐप लॉगिन लिंक (24 घंटे, एक बार):\nHello ${t.name}, your 24M coupon app login link (valid 24 h, one use):\n${actionLink}`;
  deps.log.log('info', 'link_issued', { user_id: t.user_id });
  return json(200, {
    link: actionLink,
    whatsapp_url: t.mobile_e164 === null ? null : waShareLink(t.mobile_e164, text),
  });
});
