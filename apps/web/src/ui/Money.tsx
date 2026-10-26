import { formatInr } from '@24m/shared';
import type { ReactNode } from 'react';

export function Money({ paise }: { readonly paise: number }): ReactNode {
  return <span className="tabular-nums">{formatInr(paise)}</span>;
}
