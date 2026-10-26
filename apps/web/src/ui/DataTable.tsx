import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useI18n } from '../lib/i18n/index.ts';

import { Button } from './Button.tsx';
import { EmptyState } from './States.tsx';

export interface Column<R> {
  readonly key: string;
  readonly label: string;
  readonly render?: (row: R) => ReactNode;
  readonly value?: (row: R) => string | number | null;
}

function cellValue<R>(col: Column<R>, row: R): string | number | null {
  if (col.value) return col.value(row);
  const v = (row as Record<string, unknown>)[col.key];
  return typeof v === 'string' || typeof v === 'number'
    ? v
    : v === null || v === undefined
      ? null
      : JSON.stringify(v);
}

export function toCsv<R>(columns: readonly Column<R>[], rows: readonly R[]): string {
  const esc = (v: string | number | null): string => {
    const s = v === null ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [
    columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(cellValue(c, r))).join(',')),
  ].join('\r\n');
}

function useSorted<R>(
  rows: readonly R[],
  columns: readonly Column<R>[],
): {
  sorted: readonly R[];
  sort: { key: string; dir: 1 | -1 } | null;
  toggle: (key: string) => void;
} {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const col = sort === null ? undefined : columns.find((c) => c.key === sort.key);
    if (sort === null || col === undefined) return rows;
    return [...rows].sort((a, b) => {
      const x = cellValue(col, a) ?? '';
      const y = cellValue(col, b) ?? '';
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);
  return {
    sorted,
    sort,
    toggle: (key) => {
      setSort((s) => ({ key, dir: s?.key === key && s.dir === 1 ? -1 : 1 }));
    },
  };
}

interface TableProps<R> {
  readonly columns: readonly Column<R>[];
  readonly rows: readonly R[];
  readonly caption: string;
  readonly rowKey: (r: R) => string | number;
  readonly csvName?: string;
  readonly onRowKey?: (key: string, row: R) => void;
}

function Head<R>({
  columns,
  sort,
  toggle,
}: {
  readonly columns: readonly Column<R>[];
  readonly sort: { key: string; dir: 1 | -1 } | null;
  readonly toggle: (k: string) => void;
}): ReactNode {
  return (
    <thead className="bg-surface-2">
      <tr>
        {columns.map((c) => (
          <th
            key={c.key}
            scope="col"
            aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            className="p-2"
          >
            <button
              type="button"
              className="min-h-12 font-semibold underline-offset-4 hover:underline"
              onClick={() => {
                toggle(c.key);
              }}
            >
              {c.label}
            </button>
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** J/K (or arrows) move between rows; any other key goes to the caller (e.g. A approve). */
function rowKeyHandler<R>(
  body: RefObject<HTMLTableSectionElement | null>,
  onRowKey?: (key: string, row: R) => void,
) {
  return (e: KeyboardEvent<HTMLTableRowElement>, index: number, row: R): void => {
    const rowsEls = body.current?.querySelectorAll<HTMLTableRowElement>('tr') ?? [];
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      rowsEls[Math.min(index + 1, rowsEls.length - 1)]?.focus();
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      rowsEls[Math.max(index - 1, 0)]?.focus();
    } else onRowKey?.(e.key, row);
  };
}

/** Sortable, keyboard-navigable table with CSV download. */
export function DataTable<R>({
  columns,
  rows,
  caption,
  rowKey,
  csvName,
  onRowKey,
}: TableProps<R>): ReactNode {
  const { t } = useI18n();
  const { sorted, sort, toggle } = useSorted(rows, columns);
  const body = useRef<HTMLTableSectionElement>(null);
  const onKey = rowKeyHandler(body, onRowKey);
  if (rows.length === 0) return <EmptyState>{t('common.empty')}</EmptyState>;
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <Head columns={columns} sort={sort} toggle={toggle} />
          <tbody ref={body}>
            {sorted.map((r, i) => (
              <tr
                key={rowKey(r)}
                tabIndex={0}
                onKeyDown={(e) => {
                  onKey(e, i, r);
                }}
                className="border-t border-surface-2 focus:bg-surface-2"
              >
                {columns.map((c) => (
                  <td key={c.key} className="p-2 align-top">
                    {c.render ? c.render(r) : cellValue(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {csvName === undefined ? null : (
        <span className="self-start">
          <Button
            variant="secondary"
            onClick={() => {
              downloadText(`${csvName}.csv`, toCsv(columns, sorted), 'text/csv');
            }}
          >
            {t('common.downloadCsv')}
          </Button>
        </span>
      )}
    </div>
  );
}

export function downloadText(filename: string, text: string, type: string): void {
  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
