// GENERATED from packages/shared/src by scripts/sync-shared.mjs. Do not edit.
/** All money is integer paise. 1 rupee = 100 paise. */
export const PAISE_PER_RUPEE = 100;

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError(`invalid paise amount: ${paise}`);
  }
}

export function rupeesToPaise(rupees: number): number {
  const paise = Math.round(rupees * PAISE_PER_RUPEE);
  assertPaise(paise);
  return paise;
}

export function sumPaise(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertPaise(v);
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('paise sum overflow');
  }
  return total;
}

/** `10000000` paise → `₹1,00,000` (Indian grouping, no decimals for whole rupees). */
export function formatInr(paise: number): string {
  assertPaise(paise);
  return inr.format(paise / PAISE_PER_RUPEE).replace(/\u00a0/g, '');
}
