import { normaliseE164 } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import * as v from 'valibot';

import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, Field } from '../../ui/index.ts';

import { useAction, useRpcData } from './data.ts';
import { ActionForm, nullIfEmpty, Section, Status } from './parts.tsx';

const RedeemResult = v.object({
  redeemed: v.number(),
  not_redeemable: v.array(v.object({ serial: v.string(), status: v.string() })),
  not_found: v.array(v.string()),
});

/** Serial numbers typed or pasted: one per line or separated by commas or spaces. */
export function parseSerials(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s !== ''),
    ),
  ];
}

function ConfirmBar({
  count,
  busy,
  onYes,
  onCancel,
}: {
  readonly count: number;
  readonly busy: boolean;
  readonly onYes: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const i = useI18n();
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-card bg-surface-2 p-4">
      <p className="font-semibold">{i.t('m24.redeemConfirm', { count })}</p>
      <span className="flex flex-wrap gap-2">
        <Button loading={busy} onClick={onYes}>
          {i.t('m24.redeemYes')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {i.t('m24.redeemCancel')}
        </Button>
      </span>
    </div>
  );
}

/** 24M admin and finance mark coupons Redeemed when the credit note is issued. Final: no undo. */
export function RedeemPage(): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const [staged, setStaged] = useState<{ serials: string[]; note: string | null } | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; refused: string[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = async (): Promise<void> => {
    if (staged === null) return;
    setBusy(true);
    const r = await api.rpc(
      'redeem_coupons',
      { p_serials: staged.serials, p_credit_note: staged.note },
      RedeemResult,
    );
    setBusy(false);
    setStaged(null);
    setFailed(!r.ok);
    if (!r.ok) {
      setOutcome({ text: i.t('common.error'), refused: [] });
      return;
    }
    setOutcome({
      text: i.t('m24.redeemDone', {
        done: r.data.redeemed,
        skipped: r.data.not_redeemable.length,
        missing: r.data.not_found.length,
      }),
      refused: [
        ...r.data.not_redeemable.map((x) => `${x.serial} (${x.status})`),
        ...r.data.not_found.map((s) => `${s} (–)`),
      ],
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.redeem')}</h1>
      <Section title={i.t('nav.redeem')}>
        <ActionForm
          submitLabel={i.t('m24.redeemCheck')}
          fields={[
            { name: 'serials', label: 'm24.redeemHelp', type: 'textarea' },
            { name: 'note', label: 'm24.creditNote', required: false },
          ]}
          onSubmit={(vals) => {
            const serials = parseSerials(vals['serials'] ?? '');
            setOutcome(null);
            setStaged(serials.length === 0 ? null : { serials, note: nullIfEmpty(vals['note']) });
          }}
        />
        {staged === null ? null : (
          <ConfirmBar
            count={staged.serials.length}
            busy={busy}
            onYes={() => void confirm()}
            onCancel={() => {
              setStaged(null);
            }}
          />
        )}
        <Status message={outcome?.text ?? null} error={failed} />
        {outcome !== null && outcome.refused.length > 0 ? (
          <div>
            <h3 className="font-semibold">{i.t('m24.redeemRefused')}</h3>
            <p className="font-mono text-sm break-words">{outcome.refused.join(', ')}</p>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/** One-coupon shortcut used on the lookup card (admin and finance). */
export function RedeemOne({ serial }: { readonly serial: string }): ReactNode {
  const i = useI18n();
  const act = useAction();
  return (
    <>
      <Button
        loading={act.pending}
        onClick={() => void act.run('redeem_coupons', { p_serials: [serial], p_credit_note: null })}
      >
        {i.t('m24.markRedeemed')}
      </Button>
      <Status message={act.message} error={act.error} />
    </>
  );
}

/** The helpline number shown to dealers and on the public coupon page. */
export function HelplineSection(): ReactNode {
  const i = useI18n();
  const act = useAction();
  const current = useRpcData('public_helpline', {}, v.nullable(v.string()));
  return (
    <Section title={i.t('m24.helpline')}>
      <p className="text-muted">{i.t('m24.helplineHelp')}</p>
      <ActionForm
        submitLabel={i.t('m24.saveHelpline')}
        pending={act.pending}
        fields={[
          {
            name: 'number',
            label: 'm24.helpline',
            type: 'tel',
            initial: current.data ?? '',
          },
        ]}
        key={current.data ?? ''}
        onSubmit={async (vals) => {
          await act.run('set_helpline', { p_number: vals['number'] });
        }}
      />
      <Status message={act.message} error={act.error} />
    </Section>
  );
}

/** Inline "change mobile number" for 24M admin (the number is the person's login). */
export function MobileChange({ userId }: { readonly userId: number }): ReactNode {
  const i = useI18n();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState('');
  const e164 = normaliseE164(mobile);
  const save = async (): Promise<void> => {
    if (e164 === null) return;
    const r = await act.run('update_user_mobile', { p_user_id: userId, p_mobile: e164 });
    if (r !== null) {
      setOpen(false);
      setMobile('');
    }
  };
  return (
    <span className="flex flex-col gap-1">
      {open ? (
        <span className="flex items-end gap-2">
          <Field
            label={i.t('m24.newMobile')}
            type="tel"
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value);
            }}
          />
          <Button
            loading={act.pending}
            disabledReason={e164 === null ? i.t('m24.mobileHint') : null}
            onClick={() => void save()}
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
          {i.t('m24.changeMobile')}
        </Button>
      )}
      <Status message={act.message} error={act.error} />
    </span>
  );
}
