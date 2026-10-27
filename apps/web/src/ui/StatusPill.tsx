import type { ReactNode } from 'react';

const TONE = {
  good: 'bg-success-bg text-success',
  bad: 'bg-danger-bg text-danger',
  warn: 'bg-warning-bg text-warning-ink',
  neutral: 'bg-surface-2 text-ink',
} as const;

export type Tone = keyof typeof TONE;

export function StatusPill({
  tone,
  children,
}: {
  readonly tone: Tone;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}
