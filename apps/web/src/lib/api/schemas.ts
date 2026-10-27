import { COUPON_RESULTS, PAINTER_STATUSES } from '@24m/shared';
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
});
export type CheckResponse = v.InferOutput<typeof CheckResponse>;

export const RedeemLine = v.object({
  code: v.optional(v.nullable(v.string())),
  result: Result,
  serial: v.optional(v.string()),
  value_paise: v.optional(v.number()),
  redeemed_at: v.optional(Ts),
  expires_at: v.optional(v.nullable(Ts)),
});

export const RedeemResponse = v.object({
  result: Result,
  batch_id: v.optional(v.number()),
  count: v.optional(v.number()),
  value_paise: v.optional(v.number()),
  painter_token: v.optional(v.nullable(v.string())),
  lines: v.optional(v.array(RedeemLine), []),
  at: v.optional(Ts),
});
export type RedeemResponse = v.InferOutput<typeof RedeemResponse>;

export const OutcomeResponse = v.union([
  v.object({ found: v.literal(false) }),
  v.object({ found: v.literal(true), response: RedeemResponse }),
]);

export const BatchStatus = v.object({
  batch_id: v.number(),
  status: v.union([v.picklist(PAINTER_STATUSES), v.literal('NONE')]),
  count: v.number(),
  value_paise: v.number(),
  token: v.optional(v.nullable(v.string())),
  on_time_until: v.optional(v.nullable(Ts)),
  expires_at: v.optional(v.nullable(Ts)),
  confirmed_at: v.optional(v.nullable(Ts)),
  painter: v.optional(v.nullable(v.string())),
  created_at: v.optional(Ts),
  server_now: v.optional(Ts),
});
export type BatchStatus = v.InferOutput<typeof BatchStatus>;

export const DealerHome = v.object({
  today_count: v.number(),
  today_paise: v.number(),
  month_count: v.number(),
  month_paise: v.number(),
  pending_painter: v.number(),
  dealer: v.nullable(v.object({ name: v.string(), status: v.string() })),
  user: v.object({ name: v.string(), role: v.string() }),
  wa_business_number: v.nullable(v.string()),
  helpline: v.nullable(v.string()),
  as_of: Ts,
});
export type DealerHome = v.InferOutput<typeof DealerHome>;

export const BatchList = v.array(
  v.object({
    batch_id: v.number(),
    created_at: Ts,
    count: v.number(),
    value_paise: v.number(),
    redeemed_by: v.string(),
    painter_status: v.string(),
    token: v.nullable(v.string()),
    serials: v.nullable(v.array(v.string())),
  }),
);
export type BatchList = v.InferOutput<typeof BatchList>;

export const PublicInfo = v.object({
  result: v.picklist(['GENUINE', 'NOT_RECOGNISED', 'INVALID_FORMAT', 'RATE_LIMITED']),
  value_paise: v.optional(v.number()),
  helpline: v.optional(v.nullable(v.string())),
});

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
