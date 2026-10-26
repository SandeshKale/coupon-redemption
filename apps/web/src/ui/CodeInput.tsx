import { CODE_LENGTH, displayCode, isAlphabetChar, mapLookAlike, normaliseCode } from '@24m/shared';
import { type ReactNode, useId, useState } from 'react';

import { useI18n } from '../lib/i18n/index.ts';

import { Button } from './Button.tsx';

/** Typed entry with grouping and live check-character validation (EC-001..EC-006). */
export function CodeInput({ onValid }: { readonly onValid: (code13: string) => void }): ReactNode {
  const { t } = useI18n();
  const [raw, setRaw] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const id = useId();
  const cleaned = Array.from(raw.toUpperCase().replace(/[\s-]/g, ''), mapLookAlike).join('');
  const badChars = !Array.from(cleaned).every(isAlphabetChar);
  const result = normaliseCode(cleaned);
  let message: string | null = null;
  if (badChars) message = t('type.badChars');
  else if ((cleaned.length > 0 || submitted) && cleaned.length < CODE_LENGTH)
    message = t('type.more', { n: CODE_LENGTH - cleaned.length });
  else if (cleaned.length >= CODE_LENGTH && !result.ok) message = t('type.checkLast');
  const invalid = badChars || (cleaned.length >= CODE_LENGTH && !result.ok);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (result.ok) onValid(result.code);
      }}
    >
      <label htmlFor={id} className="font-semibold">
        {t('type.label')}
      </label>
      <input
        id={id}
        value={displayCode(cleaned)}
        onChange={(e) => {
          setRaw(e.target.value.slice(0, 20));
        }}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        aria-invalid={invalid}
        aria-describedby={`${id}-msg ${id}-hint`}
        className="min-h-14 rounded-btn border-2 border-border px-3 font-mono text-2xl tracking-widest uppercase"
      />
      <p id={`${id}-hint`} className="text-sm text-muted">
        {t('type.hint')}
      </p>
      <p
        id={`${id}-msg`}
        role="status"
        className={`min-h-6 ${invalid ? 'font-semibold text-danger' : 'text-muted'}`}
      >
        {message}
      </p>
      <Button type="submit" size="lg">
        {t('type.submit')}
      </Button>
    </form>
  );
}
