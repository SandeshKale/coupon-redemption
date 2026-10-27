import { type ReactNode, useState } from 'react';
import * as v from 'valibot';

import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, Field, ResultCard } from '../../ui/index.ts';

const PIN = /^[0-9]{4}$/;

/** Change my own PIN (dealers, distributors and sales reps). */
export function PinPage(): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = again !== '' && again !== newPin;
  const invalid = !PIN.test(oldPin) || !PIN.test(newPin) || again !== newPin;
  const submit = async (): Promise<void> => {
    setBusy(true);
    const r = await api.rpc('change_my_pin', { p_old: oldPin, p_new: newPin }, v.unknown());
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: i.t('pin.changed') });
      setOldPin('');
      setNewPin('');
      setAgain('');
      return;
    }
    const code = r.error.kind === 'business' ? r.error.code : '';
    setMsg({
      ok: false,
      text:
        code === 'WRONG_PIN'
          ? i.t('pin.wrong')
          : code === 'WEAK_PIN'
            ? i.t('pin.weak')
            : i.t('common.error'),
    });
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1 className="text-2xl font-bold">{i.t('pin.title')}</h1>
      <PinField
        label={i.t('pin.old')}
        value={oldPin}
        onChange={setOldPin}
        auto="current-password"
      />
      <PinField label={i.t('pin.new')} value={newPin} onChange={setNewPin} auto="new-password" />
      <PinField
        label={i.t('pin.confirm')}
        value={again}
        onChange={setAgain}
        auto="new-password"
        error={mismatch ? i.t('pin.mismatch') : null}
      />
      {msg === null ? null : <ResultCard variant={msg.ok ? 'valid' : 'invalid'} title={msg.text} />}
      <Button type="submit" loading={busy} disabledReason={invalid ? i.t('pin.rules') : null}>
        {i.t('pin.save')}
      </Button>
    </form>
  );
}

/** A masked 4-digit box that only takes digits. */
function PinField({
  label,
  value,
  onChange,
  auto,
  error = null,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly auto: 'current-password' | 'new-password';
  readonly error?: string | null;
}): ReactNode {
  return (
    <Field
      label={label}
      type="password"
      inputMode="numeric"
      autoComplete={auto}
      maxLength={4}
      value={value}
      error={error}
      onChange={(e) => {
        onChange(e.target.value.replace(/\D/g, ''));
      }}
      required
    />
  );
}
