import { formatInr } from '@24m/shared';
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { en, type Key } from './en.ts';

export type Lang = 'en' | 'hi' | 'kn';
export const LANGS: readonly Lang[] = ['en', 'hi', 'kn'];
const LANG_KEY = '24m.lang';
type Dict = Record<Key, string>;

/** Language packs other than English are separate chunks loaded on demand (§3.1 i18n). */
export function loadDict(lang: Lang): Promise<Dict> {
  if (lang === 'hi') return import('./hi.ts').then((m) => m.hi);
  if (lang === 'kn') return import('./kn.ts').then((m) => m.kn);
  return Promise.resolve(en);
}

export function interpolate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const value = vars[name];
    return value === undefined ? m : String(value);
  });
}

export function initialLang(
  storage: Pick<Storage, 'getItem'> = localStorage,
  nav: Navigator = navigator,
): Lang {
  let saved: string | null = null;
  try {
    saved = storage.getItem(LANG_KEY);
  } catch {
    saved = null;
  }
  if (saved === 'en' || saved === 'hi' || saved === 'kn') return saved;
  const pref = nav.language.toLowerCase();
  return pref.startsWith('kn') ? 'kn' : pref.startsWith('hi') ? 'hi' : 'en';
}

const IST = 'Asia/Kolkata';

/** `12 Nov 2026, 10:32` in IST; digits stay ASCII for consistency with codes (§16.6). */
export function formatDateTime(iso: string, lang: Lang = 'en'): string {
  return new Intl.DateTimeFormat(`${lang}-IN-u-nu-latn`, {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function formatDate(iso: string, lang: Lang = 'en'): string {
  return new Intl.DateTimeFormat(`${lang}-IN-u-nu-latn`, {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Relative time for < 24 h ("2 min ago"), absolute otherwise. */
export function formatRelative(iso: string, now: number, lang: Lang = 'en'): string {
  const diffS = Math.round((new Date(iso).getTime() - now) / 1000);
  if (Math.abs(diffS) >= 86_400) return formatDateTime(iso, lang);
  const rtf = new Intl.RelativeTimeFormat(`${lang}-IN-u-nu-latn`, { numeric: 'auto' });
  if (Math.abs(diffS) < 60) return rtf.format(diffS, 'second');
  if (Math.abs(diffS) < 3600) return rtf.format(Math.round(diffS / 60), 'minute');
  return rtf.format(Math.round(diffS / 3600), 'hour');
}

export interface I18n {
  readonly lang: Lang;
  readonly t: (key: Key, vars?: Record<string, string | number>) => string;
  readonly setLang: (lang: Lang) => void;
  readonly money: (paise: number) => string;
  readonly dateTime: (iso: string) => string;
  readonly date: (iso: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  children,
  lang: forced,
}: {
  readonly children: ReactNode;
  readonly lang?: Lang;
}): ReactNode {
  const [lang, setLangState] = useState<Lang>(forced ?? initialLang());
  const [dict, setDict] = useState<Dict>(en);
  useEffect(() => {
    let live = true;
    void loadDict(lang).then((d) => {
      if (live) setDict(d);
    });
    document.documentElement.lang = lang;
    return () => {
      live = false;
    };
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // storage unavailable (private mode): language still switches for this session
    }
    setLangState(l);
  }, []);
  const value = useMemo<I18n>(
    () => ({
      lang,
      t: (key, vars) => interpolate(dict[key], vars),
      setLang,
      money: formatInr,
      dateTime: (iso) => formatDateTime(iso, lang),
      date: (iso) => formatDate(iso, lang),
    }),
    [dict, lang, setLang],
  );
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (ctx === null) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export type { Key };
