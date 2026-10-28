import { normaliseCode } from '@24m/shared';
import { type ReactNode, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { CheckResponse } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, CodeInput, ResultCard, Scanner } from '../../ui/index.ts';

import { failureView, resultView } from './resultCopy.ts';

type State = 'checking' | 'valid' | 'refused' | 'validated';
interface Item {
  readonly code: string;
  readonly state: State;
  readonly title: string;
  readonly serial: string | undefined;
}

/** The list, the checks and the validation, kept apart from how the page looks. */
function useBatch(): {
  items: readonly Item[];
  note: string | null;
  busy: boolean;
  add: (code: string) => Promise<void>;
  onCode: (text: string) => void;
  validateAll: () => Promise<void>;
  remove: (code: string) => void;
} {
  const i = useI18n();
  const { api, config } = useServices();
  const [items, setItems] = useState<readonly Item[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const patch = (code: string, next: Partial<Item>): void => {
    setItems((xs) => xs.map((x) => (x.code === code ? { ...x, ...next } : x)));
  };
  const add = async (code: string): Promise<void> => {
    if (seen.current.has(code)) {
      setNote(i.t('batch.duplicate'));
      return;
    }
    seen.current.add(code);
    setNote(null);
    const first: Item = {
      code,
      state: 'checking',
      title: i.t('batch.checking'),
      serial: undefined,
    };
    setItems((xs) => [...xs, first]);
    const r = await api.rpc('check_coupon', { p_code: code }, CheckResponse);
    if (!r.ok) {
      patch(code, { state: 'refused', title: failureView(r.error, i).title });
      return;
    }
    const view = resultView(r.data.result, r.data, i);
    patch(code, {
      state: view.canValidate ? 'valid' : 'refused',
      title: view.title,
      serial: r.data.serial,
    });
  };
  const validateAll = async (): Promise<void> => {
    setBusy(true);
    for (const item of items.filter((x) => x.state === 'valid')) {
      const r = await api.rpc('validate_coupon', { p_code: item.code }, CheckResponse);
      if (!r.ok) patch(item.code, { state: 'refused', title: failureView(r.error, i).title });
      else if (r.data.result === 'VALIDATED')
        patch(item.code, { state: 'validated', title: i.t('result.validated') });
      else
        patch(item.code, { state: 'refused', title: resultView(r.data.result, r.data, i).title });
    }
    setBusy(false);
  };
  const remove = (code: string): void => {
    seen.current.delete(code);
    setItems((xs) => xs.filter((x) => x.code !== code));
  };
  const onCode = (text: string): void => {
    const r = normaliseCode(text, config.couponHost);
    if (r.ok) void add(r.code);
    else setNote(r.reason === 'NOT_24M' ? i.t('result.not_24m') : i.t('result.invalid_format'));
  };
  return { items, note, busy, add, onCode, validateAll, remove };
}

/** Scan several coupons one after another, then validate all the valid ones together. */
export function BatchPage(): ReactNode {
  const i = useI18n();
  const navigate = useNavigate();
  const { items, note, busy, add, onCode, validateAll, remove } = useBatch();
  const ready = items.filter((x) => x.state === 'valid').length;
  const done = items.filter((x) => x.state === 'validated').length;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('batch.title')}</h1>
      <p className="text-muted">{i.t('batch.help')}</p>
      <Scanner onCode={onCode} onClose={() => void navigate('/')} />
      {note === null ? null : <ResultCard variant="warning" title={note} />}
      <ItemList items={items} onRemove={remove} />
      {done > 0 ? (
        <p role="status" className="font-semibold">
          {i.t('batch.summary', { done, total: items.length })}
        </p>
      ) : null}
      <Button
        size="lg"
        loading={busy}
        disabledReason={ready === 0 ? i.t('batch.none') : null}
        onClick={() => void validateAll()}
      >
        {i.t('batch.validateAll', { n: ready })}
      </Button>
      <CodeInput onValid={(code) => void add(code)} />
    </div>
  );
}

const TONE: Record<State, string> = {
  checking: 'border-border',
  valid: 'border-success',
  refused: 'border-danger',
  validated: 'border-success bg-success-bg',
};

function ItemList({
  items,
  onRemove,
}: {
  readonly items: readonly Item[];
  readonly onRemove: (code: string) => void;
}): ReactNode {
  const i = useI18n();
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label={i.t('batch.count', { n: items.length })}>
      {items.map((x) => (
        <li
          key={x.code}
          className={`flex items-start justify-between gap-3 rounded-card border-2 p-3 ${TONE[x.state]}`}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block font-mono font-semibold">{x.serial ?? x.code}</span>
            <span className="block">{x.title}</span>
          </span>
          {x.state === 'validated' ? null : (
            <button
              type="button"
              className="min-h-12 shrink-0 font-semibold underline underline-offset-4"
              onClick={() => {
                onRemove(x.code);
              }}
            >
              {i.t('batch.remove')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
