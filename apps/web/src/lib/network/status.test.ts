import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { quality, useNetwork, waitOnline } from './status.ts';

const nav = (onLine: boolean, connection?: object) =>
  ({ onLine, connection }) as unknown as Navigator;

describe('network', () => {
  it('quality', () => {
    expect(quality(nav(false))).toBe('offline');
    expect(quality(nav(true))).toBe('ok');
    expect(quality(nav(true, { effectiveType: '4g', rtt: 100 }))).toBe('ok');
    for (const t of ['2g', 'slow-2g', '3g'])
      expect(quality(nav(true, { effectiveType: t }))).toBe('slow');
    expect(quality(nav(true, { effectiveType: '4g', rtt: 700 }))).toBe('slow');
    expect(quality(nav(true, { effectiveType: '4g' }))).toBe('ok');
  });

  it('useNetwork follows online/offline events', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result, unmount } = renderHook(() => useNetwork());
    expect(result.current).toBe('ok');
    spy.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe('offline');
    unmount();
  });

  it('waitOnline resolves immediately when online, or on the online event', async () => {
    await expect(
      waitOnline({ navigator: { onLine: true } } as unknown as Window),
    ).resolves.toBeUndefined();
    const listeners: (() => void)[] = [];
    const p = waitOnline({
      navigator: { onLine: false },
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    } as unknown as Window);
    listeners[0]?.();
    await expect(p).resolves.toBeUndefined();
  });
});
