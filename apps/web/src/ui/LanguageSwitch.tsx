import { type ReactNode, useId } from 'react';

import { type Lang, LANGS, useI18n } from '../lib/i18n/index.ts';

export function LanguageSwitch(): ReactNode {
  const { t, lang, setLang } = useI18n();
  const id = useId();
  return (
    <span className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {t('lang.label')}
      </label>
      <select
        id={id}
        value={lang}
        onChange={(e) => {
          setLang(e.target.value as Lang);
        }}
        className="min-h-12 rounded-btn border-2 border-border bg-surface px-2"
      >
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l}>
            {t(`lang.${l}`)}
          </option>
        ))}
      </select>
    </span>
  );
}
