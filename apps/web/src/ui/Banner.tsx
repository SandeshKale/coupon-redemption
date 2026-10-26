import type { ReactNode } from 'react';

export function Banner({
  tone,
  children,
  action,
}: {
  readonly tone: 'warning' | 'info';
  readonly children: ReactNode;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 font-semibold ${tone === 'warning' ? 'bg-warning-bg text-warning-ink' : 'bg-surface-2 text-ink'}`}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}
