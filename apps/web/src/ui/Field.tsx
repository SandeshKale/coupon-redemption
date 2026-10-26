import { type InputHTMLAttributes, type ReactNode, useId } from 'react';

/** Labelled input (1.3.1, 3.3.2) with an optional error/help message. */
export function Field({
  label,
  error,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string;
  readonly error?: string | null;
  readonly hint?: string;
}): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== undefined && error !== null}
        aria-describedby={`${id}-msg`}
        className="min-h-12 rounded-btn border-2 border-border px-3"
        {...rest}
      />
      <span
        id={`${id}-msg`}
        className={
          error !== undefined && error !== null ? 'font-semibold text-danger' : 'text-sm text-muted'
        }
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
