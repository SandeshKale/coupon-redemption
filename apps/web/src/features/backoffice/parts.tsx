import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import type { Row } from '../../lib/api/schemas.ts';
import { type Key, useI18n } from '../../lib/i18n/index.ts';
import {
  Button,
  type Column,
  DataTable,
  ErrorState,
  Field,
  Select,
  Skeleton,
} from '../../ui/index.ts';

import { failureText, type QueryError, str } from './data.ts';

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

const HINT: Record<string, Key> = {
  LOT_NOT_EXPORTED: 'err.lotNotExported',
  BAD_MFG_DATE: 'err.badMfgDate',
  BAD_RANGE: 'err.badRange',
  UNKNOWN_SKU: 'err.unknownSku',
};

/**
 * The outcome of the last action. It scrolls into view when it changes, so the answer is seen even
 * when the button that caused it is far down the page, and known refusals get a plain explanation.
 */
export function Status({
  message,
  error,
}: {
  readonly message: string | null;
  readonly error: boolean;
}): ReactNode {
  const { t } = useI18n();
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (message !== null && el !== null && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [message]);
  const hint = error && message !== null ? HINT[message] : undefined;
  return (
    <p
      ref={ref}
      role={error ? 'alert' : 'status'}
      className={`min-h-6 ${error ? 'font-semibold text-danger' : 'text-success'}`}
    >
      {message}
      {hint === undefined ? null : <span className="block font-normal text-ink">{t(hint)}</span>}
    </p>
  );
}

/** Loading / error / table for a query of rows. */
export function RowsView({
  query,
  columns,
  caption,
  csvName,
  onRowKey,
}: {
  readonly query: {
    data: Row[] | undefined;
    error: QueryError | null;
    isLoading: boolean;
    refetch: () => unknown;
  };
  readonly columns: readonly Column<Row>[];
  readonly caption: string;
  readonly csvName?: string;
  readonly onRowKey?: (key: string, row: Row) => void;
}): ReactNode {
  const { t } = useI18n();
  if (query.isLoading) return <Skeleton />;
  if (query.error !== null) {
    return (
      <ErrorState
        message={failureText(query.error.failure, t)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  return (
    <DataTable
      columns={columns}
      rows={query.data ?? []}
      caption={caption}
      rowKey={(r) =>
        ['id', 'batch_id', 'claim_id', 'coupon_id', 'dealer_id', 'code']
          .map((k) => str(r, k))
          .find((k) => k !== '') ?? JSON.stringify(r)
      }
      {...(csvName === undefined ? {} : { csvName })}
      {...(onRowKey === undefined ? {} : { onRowKey })}
    />
  );
}

export function cols(t: (k: Key) => string, keys: readonly string[]): Column<Row>[] {
  return keys.map((k) => ({ key: k, label: t(`col.${k}` as Key) }));
}

export interface FieldSpec {
  readonly name: string;
  readonly label: Key;
  readonly type?: 'text' | 'number' | 'date' | 'email' | 'tel' | 'textarea' | 'pin';
  readonly options?: readonly { value: string; label: string }[];
  readonly required?: boolean;
  readonly initial?: string;
  readonly pattern?: string;
}

/** Small declarative form for back-office actions. Values are strings; the caller maps them. */
export function ActionForm({
  fields,
  submitLabel,
  onSubmit,
  pending,
}: {
  readonly fields: readonly FieldSpec[];
  readonly submitLabel: string;
  readonly onSubmit: (values: Record<string, string>) => unknown;
  readonly pending?: boolean;
}): ReactNode {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial ?? f.options?.[0]?.value ?? ''])),
  );
  const set = (name: string, value: string): void => {
    setValues((vs) => ({ ...vs, [name]: value }));
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(Object.fromEntries(fields.map((f) => [f.name, effective(f, values)])));
      }}
    >
      {fields.map((f) => (
        <FormField
          key={f.name}
          spec={f}
          value={effective(f, values)}
          onChange={(val) => {
            set(f.name, val);
          }}
        />
      ))}
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending ?? false}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** One input of an ActionForm: a select, a text area, a PIN box or a plain field. */
function FormField({
  spec: f,
  value,
  onChange,
}: {
  readonly spec: FieldSpec;
  readonly value: string;
  readonly onChange: (v: string) => void;
}): ReactNode {
  const { t } = useI18n();
  if (f.options !== undefined)
    return <Select label={t(f.label)} options={f.options} value={value} onChange={onChange} />;
  if (f.type === 'textarea')
    return <TextArea label={t(f.label)} value={value} onChange={onChange} />;
  if (f.type === 'pin') {
    return (
      <Field
        label={t(f.label)}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        pattern="[0-9]{4}"
        required={f.required ?? true}
        value={value}
        onChange={(e) => {
          onChange(e.target.value.replace(/\D/g, ''));
        }}
      />
    );
  }
  return (
    <Field
      label={t(f.label)}
      type={f.type ?? 'text'}
      required={f.required ?? true}
      {...(f.pattern === undefined ? {} : { pattern: f.pattern })}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
}): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        rows={5}
        className="rounded-btn border-2 border-border p-3 font-mono"
      />
    </div>
  );
}

/** Options often load after the form renders: an untouched select means its first option. */
function effective(f: FieldSpec, values: Record<string, string>): string {
  const v = values[f.name] ?? '';
  return v === '' && f.options !== undefined ? (f.options[0]?.value ?? '') : v;
}

export const nullIfEmpty = (s: string | undefined): string | null =>
  s === undefined || s.trim() === '' ? null : s.trim();
export const intOrNull = (s: string | undefined): number | null =>
  s === undefined || s.trim() === '' ? null : Number.parseInt(s, 10);
