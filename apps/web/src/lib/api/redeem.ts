import type { Api, ApiFailure } from './client.ts';
import { outcomeUnknown } from './client.ts';
import { OutcomeResponse, RedeemResponse } from './schemas.ts';

/** §18.4 redeem algorithm: one idempotency key per Confirm; retries can never double-redeem. */
export type RedeemOutcome =
  | { readonly kind: 'done'; readonly response: RedeemResponse }
  | { readonly kind: 'not_redeemed' }
  | { readonly kind: 'failed'; readonly error: ApiFailure };

export type RedeemPhase = 'saving' | 'checking';

export interface RedeemDeps {
  readonly api: Api;
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
  readonly uuid: () => string;
  readonly refreshSession: () => Promise<boolean>;
  readonly waitOnline: () => Promise<void>;
}

export const PENDING_KEY = '24m.pendingRedeem';
const BACKOFF_MS = [1000, 2000, 4000];

interface Pending {
  readonly key: string;
  readonly codes: readonly string[];
  readonly at: number;
}

export async function redeemCodes(
  codes: readonly string[],
  deps: RedeemDeps,
  onPhase: (p: RedeemPhase) => void = () => undefined,
): Promise<RedeemOutcome> {
  const pending: Pending = { key: deps.uuid(), codes, at: Date.now() };
  // Persisted before the request so a closed app can resolve it on reopen (EC-044).
  deps.storage.setItem(PENDING_KEY, JSON.stringify(pending));
  onPhase('saving');
  let attempt = 0;
  let refreshed = false;
  for (;;) {
    const r = await deps.api.rpc(
      'redeem',
      { p_codes: codes, p_idem: pending.key },
      RedeemResponse,
      {
        timeoutMs: attempt === 0 ? 12_000 : 20_000,
      },
    );
    if (r.ok) {
      deps.storage.removeItem(PENDING_KEY);
      return { kind: 'done', response: r.data };
    }
    if (r.error.kind === 'auth' && !refreshed) {
      refreshed = true; // EC-045: refresh once, same key, not an attempt
      if (await deps.refreshSession()) continue;
    }
    if (!outcomeUnknown(r.error)) {
      deps.storage.removeItem(PENDING_KEY);
      return { kind: 'failed', error: r.error };
    }
    attempt += 1;
    onPhase('checking');
    if (attempt <= BACKOFF_MS.length) {
      await deps.sleep((BACKOFF_MS[attempt - 1] ?? 4000) + Math.floor(deps.random() * 250));
      continue;
    }
    return resolvePending(deps);
  }
}

/** Resolves a persisted key via redemption_outcome (on reopen, or after retries are exhausted). */
export async function resolvePending(deps: RedeemDeps): Promise<RedeemOutcome> {
  const raw = deps.storage.getItem(PENDING_KEY);
  if (raw === null) return { kind: 'not_redeemed' };
  let pending: Pending;
  try {
    pending = JSON.parse(raw) as Pending;
  } catch {
    deps.storage.removeItem(PENDING_KEY);
    return { kind: 'not_redeemed' };
  }
  for (let i = 0; ; i += 1) {
    await deps.waitOnline();
    const r = await deps.api.rpc('redemption_outcome', { p_idem: pending.key }, OutcomeResponse, {
      timeoutMs: 20_000,
    });
    if (r.ok) {
      deps.storage.removeItem(PENDING_KEY);
      // Not found ⇒ the server never saw it: safe to say "Not redeemed. Try again." (EC-043)
      return r.data.found ? { kind: 'done', response: r.data.response } : { kind: 'not_redeemed' };
    }
    if (r.error.kind === 'auth') {
      if (!(await deps.refreshSession())) return { kind: 'failed', error: r.error };
      continue;
    }
    if (!outcomeUnknown(r.error)) return { kind: 'failed', error: r.error };
    await deps.sleep(Math.min(30_000, 2000 * 2 ** Math.min(i, 4)));
  }
}

export function hasPending(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(PENDING_KEY) !== null;
}
