import type { ReactNode } from 'react';

/** The 24M wordmark (supplied vector, Asset 5), drawn in the current text colour. */
const PATH =
  'M 29.07 62.29 L 76.54 62.29 L 76.54 75.25 L 0 75.25 L 0 73.57 L 29.5 38.8 C 31.75 36.19 33.54 33.72 34.88 31.36 C 36.21 29.01 36.88 26.71 36.88 24.46 C 36.88 21.3 35.93 18.74 34.03 16.77 C 32.14 14.81 29.46 13.82 26.02 13.82 C 22.59 13.82 19.93 14.86 18.07 16.93 C 16.21 19 15.28 21.93 15.28 25.73 L 0 25.73 C 0 20.67 1.14 16.21 3.42 12.35 C 5.71 8.48 8.82 5.48 12.75 3.34 C 16.68 1.2 21.18 0.12 26.24 0.12 C 31.36 0.12 35.86 1.18 39.72 3.29 C 43.58 5.39 46.62 8.22 48.84 11.77 C 51.05 15.32 52.16 19.27 52.16 23.62 C 52.16 26.57 51.7 29.36 50.79 32 C 49.87 34.63 48.18 37.5 45.73 40.59 L 41.89 45.58 L 34.25 55.54 Z M 29.07 62.29 M 95.47 0.12 L 95.47 95.53 L 80.82 95.53 L 80.82 27.24 L 57.59 58.02 L 39.24 58.02 L 82.93 0.12 Z M 95.47 0.12 M 157.95 0.13 L 135.11 30.38 L 112.29 0.13 L 99.74 0.13 L 99.74 75.25 L 114.39 75.25 L 114.39 27.24 L 125.93 42.53 L 128.52 45.96 L 141.71 45.96 L 144.29 42.53 L 155.83 27.24 L 155.83 75.25 L 170.48 75.25 L 170.48 0.13 Z M 157.95 0.13';

export function Logo({
  className = 'h-8 w-auto',
  title,
}: {
  readonly className?: string;
  /** Leave out when the logo sits next to the app name (it is then decorative). */
  readonly title?: string;
}): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 171.241 95.8259"
      className={className}
      fill="currentColor"
      role={title === undefined ? undefined : 'img'}
      aria-label={title}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
    >
      <path fillRule="nonzero" d={PATH} />
    </svg>
  );
}
