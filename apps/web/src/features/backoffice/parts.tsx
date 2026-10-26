import { type ReactNode, useId, useState } from 'react';

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

export function Status({
  message,
  error,
}: {
  readonly message: string | null;
  readonly error: boolean;
}): ReactNode {
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`min-h-6 ${error ? 'font-semibold text-danger' : 'text-success'}`}
    >
      {message}
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
  readonly type?: 'text' | 'number' | 'date' | 'email' | 'tel' | 'textarea';
  readonly options?: readonly { value: string; label: string }[];
  readonly required?: boolean;
  readonly initial?: string;
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
  const { t } = useI18n();
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
      {fields.map((f) =>
        f.options !== undefined ? (
          <Select
            key={f.name}
            label={t(f.label)}
            options={f.options}
            value={effective(f, values)}
            onChange={(val) => {
              set(f.name, val);
            }}
          />
        ) : f.type === 'textarea' ? (
          <TextArea
            key={f.name}
            label={t(f.label)}
            value={effective(f, values)}
            onChange={(val) => {
              set(f.name, val);
            }}
          />
        ) : (
          <Field
            key={f.name}
            label={t(f.label)}
            type={f.type ?? 'text'}
            required={f.required ?? true}
            value={effective(f, values)}
            onChange={(e) => {
              set(f.name, e.target.value);
            }}
          />
        ),
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending ?? false}>
          {submitLabel}
        </Button>
      </div>
    </form>
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
