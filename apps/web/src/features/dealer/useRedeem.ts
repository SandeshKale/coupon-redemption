import { useCallback, useRef, useState } from 'react';

import type { ApiFailure } from '../../lib/api/client.ts';
import { redeemCodes } from '../../lib/api/redeem.ts';
import type { RedeemResponse } from '../../lib/api/schemas.ts';
import { useServices } from '../../lib/services.ts';
import { reportTiming } from '../../lib/telemetry.ts';

export type RedeemState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'saving' }
  | { readonly phase: 'checking' }
  | { readonly phase: 'done'; readonly response: RedeemResponse }
  | { readonly phase: 'not_redeemed' }
  | { readonly phase: 'failed'; readonly error: ApiFailure };

/** One Confirm = one idempotency key. The button is locked while a request is in flight (EC-023). */
export function useRedeem(): {
  state: RedeemState;
  redeem: (codes: readonly string[]) => Promise<RedeemState>;
  busy: boolean;
} {
  const { redeemDeps } = useServices();
  const [state, setState] = useState<RedeemState>({ phase: 'idle' });
  const inFlight = useRef(false);
  const redeem = useCallback(
    async (codes: readonly string[]): Promise<RedeemState> => {
      if (inFlight.current) return { phase: 'saving' };
      inFlight.current = true;
      const started = performance.now();
      try {
        const out = await redeemCodes(codes, redeemDeps, (p) => {
          setState({ phase: p });
        });
        const next: RedeemState =
          out.kind === 'done'
            ? { phase: 'done', response: out.response }
            : out.kind === 'not_redeemed'
              ? { phase: 'not_redeemed' }
              : { phase: 'failed', error: out.error };
        if (next.phase === 'done') reportTiming('confirm_to_receipt', performance.now() - started);
        setState(next);
        return next;
      } finally {
        inFlight.current = false;
      }
    },
    [redeemDeps],
  );
  return { state, redeem, busy: state.phase === 'saving' || state.phase === 'checking' };
}
