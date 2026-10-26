import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-success text-white hover:brightness-110',
  secondary: 'bg-surface text-ink border-2 border-border hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink underline underline-offset-4',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  readonly variant?: Variant;
  readonly size?: 'lg' | 'md';
  readonly loading?: boolean;
  /** A button is never disabled without a visible reason (§16.3). */
  readonly disabledReason?: string | null;
  readonly children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabledReason = null,
  children,
  className = '',
  ...rest
}: ButtonProps): ReactNode {
  const disabled = loading || disabledReason !== null;
  const reasonId = disabledReason === null ? undefined : `${rest.id ?? 'btn'}-reason`;
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        {...rest}
        disabled={disabled}
        aria-busy={loading}
        aria-describedby={reasonId}
        className={`${VARIANT[variant]} ${size === 'lg' ? 'min-h-14 text-lg' : 'min-h-12'} w-full rounded-btn px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
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
