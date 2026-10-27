import { COUPON_RESULTS } from '@24m/shared';
import * as v from 'valibot';

const Result = v.picklist(COUPON_RESULTS);
const Iso = v.pipe(v.string(), v.isoTimestamp());
const Ts = v.union([Iso, v.string()]);

export const CheckResponse = v.object({
  result: Result,
  code: v.optional(v.string()),
  serial: v.optional(v.string()),
  value_paise: v.optional(v.number()),
  product: v.optional(v.nullable(v.string())),
  expires_at: v.optional(v.nullable(Ts)),
  redeemed_at: v.optional(Ts),
  validated_at: v.optional(Ts),
});
export type CheckResponse = v.InferOutput<typeof CheckResponse>;

export const DealerHome = v.object({
  today_count: v.number(),
  today_paise: v.number(),
  month_count: v.number(),
  month_paise: v.number(),
  dealer: v.nullable(v.object({ name: v.string(), status: v.string() })),
  user: v.object({ name: v.string(), role: v.string() }),
  helpline: v.nullable(v.string()),
  as_of: Ts,
});
export type DealerHome = v.InferOutput<typeof DealerHome>;

export const ValidationList = v.array(
  v.object({
    serial: v.string(),
    value_paise: v.number(),
    validated_at: Ts,
    validated_by: v.string(),
  }),
);
export type ValidationList = v.InferOutput<typeof ValidationList>;

export const PublicInfo = v.object({
  result: v.picklist(['GENUINE', 'NOT_RECOGNISED', 'INVALID_FORMAT', 'RATE_LIMITED']),
  value_paise: v.optional(v.number()),
  state: v.optional(v.picklist(['ACTIVE', 'VALIDATED', 'EXPIRED'])),
  helpline: v.optional(v.nullable(v.string())),
});
export type PublicInfo = v.InferOutput<typeof PublicInfo>;

export const PinSession = v.object({
  access_token: v.string(),
  refresh_token: v.string(),
});

const Count = v.number();
export const CouponStats = v.object({
  totals: v.object({
    all: Count,
    active: Count,
    validated: Count,
    validated_today: Count,
    validated_7d: Count,
    validated_30d: Count,
  }),
  by_lot: v.array(
    v.object({
      lot_no: v.string(),
      quantity: Count,
      active: Count,
      validated: Count,
      not_active: Count,
    }),
  ),
  by_distributor: v.array(
    v.object({ code: v.string(), name: v.string(), dealers: Count, validated: Count }),
  ),
  top_dealers: v.array(v.object({ dealer: v.string(), distributor: v.string(), validated: Count })),
  recent: v.array(v.object({ serial: v.string(), dealer: v.string(), at: Ts })),
  as_of: Ts,
});
export type CouponStats = v.InferOutput<typeof CouponStats>;

export const Profile = v.array(
  v.object({
    id: v.number(),
    name: v.string(),
    role: v.picklist([
      'DEALER_STAFF',
      'DEALER_OWNER',
      'DISTRIBUTOR',
      'M24_ADMIN',
      'M24_FINANCE',
      'M24_VIEWER',
    ]),
    dealer_id: v.nullable(v.number()),
    distributor_id: v.nullable(v.number()),
  }),
);
export type Profile = v.InferOutput<typeof Profile>[number];

export const JsonArray = v.array(v.record(v.string(), v.unknown()));
export type Row = Record<string, unknown>;
