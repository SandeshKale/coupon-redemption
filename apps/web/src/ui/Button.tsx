import {
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Spinner } from './Spinner.tsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-success text-white hover:brightness-110',
  secondary: 'bg-surface text-ink border-2 border-border hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink underline underline-offset-4',
};

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'onClick'
> {
  readonly variant?: Variant;
  readonly size?: 'lg' | 'md';
  readonly loading?: boolean;
  /** A button is never disabled without a visible reason (§16.3). */
  readonly disabledReason?: string | null;
  /**
   * Return the promise of the work and the button looks busy and ignores further taps until it
   * settles, so a double tap can never run the action twice.
   */
  readonly onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
  readonly children: ReactNode;
}

const SIZE = { lg: 'min-h-14 text-lg', md: 'min-h-12' } as const;

const BASE =
  'inline-flex w-full items-center justify-center gap-2 rounded-btn px-4 font-semibold transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60';

function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    typeof x === 'object' && x !== null && typeof (x as { then?: unknown }).then === 'function'
  );
}

/** Runs a click handler; when it returns a promise, further taps are ignored until it settles. */
function useSingleFlight(
  onClick: ButtonProps['onClick'],
): [boolean, (e: MouseEvent<HTMLButtonElement>) => void] {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const handle = (e: MouseEvent<HTMLButtonElement>): void => {
    if (locked.current) {
      e.preventDefault();
      return;
    }
    const result = onClick?.(e);
    if (!isThenable(result)) return;
    locked.current = true;
    setPending(true);
    const release = (): void => {
      locked.current = false;
      if (mounted.current) setPending(false);
    };
    void result.then(release, release);
  };
  return [pending, handle];
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabledReason = null,
  onClick,
  children,
  className = '',
  ...rest
}: ButtonProps): ReactNode {
  const [pending, handleClick] = useSingleFlight(onClick);
  const busy = loading || pending;
  const disabled = busy || disabledReason !== null;
  const reasonId = disabledReason === null ? undefined : `${rest.id ?? 'btn'}-reason`;
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        {...rest}
        onClick={handleClick}
        disabled={disabled}
        aria-busy={busy}
        aria-describedby={reasonId}
        className={`${VARIANT[variant]} ${SIZE[size]} ${BASE} ${className}`}
      >
        {busy ? <Spinner /> : null}
        {children}
      </button>
      {disabledReason === null ? null : (
        <span id={reasonId} className="text-sm text-muted">
          {disabledReason}
        </span>
      )}
    </span>
  );
}
