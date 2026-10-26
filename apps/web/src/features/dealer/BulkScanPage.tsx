import { type CouponResult, normaliseCode, sumPaise } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';

import { CheckResponse } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useNetwork } from '../../lib/network/status.ts';
import { useServices } from '../../lib/services.ts';
import { Banner, Button, ResultCard, Scanner } from '../../ui/index.ts';

import { resultView } from './resultCopy.ts';
import { useRedeem } from './useRedeem.ts';

export const BULK_MAX = 50;

interface Item {
  readonly code: string;
  readonly result: CouponResult | 'CHECKING' | 'ERROR';
  readonly value: number;
  readonly serial?: string | undefined;
}

/** The scanned list: local validation, de-duplication, 50 cap, per-line server check. */
function useBulkList(): {
  items: Item[];
  note: string | null;
  add: (text: string) => void;
  remove: (code: string) => void;
} {
  const i = useI18n();
  const { api, config } = useServices();
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const add = (text: string): void => {
    const r = normaliseCode(text, config.couponHost);
    const problem = !r.ok
      ? i.t(r.reason === 'NOT_24M' ? 'result.not_24m' : 'result.invalid_format')
      : items.some((it) => it.code === r.code)
        ? i.t('bulk.already') // EC-024
        : items.length >= BULK_MAX
          ? i.t('bulk.limit') // EC-025
          : null;
    setNote(problem);
    if (problem !== null || !r.ok) return;
    setItems((xs) => [...xs, { code: r.code, result: 'CHECKING', value: 0 }]);
    void api.rpc('check_coupon', { p_code: r.code }, CheckResponse).then((res) => {
      const next: Item = res.ok
        ? {
            code: r.code,
            result: res.data.result,
            value: res.data.value_paise ?? 0,
            serial: res.data.serial,
          }
        : { code: r.code, result: 'ERROR', value: 0 };
      setItems((xs) => xs.map((it) => (it.code === r.code ? next : it)));
    });
  };
  return {
    items,
    note,
    add,
    remove: (code) => {
      setItems((xs) => xs.filter((x) => x.code !== code));
    },
  };
}

/** Scan many (§5.2): camera stays open, each code checked as scanned, one Confirm for all. */
export function BulkScanPage(): ReactNode {
  const i = useI18n();
  const net = useNetwork();
  const navigate = useNavigate();
  const { state, redeem, busy } = useRedeem();
  const { items, note, add, remove } = useBulkList();
  const valid = items.filter((it) => it.result === 'VALID');
  const confirm = async (): Promise<void> => {
    const next = await redeem(valid.map((it) => it.code));
    if (next.phase === 'done' && next.response.batch_id !== undefined) {
      void navigate(`/receipt/${String(next.response.batch_id)}`, {
        state: next.response,
        replace: true,
      });
    }
  };
  const reason =
    valid.length === 0 ? i.t('bulk.empty') : net === 'offline' ? i.t('state.offline') : null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('bulk.title')}</h1>
      {net === 'offline' ? <Banner tone="warning">{i.t('bulk.paused')}</Banner> : null}
      <Scanner onCode={add} paused={net === 'offline' || busy} onClose={() => void navigate('/')} />
      <p role="status" className="min-h-6 font-semibold text-warning-ink">
        {note}
      </p>
      {items.length === 0 ? (
        <p className="text-muted">{i.t('bulk.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {items.map((it) => (
            <BulkLine
              key={it.code}
              item={it}
              onRemove={() => {
                remove(it.code);
              }}
            />
          ))}
        </ul>
      )}
      {state.phase === 'failed' || state.phase === 'not_redeemed' ? (
        <ResultCard variant="warning" title={i.t('state.notRedeemed')} />
      ) : null}
      {busy ? (
        <ResultCard
          variant="checking"
          title={i.t(state.phase === 'checking' ? 'state.checkingResult' : 'state.saving')}
        />
      ) : null}
      <div className="sticky bottom-0 bg-surface pb-4">
        <Button size="lg" loading={busy} disabledReason={reason} onClick={() => void confirm()}>
          {i.t('bulk.confirm', {
            amount: i.money(sumPaise(valid.map((it) => it.value))),
            count: valid.length,
          })}
        </Button>
      </div>
    </div>
  );
}

function BulkLine({
  item,
  onRemove,
}: {
  readonly item: Item;
  readonly onRemove: () => void;
}): ReactNode {
  const i = useI18n();
  const label =
    item.result === 'CHECKING'
      ? i.t('state.checking')
      : item.result === 'ERROR'
        ? i.t('state.offline')
        : resultView(item.result, { value_paise: item.value }, i).title;
  const ok = item.result === 'VALID';
  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-card border-2 p-3 ${ok ? 'border-success' : item.result === 'CHECKING' ? 'border-border' : 'border-danger'}`}
    >
      <span>
        <span aria-hidden="true" className="mr-2 font-bold">
          {ok ? '✓' : item.result === 'CHECKING' ? '⟳' : '✕'}
        </span>
        <span className="font-mono">{item.serial ?? item.code}</span>
        <span className="block text-sm">{label}</span>
      </span>
      <span className="w-28 shrink-0">
        <Button
          variant="ghost"
          onClick={onRemove}
          aria-label={`${i.t('bulk.remove')} ${item.serial ?? item.code}`}
        >
          {i.t('bulk.remove')}
        </Button>
      </span>
    </li>
  );
}
