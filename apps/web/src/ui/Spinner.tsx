import type { ReactNode } from 'react';

/** A turning ring for anything that is waiting. Decorative: the surrounding text says what is happening. */
export function Spinner({ className = 'h-5 w-5' }: { readonly className?: string }): ReactNode {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
