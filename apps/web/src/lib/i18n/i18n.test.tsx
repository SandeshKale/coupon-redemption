import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { en } from './en.ts';
import { hi } from './hi.ts';
import {
  formatDate,
  formatDateTime,
  formatRelative,
  I18nProvider,
  initialLang,
  interpolate,
  loadDict,
  useI18n,
} from './index.ts';
import { kn } from './kn.ts';

const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('dictionaries (§16.6)', () => {
  it('Hindi and Kannada have every key with the same placeholders', () => {
    for (const [name, dict] of [
      ['hi', hi],
      ['kn', kn],
    ] as const) {
      expect(Object.keys(dict).sort(), name).toEqual(Object.keys(en).sort());
      for (const [k, val] of Object.entries(en)) {
        expect(placeholders(dict[k as keyof typeof en]), `${name}:${k}`).toEqual(placeholders(val));
        expect(dict[k as keyof typeof en].trim(), `${name}:${k} empty`).not.toBe('');
      }
    }
  });

  it('every do-not-pay message says so in all three languages', () => {
    for (const k of [
      'result.already_other',
      'result.not_found',
      'result.not_active',
      'result.blocked',
    ] as const) {
      expect(en[k]).toMatch(/Do NOT pay/);
      expect(hi[k]).toMatch(/भुगतान न करें/);
      expect(kn[k]).toMatch(/ಹಣ ಕೊಡಬೇಡಿ/);
    }
  });
});

describe('i18n helpers', () => {
  it('interpolate', () => {
    expect(interpolate('Pay {amount} for {count}', { amount: '₹100', count: 2 })).toBe(
      'Pay ₹100 for 2',
    );
    expect(interpolate('Keep {missing}')).toBe('Keep {missing}');
  });

  it('initialLang: saved choice, browser language, storage failures', () => {
    const mk = (saved: string | null) => ({ getItem: () => saved });
    expect(initialLang(mk('kn'), { language: 'en-US' } as Navigator)).toBe('kn');
    expect(initialLang(mk(null), { language: 'hi-IN' } as Navigator)).toBe('hi');
    expect(initialLang(mk('xx'), { language: 'kn-IN' } as Navigator)).toBe('kn');
    expect(initialLang(mk(null), { language: 'en-GB' } as Navigator)).toBe('en');
    expect(
      initialLang(
        {
          getItem: () => {
            throw new Error('denied');
          },
        },
        { language: 'en' } as Navigator,
      ),
    ).toBe('en');
  });

  it('formats dates in IST with ASCII digits', () => {
    expect(formatDateTime('2026-11-12T05:02:00Z')).toBe('12 Nov 2026, 10:32');
    expect(formatDate('2026-11-12T20:00:00Z')).toBe('13 Nov 2026');
    expect(formatDateTime('2026-11-12T05:02:00Z', 'hi')).toMatch(/12/);
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(formatRelative('2026-11-12T09:58:00Z', now)).toBe('2 minutes ago');
    expect(formatRelative('2026-11-12T09:59:30Z', now)).toBe('30 seconds ago');
    expect(formatRelative('2026-11-12T07:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-11-10T07:00:00Z', now)).toMatch(/2026/);
  });

  it('loads language packs', async () => {
    expect((await loadDict('hi'))['home.scan']).toBe(hi['home.scan']);
    expect((await loadDict('kn'))['home.scan']).toBe(kn['home.scan']);
    expect(await loadDict('en')).toBe(en);
  });
});

describe('I18nProvider', () => {
  function Probe(): ReactNode {
    const i = useI18n();
    return (
      <div>
        <p>{i.t('home.scan')}</p>
        <p>{i.money(10_000_000)}</p>
        <p>{i.dateTime('2026-11-12T05:02:00Z')}</p>
        <p>{i.date('2026-11-12T05:02:00Z')}</p>
        <button
          type="button"
          onClick={() => {
            i.setLang('kn');
          }}
        >
          {'switch'}
        </button>
      </div>
    );
  }

  it('switches language, persists the choice and sets <html lang>', async () => {
    render(
      <I18nProvider lang="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('Scan coupon')).toBeInTheDocument();
    expect(screen.getByText('₹1,00,000')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button').click();
    });
    await waitFor(() => {
      expect(screen.getByText(kn['home.scan'])).toBeInTheDocument();
    });
    expect(localStorage.getItem('24m.lang')).toBe('kn');
    expect(document.documentElement.lang).toBe('kn');
  });

  it('survives storage that throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      render(
        <I18nProvider lang="en">
          <Probe />
        </I18nProvider>,
      );
      act(() => {
        screen.getByRole('button').click();
      });
      await waitFor(() => {
        expect(screen.getByText(kn['home.scan'])).toBeInTheDocument();
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('useI18n outside the provider throws', () => {
    expect(() => renderHook(() => useI18n())).toThrow('useI18n outside I18nProvider');
  });
});
