import type { Deps } from '../_shared/deps.ts';
import { json, timingSafeEqual } from '../_shared/http.ts';
import { drainOutbox } from './sender.ts';

/** Called every minute by pg_cron (pg_net) with the internal secret, and in-process by wa-webhook. */
export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const secret = req.headers.get('x-internal-secret') ?? '';
  if (deps.env.waSenderSecret === '' || !timingSafeEqual(secret, deps.env.waSenderSecret)) {
    deps.log.log('warn', 'unauthorised');
    return json(401, { error: 'unauthorised' });
  }
  const result = await drainOutbox(deps);
  deps.log.log('info', 'drained', result);
  return json(200, result);
}
