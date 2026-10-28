import { normaliseE164 } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import * as v from 'valibot';

import { JsonArray, type Row } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, Field, useReveal } from '../../ui/index.ts';

import { explain, num, str, useAdminCall, useRpcData } from './data.ts';
import { ActionForm, cols, RowsView, Section, Status } from './parts.tsx';

/** HTML pattern for the optional GST number (15 characters). */
export const GST_PATTERN = '[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]';

/** Body for admin-create-user when adding a dealer under a distributor. */
export function newDealerBody(
  vals: Record<string, string>,
  distributorId: number,
): Record<string, unknown> {
  const gst = (vals['gst'] ?? '').trim();
  return {
    name: vals['name'],
    mobile: normaliseE164(vals['mobile'] ?? '') ?? vals['mobile'],
    role: 'DEALER_OWNER',
    parent_distributor_id: distributorId,
    pin: vals['pin'],
    ...(gst === '' ? {} : { gst }),
  };
}

/**
 * Distributors and their sales reps keep the list of dealers who may validate coupons. Each dealer
 * has a registered WhatsApp mobile number (the login) and a 4-digit PIN chosen here.
 */
export function DealersPage({
  distributorId,
}: {
  readonly distributorId: number | null;
}): ReactNode {
  const i = useI18n();
  const dealers = useRpcData('list_dealers', { p_distributor_id: null }, JsonArray);
  const admin = useAdminCall(() => void dealers.refetch());
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.dealers')}</h1>
      <Section title={i.t('nav.dealers')}>
        <RowsView
          query={dealers}
          caption={i.t('nav.dealers')}
          csvName="dealers"
          columns={[
            ...cols(i.t, ['name', 'gst', 'mobile_e164', 'validated']),
            {
              key: 'actions',
              label: i.t('col.actions'),
              render: (r) => <DealerActions row={r} call={admin.call} />,
            },
          ]}
        />
        <Status message={admin.message} error={admin.error} />
      </Section>
      {distributorId === null ? null : (
        <Section title={i.t('dist.addDealer')}>
          <AddDealer distributorId={distributorId} call={admin.call} />
        </Section>
      )}
    </div>
  );
}

/** Switch a dealer's login on or off, or set a new PIN. */
export function DealerActions({
  row,
  call,
}: {
  readonly row: Row;
  readonly call: (fn: string, body: unknown, success?: string) => Promise<Row | null>;
}): ReactNode {
  const i = useI18n();
  const userId = num(row, 'user_id');
  if (userId === 0) return null;
  const active = str(row, 'user_status') === 'ACTIVE';
  return (
    <span className="flex flex-wrap items-end gap-2">
      <PinReset userId={userId} />
      <Button
        variant={active ? 'danger' : 'secondary'}
        onClick={() =>
          call(
            'admin-user-status',
            {
              user_id: userId,
              status: active ? 'INACTIVE' : 'ACTIVE',
              reason: 'Changed from the dealers list',
            },
            active ? i.t('dist.switchedOff') : i.t('dist.switchedOn'),
          )
        }
      >
        {active ? i.t('dist.switchOff') : i.t('dist.switchOn')}
      </Button>
    </span>
  );
}

/** Set a new PIN for someone this user manages (their dealer, or anyone for 24M). */
export function PinReset({ userId }: { readonly userId: number }): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const reveal = useReveal<HTMLSpanElement>(msg?.text ?? null);
  const save = async (): Promise<void> => {
    const r = await api.rpc('set_user_pin', { p_user_id: userId, p_pin: pin }, v.unknown());
    if (r.ok) {
      setMsg({ text: i.t('dist.pinSet'), error: false });
      setPin('');
      setOpen(false);
    } else {
      setMsg({
        text:
          r.error.kind === 'business'
            ? (explain(r.error.code, i.t) ?? i.t('common.error'))
            : i.t('common.error'),
        error: true,
      });
    }
  };
  return (
    <span className="flex flex-col gap-1">
      {open ? (
        <span className="flex items-end gap-2">
          <Field
            label={i.t('col.pin')}
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
            }}
          />
          <Button
            disabledReason={/^[0-9]{4}$/.test(pin) ? null : i.t('pin.rules')}
            onClick={() => save()}
          >
            {i.t('common.save')}
          </Button>
        </span>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {i.t('dist.setPin')}
        </Button>
      )}
      {msg === null ? null : (
        <span
          ref={reveal}
          role={msg.error ? 'alert' : 'status'}
          className={msg.error ? 'text-danger' : 'text-success'}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
}

function AddDealer({
  distributorId,
  call,
}: {
  readonly distributorId: number;
  readonly call: (fn: string, body: unknown, success?: string) => Promise<Row | null>;
}): ReactNode {
  const i = useI18n();
  return (
    <ActionForm
      submitLabel={i.t('dist.addDealer')}
      fields={[
        { name: 'name', label: 'dist.dealerName' },
        { name: 'gst', label: 'dist.gst', required: false, pattern: GST_PATTERN },
        { name: 'mobile', label: 'dist.whatsapp', type: 'tel' },
        { name: 'pin', label: 'col.pin', type: 'pin' },
      ]}
      onSubmit={(vals) =>
        call('admin-create-user', newDealerBody(vals, distributorId), i.t('dist.created'))
      }
    />
  );
}
