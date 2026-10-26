import { type ReactNode, useEffect, useState } from 'react';

import { hasPending } from '../lib/api/redeem.ts';
import { useI18n } from '../lib/i18n/index.ts';
import { Banner, Button } from '../ui/index.ts';

type Apply = () => Promise<void>;
let applyUpdate: Apply | null = null;
const listeners = new Set<() => void>();

/** Called by the service-worker registration when a new version is waiting. */
export function notifyUpdate(apply: Apply): void {
  applyUpdate = apply;
  listeners.forEach((l) => {
    l();
  });
}

/** EC-055: "Update available" — applied only on request and never during a redemption. */
export function UpdateBanner(): ReactNode {
  const { t } = useI18n();
  const [ready, setReady] = useState(applyUpdate !== null);
  useEffect(() => {
    const l = (): void => {
      setReady(true);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!ready) return null;
  return (
    <Banner
      tone="info"
      action={
        <span className="w-40">
          <Button
            variant="secondary"
            disabledReason={hasPending(localStorage) ? t('state.checkingResult') : null}
            onClick={() => {
              void applyUpdate?.();
            }}
          >
            {t('update.apply')}
          </Button>
        </span>
      }
    >
      {t('update.available')}
    </Banner>
  );
}
