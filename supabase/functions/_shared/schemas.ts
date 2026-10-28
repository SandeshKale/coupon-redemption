import * as v from 'valibot';

const Role = v.picklist([
  'DEALER_STAFF',
  'DEALER_OWNER',
  'DISTRIBUTOR',
  'M24_ADMIN',
  'M24_FINANCE',
  'M24_VIEWER',
]);
const Id = v.pipe(v.number(), v.integer(), v.minValue(1));

const Pin = v.pipe(v.string(), v.regex(/^[0-9]{4}$/));

export const CreateUserInput = v.strictObject({
  name: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
  mobile: v.optional(v.pipe(v.string(), v.maxLength(20))),
  email: v.optional(v.pipe(v.string(), v.email(), v.maxLength(200))),
  role: Role,
  dealer_id: v.optional(Id),
  distributor_id: v.optional(Id),
  request_id: v.optional(Id),
  pin: v.optional(Pin),
  gst: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.toUpperCase(),
      v.regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/),
    ),
  ),
  is_rep: v.optional(v.boolean()),
  parent_distributor_id: v.optional(Id),
});

export const PinLoginInput = v.strictObject({
  mobile: v.pipe(v.string(), v.maxLength(20)),
  pin: v.pipe(v.string(), v.maxLength(8)),
});

export const LoginLinkInput = v.strictObject({ user_id: Id });

export const UserStatusInput = v.strictObject({
  user_id: Id,
  status: v.picklist(['ACTIVE', 'INACTIVE']),
  reason: v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(300)),
});

export const LinkRequestInput = v.strictObject({ mobile: v.pipe(v.string(), v.maxLength(20)) });

export const DealerCsvRow = v.strictObject({
  code: v.pipe(v.string(), v.trim(), v.regex(/^[A-Za-z0-9-]{2,20}$/)),
  name: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
  mobile: v.pipe(v.string(), v.trim(), v.maxLength(20)),
  city: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80))),
  distributor_code: v.pipe(v.string(), v.trim(), v.regex(/^[A-Za-z0-9/-]{2,20}$/)),
});

export async function readJson<T extends v.GenericSchema>(
  req: Request,
  schema: T,
  limit = 16 * 1024,
): Promise<v.InferOutput<T> | null> {
  const text = await req.text();
  if (text.length > limit) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = v.safeParse(schema, raw);
  return r.success ? r.output : null;
}
