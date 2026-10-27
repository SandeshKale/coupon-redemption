import { normaliseE164 } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { loadAuthClient } from '../../lib/auth/client.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, Field, ResultCard } from '../../ui/index.ts';

/** Only same-site paths: never an address on another site. */
export function safeNext(raw: string | null): string {
  return raw !== null && /^\/(?![/\\])/.test(raw) ? raw : '/';
}

/**
 * Logged-out screen. Dealers, distributors and sales reps: registered mobile number and 4-digit PIN.
 * 24M staff: email + password, then TOTP (enrolment on first login).
 */
export function LoginPage(): ReactNode {
  const i = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{i.t('login.title')}</h1>
      <PinLogin />
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{i.t('login.staffTitle')}</h2>
        <M24Login />
      </section>
    </div>
  );
}

function PinLogin(): ReactNode {
  const i = useI18n();
  const { pinLogin } = useServices();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e164 = normaliseE164(mobile);
  const ready = e164 !== null && /^[0-9]{4}$/.test(pin);
  const submit = async (): Promise<void> => {
    if (e164 === null) return;
    setBusy(true);
    setError(null);
    const r = await pinLogin(e164, pin);
    setBusy(false);
    if (r === 'ok') {
      void navigate(safeNext(params.get('next')), { replace: true });
      return;
    }
    setPin('');
    setError(
      r === 'wrong'
        ? i.t('login.pinWrong')
        : r === 'limited'
          ? i.t('auth.rateLimited')
          : i.t('auth.requestFailed'),
    );
  };
  return (
    <form
      className="flex flex-col gap-3 rounded-card bg-surface-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p>{i.t('login.pinHelp')}</p>
      <Field
        label={i.t('login.mobile')}
        value={mobile}
        onChange={(e) => {
          setMobile(e.target.value);
        }}
        autoComplete="tel"
        inputMode="tel"
        required
      />
      <Field
        label={i.t('login.pin')}
        type="password"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, ''));
        }}
        autoComplete="current-password"
        inputMode="numeric"
        maxLength={4}
        required
      />
      {error === null ? null : <ResultCard variant="invalid" title={error} />}
      <Button
        type="submit"
        loading={busy}
        disabledReason={!ready && (mobile !== '' || pin !== '') ? i.t('login.pinRules') : null}
      >
        {i.t('login.submit')}
      </Button>
    </form>
  );
}

type Step =
  | { kind: 'password' }
  | { kind: 'totp'; factorId: string }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string };

/** 24M sign-in: password, then TOTP (enrolling a factor on first login). */
function useM24Login(): {
  step: Step;
  error: string | null;
  submit: (email: string, password: string, code: string) => Promise<void>;
} {
  const i = useI18n();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [error, setError] = useState<string | null>(null);
  const afterPassword = async (): Promise<void> => {
    const auth = await loadAuthClient();
    const { data } = await auth.mfa.listFactors();
    // listFactors().totp contains verified factors only.
    const totp = data?.totp[0];
    if (totp !== undefined) {
      setStep({ kind: 'totp', factorId: totp.id });
      return;
    }
    const enrolled = await auth.mfa.enroll({ factorType: 'totp' });
    if (enrolled.error !== null) {
      setError(i.t('common.error'));
      return;
    }
    setStep({
      kind: 'enroll',
      factorId: enrolled.data.id,
      qr: enrolled.data.totp.qr_code,
      secret: enrolled.data.totp.secret,
    });
  };
  const submit = async (email: string, password: string, code: string): Promise<void> => {
    setError(null);
    const auth = await loadAuthClient();
    if (step.kind === 'password') {
      const { error: e } = await auth.signInWithPassword({ email, password });
      if (e !== null) setError(i.t('login.error'));
      else await afterPassword();
      return;
    }
    const { error: e } = await auth.mfa.challengeAndVerify({
      factorId: step.factorId,
      code: code.replace(/\s/g, ''),
    });
    if (e !== null) setError(i.t('login.codeError'));
    else void navigate('/');
  };
  return { step, error, submit };
}

function M24Login(): ReactNode {
  const i = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { step, error, submit } = useM24Login();
  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(email, password, code);
      }}
    >
      {step.kind === 'password' ? (
        <>
          <Field
            label={i.t('login.email')}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            autoComplete="username"
            required
          />
          <Field
            label={i.t('login.password')}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            autoComplete="current-password"
            required
          />
        </>
      ) : (
        <>
          {step.kind === 'enroll' ? <EnrollTotp qr={step.qr} secret={step.secret} /> : null}
          <Field
            label={i.t('login.totp')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
            autoComplete="one-time-code"
            inputMode="numeric"
            required
          />
        </>
      )}
      {error === null ? null : <ResultCard variant="invalid" title={error} />}
      <Button type="submit">
        {step.kind === 'password' ? i.t('login.submit') : i.t('login.verify')}
      </Button>
    </form>
  );
}

function EnrollTotp({ qr, secret }: { readonly qr: string; readonly secret: string }): ReactNode {
  const i = useI18n();
  return (
    <>
      <h2 className="text-xl font-bold">{i.t('login.enroll')}</h2>
      <p>{i.t('login.enrollHelp')}</p>
      <img src={qr} alt={i.t('login.secretAlt')} width={200} height={200} />
      <p className="font-mono break-all">{secret}</p>
    </>
  );
}
