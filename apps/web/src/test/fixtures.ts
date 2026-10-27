import { luhn32CheckChar } from '@24m/shared';

export const code = (payload12: string): string => payload12 + luhn32CheckChar(payload12);
export const CODE = code('7KQ2M9XHTB4R');
export const CODE2 = code('0000000000AB');

export const VALID = {
  result: 'VALID',
  code: CODE,
  serial: 'P24-0000001',
  value_paise: 10000,
  product: '24M Primer 1 L',
  expires_at: '2027-12-31T18:30:00Z',
};
export const REDEEMED = {
  result: 'REDEEMED',
  batch_id: 42,
  count: 1,
  value_paise: 10000,
  lines: [{ code: CODE, serial: 'P24-0000001', result: 'REDEEMED', value_paise: 10000 }],
  at: '2026-10-26T10:00:00Z',
};
export const HOME = {
  today_count: 3,
  today_paise: 30000,
  month_count: 20,
  month_paise: 200000,
  dealer: { name: 'Shree Ganesh Paints', status: 'ACTIVE' },
  user: { name: 'Owner A', role: 'DEALER_OWNER' },
  helpline: '+91 20 0000 0000',
  as_of: '2026-10-26T10:00:00Z',
};
export const PROFILE = (role: string, extra: Record<string, unknown> = {}) => [
  {
    id: 1,
    name: 'U',
    role,
    dealer_id: role.startsWith('DEALER') ? 1 : null,
    distributor_id: role === 'DISTRIBUTOR' ? 1 : null,
    ...extra,
  },
];
