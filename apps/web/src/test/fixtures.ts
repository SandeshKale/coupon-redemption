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
export const VALIDATED = {
  result: 'VALIDATED',
  code: CODE,
  serial: 'P24-0000001',
  value_paise: 10000,
  validated_at: '2026-10-26T10:00:00Z',
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
export const STATS = {
  totals: {
    all: 1000,
    active: 800,
    validated: 120,
    validated_today: 7,
    validated_7d: 40,
    validated_30d: 120,
  },
  by_lot: [{ lot_no: 'LOT-001', quantity: 1000, active: 800, validated: 120, not_active: 80 }],
  by_distributor: [
    { code: 'DIST-PUNE', name: 'Pune Paint Distributors', dealers: 8, validated: 120 },
  ],
  top_dealers: [
    { dealer: 'Shree Ganesh Paints', distributor: 'Pune Paint Distributors', validated: 50 },
  ],
  recent: [{ serial: 'P24-0000001', dealer: 'Shree Ganesh Paints', at: '2026-10-26T10:00:00Z' }],
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
