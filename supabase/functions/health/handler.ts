import type { Deps } from '../_shared/deps.ts';
import { json } from '../_shared/http.ts';

/** UptimeRobot target (§23 keep-alive on the Free plan, §25 uptime). Touches the database. */
export async function handler(_req: Request, deps: Deps): Promise<Response> {
  const started = deps.now().getTime();
  try {
    const res = await deps.fetch(`${deps.env.supabaseUrl}/rest/v1/app_config?select=key&limit=1`, {
      headers: { apikey: deps.env.serviceRoleKey, authorization: `Bearer ${deps.env.serviceRoleKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const ok = res.ok;
    await res.body?.cancel();
    return json(ok ? 200 : 503, { ok, db_ms: deps.now().getTime() - started });
  } catch {
    return json(503, { ok: false });
  }
}
