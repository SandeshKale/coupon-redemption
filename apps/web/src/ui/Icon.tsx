import type { ReactNode } from 'react';

const PATH = {
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  keyboard:
    'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  history: 'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  chevron: 'M9 6l6 6-6 6',
  back: 'M19 12H5M12 19l-7-7 7-7',
  check: 'M20 6 9 17l-5-5',
} as const;

export type IconName = keyof typeof PATH;

/** Simple line icons. Always decorative: the words next to them carry the meaning. */
export function Icon({
  name,
  className = 'h-6 w-6',
}: {
  readonly name: IconName;
  readonly className?: string;
}): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATH[name]} />
    </svg>
  );
}
