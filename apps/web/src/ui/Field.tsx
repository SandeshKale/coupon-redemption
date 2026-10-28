import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';

import { useI18n } from '../lib/i18n/index.ts';

/** Labelled input (1.3.1, 3.3.2) with an optional error/help message. */
export function Field({
  label,
  error,
  hint,
  revealable = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string;
  readonly error?: string | null;
  readonly hint?: string;
  /** A masked field (a PIN or password) gets a Show / Hide switch so a typing slip can be seen. */
  readonly revealable?: boolean;
}): ReactNode {
  const id = useId();
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const hasError = error !== undefined && error !== null;
  const input = (
    <input
      id={id}
      aria-invalid={hasError}
      aria-describedby={`${id}-msg`}
      className={`min-h-12 w-full rounded-btn border-2 px-3 ${hasError ? 'border-danger' : 'border-border'} ${revealable ? 'pr-20' : ''}`}
      {...rest}
      type={revealable && shown ? 'text' : rest.type}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {revealable ? (
        <div className="relative">
          {input}
          <button
            type="button"
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 min-w-16 rounded-r-btn px-3 text-sm font-semibold underline underline-offset-4"
            onClick={() => {
              setShown((s) => !s);
            }}
          >
            {shown ? t('common.hide') : t('common.show')}
          </button>
        </div>
      ) : (
        input
      )}
      <span
        id={`${id}-msg`}
        className={hasError ? 'font-semibold text-danger' : 'text-sm text-muted'}
      >
        {error ?? hint}
      </span>
    </div>
  );
}

export function Select({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { value: string; label: string }[];
  readonly value: string;
  readonly onChange: (v: string) => void;
}): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="min-h-12 rounded-btn border-2 border-border bg-surface px-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
