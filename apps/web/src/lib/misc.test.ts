import { describe, expect, it, vi } from 'vitest';

import { readConfig } from './config.ts';

describe('config', () => {
  it('reads and normalises public env', () => {
    expect(
      readConfig({
        VITE_SUPABASE_URL: 'https://x.supabase.co/',
        VITE_SUPABASE_ANON_KEY: 'k',
        VITE_COUPON_HOST: 'c.x.in',
        VITE_SENTRY_DSN: '',
        VITE_HELPLINE: '',
      }),
    ).toEqual({
      supabaseUrl: 'https://x.supabase.co',
      anonKey: 'k',
      couponHost: 'c.x.in',
      sentryDsn: undefined,
      helpline: null,
    });
    expect(readConfig({})).toMatchObject({
      supabaseUrl: '',
      anonKey: '',
      couponHost: 'c.example.in',
      helpline: null,
    });
    expect(
      readConfig({ VITE_SENTRY_DSN: 'https://d@sentry', VITE_HELPLINE: '+91 1' }),
    ).toMatchObject({ sentryDsn: 'https://d@sentry', helpline: '+91 1' });
  });
});

describe('telemetry', () => {
  it('is a no-op without a DSN', async () => {
    vi.resetModules();
    const t = await import('./telemetry.ts');
    expect(() => {
      t.reportError(new Error('x'));
      t.reportTiming('scan', 5);
      t.initTelemetryWhenIdle();
    }).not.toThrow();
  });

  it('lazy-loads Sentry when a DSN is configured', async () => {
    vi.resetModules();
    const S = {
      init: vi.fn(),
      captureException: vi.fn(),
      setMeasurement: vi.fn(),
      browserTracingIntegration: vi.fn(() => ({})),
    };
    vi.doMock('./config.ts', () => ({ config: { sentryDsn: 'https://d@sentry.io/1' } }));
    vi.doMock('@sentry/browser', () => S);
    vi.useFakeTimers();
    try {
      const t = await import('./telemetry.ts');
      t.initTelemetryWhenIdle();
      vi.advanceTimersByTime(3000);
      t.reportError(new Error('boom'), { at: 'x' });
      t.reportTiming('scan_to_result', 120);
      await vi.waitFor(() => {
        expect(S.captureException).toHaveBeenCalled();
      });
      expect(S.init).toHaveBeenCalledWith(expect.objectContaining({ sendDefaultPii: false }));
      expect(S.setMeasurement).toHaveBeenCalledWith('scan_to_result', 120, 'millisecond');
    } finally {
      vi.useRealTimers();
      vi.doUnmock('./config.ts');
      vi.doUnmock('@sentry/browser');
    }
  });
});
