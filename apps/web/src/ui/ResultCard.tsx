import type { ReactNode } from 'react';

import { useReveal } from './useReveal.ts';

export type ResultVariant = 'valid' | 'invalid' | 'checking' | 'warning';

const STYLE: Record<ResultVariant, { box: string; icon: string }> = {
  valid: { box: 'bg-success-bg text-success border-success', icon: '✓' },
  invalid: { box: 'bg-danger-bg text-danger border-danger', icon: '✕' },
  checking: { box: 'bg-warning-bg text-warning-ink border-warning-ink', icon: '⟳' },
  warning: { box: 'bg-warning-bg text-warning-ink border-warning-ink', icon: '⚑' },
};

/**
 * The answer is the biggest thing on the screen: icon + words + colour, never colour alone.
 * Do-not-pay results are announced assertively (role=alert), everything else politely.
 */
export function ResultCard({
  variant,
  title,
  children,
}: {
  readonly variant: ResultVariant;
  readonly title: string;
  readonly children?: ReactNode;
}): ReactNode {
  const s = STYLE[variant];
  // A refusal or warning that appears below the fold (a login error, a refused scan) is brought into view.
  const ref = useReveal<HTMLElement>(variant === 'valid' ? null : title, 'nearest');
  return (
    <section
      ref={ref}
      role={variant === 'invalid' ? 'alert' : 'status'}
      aria-live={variant === 'invalid' ? 'assertive' : 'polite'}
      className={`pop-in min-h-40 min-w-0 rounded-card border-2 p-4 sm:p-5 ${s.box}`}
    >
      <p className="flex items-start gap-3 text-2xl font-bold">
        <span aria-hidden="true" className="text-3xl leading-none">
          {s.icon}
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
      </p>
      {children === undefined ? null : <div className="mt-3 text-ink">{children}</div>}
    </section>
  );
}
