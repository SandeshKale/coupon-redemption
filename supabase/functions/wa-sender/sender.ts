import type { Deps } from '../_shared/deps.ts';
import { sendText } from '../_shared/meta.ts';

interface OutboxRow {
  id: number;
  to_e164: string;
  body: string;
  attempts: number;
}

/** Drains due outbox rows (leased with SKIP LOCKED in the database) — §6.7. */
export async function drainOutbox(deps: Deps, maxRounds = 5): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const rows = await deps.supa.service<OutboxRow[]>('wa_claim_outbox', { p_limit: 20 });
    if (rows.length === 0) break;
    for (const row of rows) {
      const r = await sendText(
        deps.fetch,
        {
          graphVersion: deps.env.metaGraphVersion,
          phoneNumberId: deps.env.metaPhoneNumberId,
          accessToken: deps.env.metaAccessToken,
        },
        row.to_e164,
        row.body,
      );
      if (r.ok) {
        await deps.supa.service('wa_mark_sent', { p_id: row.id, p_meta_id: r.id ?? null });
        sent += 1;
      } else {
        const status = await deps.supa.service<string | null>('wa_mark_failed', {
          p_id: row.id,
          p_error: r.error ?? 'unknown',
          p_retryable: r.retryable,
        });
        deps.log.log('warn', 'send_failed', { outbox_id: row.id, status, error: r.error });
        failed += 1;
      }
    }
  }
  return { sent, failed };
}
