import { describe, expect, it, vi } from 'vitest';

import type { Api, ApiResult } from './client.ts';
import { hasPending, PENDING_KEY, type RedeemDeps, redeemCodes, resolvePending } from './redeem.ts';

const OK = {
  result: 'REDEEMED' as const,
  batch_id: 7,
  count: 1,
  value_paise: 10000,
  painter_token: 'K7Q2M9',
  lines: [],
  at: '2026-10-26T10:00:00Z',
};

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, val) => void m.set(k, val),
    removeItem: (k) => void m.delete(k),
    clear: () => {
      m.clear();
    },
    key: () => null,
    length: 0,
  };
}

function deps(
  script: Record<string, ApiResult<unknown>[]>,
  extra: Partial<RedeemDeps> = {},
): RedeemDeps & { calls: string[]; sleeps: number[] } {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const api: Api = {
    rpc: <T>(fn: string, args: Record<string, unknown>) => {
      calls.push(`${fn}:${String(args['p_idem'])}`);
      const next = script[fn]?.shift() ?? { ok: false, error: { kind: 'network' } };
      return Promise.resolve(next as ApiResult<T>);
    },
    select: () => Promise.reject(new Error('unused')),
  };
  return {
    api,
    storage: memoryStorage(),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
    uuid: () => 'key-1',
    refreshSession: () => Promise.resolve(true),
    waitOnline: () => Promise.resolve(),
    calls,
    sleeps,
    ...extra,
  };
}

describe('redeemCodes (§18.4)', () => {
  it('done on first try; key persisted during the request and cleared after', async () => {
    const d = deps({ redeem: [{ ok: true, data: OK }] });
    const spy = vi.spyOn(d.storage, 'setItem');
    expect(await redeemCodes(['C'], d)).toEqual({ kind: 'done', response: OK });
    expect(spy).toHaveBeenCalledWith(PENDING_KEY, expect.stringContaining('key-1'));
    expect(hasPending(d.storage)).toBe(false);
  });

  it('EC-045 expired token: refresh once and retry with the same key (not an attempt)', async () => {
    const d = deps({
      redeem: [
        { ok: false, error: { kind: 'auth' } },
        { ok: true, data: OK },
      ],
    });
    const phases: string[] = [];
    expect((await redeemCodes(['C'], d, (p) => phases.push(p))).kind).toBe('done');
    expect(d.calls).toEqual(['redeem:key-1', 'redeem:key-1']);
    expect(phases).toEqual(['saving']);
  });

  it('auth failure after refresh fails is reported', async () => {
    const d = deps(
      { redeem: [{ ok: false, error: { kind: 'auth' } }] },
      { refreshSession: () => Promise.resolve(false) },
    );
    expect(await redeemCodes(['C'], d)).toEqual({ kind: 'failed', error: { kind: 'auth' } });
  });

  it('a definite 4xx is shown and the key cleared', async () => {
    const d = deps({ redeem: [{ ok: false, error: { kind: 'forbidden', code: 'FORBIDDEN' } }] });
    expect((await redeemCodes(['C'], d)).kind).toBe('failed');
    expect(hasPending(d.storage)).toBe(false);
  });

  it('EC-041/042 unknown outcomes retry with backoff, then resolve the stored result', async () => {
    const unknown = { ok: false as const, error: { kind: 'timeout' as const } };
    const d = deps({
      redeem: [unknown, unknown, unknown, unknown],
      redemption_outcome: [{ ok: true, data: { found: true, response: OK } }],
    });
    const phases: string[] = [];
    expect(await redeemCodes(['C'], d, (p) => phases.push(p))).toEqual({
      kind: 'done',
      response: OK,
    });
    expect(d.sleeps).toEqual([1000, 2000, 4000]);
    expect(phases).toContain('checking');
    expect(d.calls.at(-1)).toBe('redemption_outcome:key-1');
  });

  it('EC-043 the server never saw it → not redeemed (safe to retry)', async () => {
    const d = deps({ redeem: [], redemption_outcome: [{ ok: true, data: { found: false } }] });
    expect(await redeemCodes(['C'], d)).toEqual({ kind: 'not_redeemed' });
  });

  it('a retry that succeeds returns the server response (same key: never double)', async () => {
    const d = deps({
      redeem: [
        { ok: false, error: { kind: 'server', status: 502 } },
        { ok: true, data: OK },
      ],
    });
    expect((await redeemCodes(['C'], d)).kind).toBe('done');
    expect(new Set(d.calls)).toEqual(new Set(['redeem:key-1']));
  });
});

describe('resolvePending (EC-044)', () => {
  it('nothing pending', async () => {
    expect(await resolvePending(deps({}))).toEqual({ kind: 'not_redeemed' });
  });

  it('corrupt storage is cleared', async () => {
    const d = deps({});
    d.storage.setItem(PENDING_KEY, '{');
    expect(await resolvePending(d)).toEqual({ kind: 'not_redeemed' });
    expect(hasPending(d.storage)).toBe(false);
  });

  it('keeps trying while the outcome is unknown, refreshes auth, gives up on definite failures', async () => {
    const d = deps({
      redemption_outcome: [
        { ok: false, error: { kind: 'network' } },
        { ok: false, error: { kind: 'auth' } },
        { ok: true, data: { found: true, response: OK } },
      ],
    });
    d.storage.setItem(PENDING_KEY, JSON.stringify({ key: 'k9', codes: ['C'], at: 1 }));
    expect((await resolvePending(d)).kind).toBe('done');
    expect(d.calls).toEqual([
      'redemption_outcome:k9',
      'redemption_outcome:k9',
      'redemption_outcome:k9',
    ]);

    const f = deps({
      redemption_outcome: [{ ok: false, error: { kind: 'business', code: 'x', status: 400 } }],
    });
    f.storage.setItem(PENDING_KEY, JSON.stringify({ key: 'k', codes: [], at: 1 }));
    expect((await resolvePending(f)).kind).toBe('failed');

    const a = deps(
      { redemption_outcome: [{ ok: false, error: { kind: 'auth' } }] },
      { refreshSession: () => Promise.resolve(false) },
    );
    a.storage.setItem(PENDING_KEY, JSON.stringify({ key: 'k', codes: [], at: 1 }));
    expect((await resolvePending(a)).kind).toBe('failed');
  });
});
