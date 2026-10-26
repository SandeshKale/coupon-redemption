/**
 * Normalises a phone number to E.164. Meta sends `from` as international digits
 * without '+'. Bare 10-digit Indian mobiles (starting 6–9) get +91.
 * Returns null for anything that cannot be a valid E.164 number.
 */
export function normaliseE164(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;

  if (!hasPlus) {
    if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
    if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  }
  if (digits.startsWith('91') && digits.length === 12) {
    return /^91[6-9]\d{9}$/.test(digits) ? `+${digits}` : null;
  }
  // E.164: max 15 digits, no leading zero in country code.
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

export function isIndianMobile(e164: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(e164);
}

/** `+919812344521` → `+91 98•••• 4521`. Non-Indian numbers keep country code + last 4. */
export function maskPhone(e164: string): string {
  if (isIndianMobile(e164)) {
    return `+91 ${e164.slice(3, 5)}•••• ${e164.slice(-4)}`;
  }
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  return `+${digits.slice(0, 2)} •••• ${digits.slice(-4)}`;
}
