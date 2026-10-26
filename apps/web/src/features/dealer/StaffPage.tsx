import { normaliseE164 } from '@24m/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import * as v from 'valibot';

import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, Dialog, EmptyState, Field, StatusPill } from '../../ui/index.ts';

const Staff = v.array(
  v.object({
    id: v.number(),
    name: v.string(),
    mobile_e164: v.nullable(v.string()),
    status: v.string(),
  }),
);
type Member = v.InferOutput<typeof Staff>[number];

function useStaff(dealerId: number): { rows: Member[]; remove: (m: Member) => void } {
  const { api, callFunction } = useServices();
  const [rows, setRows] = useState<Member[]>([]);
  const load = useCallback(async () => {
    const r = await api.select(
      `app_user?select=id,name,mobile_e164,status&dealer_id=eq.${String(dealerId)}&role=eq.DEALER_STAFF&order=name`,
      Staff,
    );
    if (r.ok) setRows(r.data);
  }, [api, dealerId]);
  useEffect(() => {
    void load();
  }, [load]);
  const remove = (m: Member): void => {
    void callFunction('admin-user-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: m.id,
        status: 'INACTIVE',
        reason: 'Removed by dealer owner',
      }),
    }).then(load);
  };
  return { rows, remove };
}

/** Dealer owner: request staff logins (distributor approves); remove staff immediately (SOP 3). */
export function StaffPage({ dealerId }: { readonly dealerId: number }): ReactNode {
  const i = useI18n();
  const { rows, remove } = useStaff(dealerId);
  const [removing, setRemoving] = useState<Member | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('staff.title')}</h1>
      {rows.length === 0 ? <EmptyState>{i.t('staff.empty')}</EmptyState> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((s) => (
          <StaffRow
            key={s.id}
            member={s}
            onRemove={() => {
              setRemoving(s);
            }}
          />
        ))}
      </ul>
      <AddStaffForm />
      <Dialog
        open={removing !== null}
        title={i.t('staff.removeConfirm', { name: removing?.name ?? '' })}
        onClose={() => {
          setRemoving(null);
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setRemoving(null);
            }}
          >
            {i.t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (removing !== null) remove(removing);
              setRemoving(null);
            }}
          >
            {i.t('staff.remove')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function StaffRow({
  member,
  onRemove,
}: {
  readonly member: Member;
  readonly onRemove: () => void;
}): ReactNode {
  const i = useI18n();
  const active = member.status === 'ACTIVE';
  return (
    <li className="flex items-center justify-between gap-2 rounded-card border border-border p-3">
      <span>
        {member.name}{' '}
        <StatusPill tone={active ? 'good' : 'neutral'}>
          {active ? i.t('status.APPROVED') : i.t('status.REJECTED')}
        </StatusPill>
      </span>
      {active ? (
        <span className="w-32">
          <Button variant="danger" onClick={onRemove}>
            {i.t('staff.remove')}
          </Button>
        </span>
      ) : null}
    </li>
  );
}

function AddStaffForm(): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const e164 = normaliseE164(mobile);
  return (
    <form
      className="flex flex-col gap-3 rounded-card bg-surface-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (e164 === null) return;
        void api.rpc('request_staff', { p_name: name, p_mobile: e164 }, v.unknown()).then((r) => {
          setMsg(r.ok ? i.t('staff.requested') : i.t('common.error'));
          if (r.ok) {
            setName('');
            setMobile('');
          }
        });
      }}
    >
      <h2 className="text-xl font-bold">{i.t('staff.add')}</h2>
      <Field
        label={i.t('staff.name')}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        autoComplete="name"
        required
        minLength={2}
      />
      <Field
        label={i.t('staff.mobile')}
        value={mobile}
        onChange={(e) => {
          setMobile(e.target.value);
        }}
        autoComplete="tel"
        inputMode="tel"
        required
        error={mobile !== '' && e164 === null ? i.t('auth.mobile') : null}
      />
      <Button type="submit">{i.t('staff.request')}</Button>
      <p role="status">{msg}</p>
    </form>
  );
}
