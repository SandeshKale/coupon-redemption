import { describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/auth-js', () => ({
  GoTrueClient: vi.fn().mockImplementation(function (this: { opts: unknown }, opts: unknown) {
    this.opts = opts;
  }),
}));

import { loadAuthClient, prefetchAuthWhenIdle } from './client.ts';

describe('auth client', () => {
  it('creates a single client with our storage key', async () => {
    const a = await loadAuthClient();
    const b = await loadAuthClient();
    expect(a).toBe(b);
    expect(
      (a as unknown as { opts: { storageKey: string; persistSession: boolean } }).opts,
    ).toMatchObject({ storageKey: 'sb-24m-auth', persistSession: true });
  });

  it('prefetches when idle, with a timeout fallback, and never on Data Saver', () => {
    const ric = vi.fn();
    prefetchAuthWhenIdle({ navigator: {}, requestIdleCallback: ric } as unknown as Window);
    expect(ric).toHaveBeenCalledTimes(1);
    const setTimeout = vi.fn();
    prefetchAuthWhenIdle({ navigator: {}, setTimeout } as unknown as Window);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);
    (setTimeout.mock.calls[0]?.[0] as () => void)();
    const saver = vi.fn();
    prefetchAuthWhenIdle({
      navigator: { connection: { saveData: true } },
      requestIdleCallback: saver,
    } as unknown as Window);
    expect(saver).not.toHaveBeenCalled();
  });
});
