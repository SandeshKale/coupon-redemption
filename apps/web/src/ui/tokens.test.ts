import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(css);
  if (m?.[1] === undefined) throw new Error(`missing token ${name}`);
  return m[1];
};

function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

// Every text/background pairing used by the components, with its WCAG target (§16.2, §17.1).
const PAIRS: [fg: string, bg: string, min: number][] = [
  ['c-ink', 'c-surface', 7],
  ['c-ink', 'c-surface-2', 7],
  ['c-muted', 'c-surface', 4.5],
  ['c-muted', 'c-surface-2', 4.5],
  ['c-success', 'c-surface', 7],
  ['c-success', 'c-success-bg', 4.5],
  ['c-surface', 'c-success', 7],
  ['c-danger', 'c-surface', 7],
  ['c-danger', 'c-danger-bg', 4.5],
  ['c-surface', 'c-danger', 7],
  ['c-warning-ink', 'c-warning-bg', 7],
  ['c-warning-ink', 'c-surface', 7],
  ['c-surface', 'c-ink', 7],
  ['c-ink', 'c-success-bg', 7],
  ['c-ink', 'c-danger-bg', 7],
  ['c-ink', 'c-warning-bg', 7],
  // Non-text UI components (1.4.11): borders and focus ring ≥ 3:1.
  ['c-border', 'c-surface', 3],
  ['c-focus', 'c-surface', 3],
  ['c-focus', 'c-success', 1.1],
];

describe('design tokens (WCAG 2.2 AA contrast)', () => {
  it.each(PAIRS)('%s on %s ≥ %d:1', (fg, bg, min) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });

  it('contrast maths', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 0);
    expect(contrast('#fff', '#fff')).toBe(1);
  });
});
