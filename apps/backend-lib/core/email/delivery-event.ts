import { z } from 'zod';

import { isValidEmailAddress, toMatchingKey } from './email-address.ts';

interface DeliveryEventBase {
  readonly eventId: string;
  readonly recipient: string;
  readonly occurredAt: Date;
}

export type DeliveryEvent =
  | (DeliveryEventBase & { readonly kind: 'hard-bounce' })
  | (DeliveryEventBase & { readonly kind: 'soft-bounce' })
  | (DeliveryEventBase & { readonly kind: 'complaint' })
  | (DeliveryEventBase & {
      readonly kind: 'rejected';
      readonly party: 'recipient' | 'other';
      readonly reason: string;
    })
  | (DeliveryEventBase & { readonly kind: 'failed'; readonly reason: string })
  | (DeliveryEventBase & {
      readonly kind: 'ignored';
      readonly type: 'delivered' | 'deferred';
    });

export type ParsedDeliveryEvent =
  | { readonly ok: true; readonly event: DeliveryEvent }
  | {
      readonly ok: false;
      readonly reason: 'invalid-format' | 'unknown-type';
      readonly type: string | undefined;
    };

export const DELIVERY_EVENT_TYPE_PREFIX = 'cf.email.sending.message.';

export const DELIVERY_EVENT_SCHEMA_VERSION = 1;

export const UNKNOWN_DELIVERY_EVENT_REASON = 'unknown';

const DELIVERY_EVENT_NAMES = [
  'delivered',
  'deferred',
  'bounced',
  'failed',
  'rejected',
  'complained',
] as const;

type DeliveryEventName = (typeof DELIVERY_EVENT_NAMES)[number];

// 理由はログとエラートラッキングへ送るため、自由記述(宛先や配送サーバーの応答を含み得る)を識別子の形に限って持ち込まない
const REASON_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

const typedSchema = z.object({ type: z.string() });

const versionSchema = z.object({
  metadata: z.object({
    eventSchemaVersion: z.literal(DELIVERY_EVENT_SCHEMA_VERSION),
  }),
});

const baseSchema = z.object({
  payload: z.object({
    eventId: z.string().min(1),
    recipient: z.string().transform(toMatchingKey).refine(isValidEmailAddress),
  }),
  metadata: z.object({
    eventTimestamp: z.iso.datetime({ offset: true }).optional(),
  }),
});

const bouncedSchema = z.object({
  payload: z.object({
    bounce: z.object({ type: z.string().optional() }).optional(),
  }),
});

const rejectedSchema = z.object({
  payload: z.object({
    rejection: z
      .object({
        reason: z.string().optional(),
        party: z.string().optional(),
      })
      .optional(),
  }),
});

const failedSchema = z.object({
  payload: z.object({
    failure: z.object({ reason: z.string().optional() }).optional(),
  }),
});

export function parseDeliveryEvent(
  raw: unknown,
  receivedAt: Date,
): ParsedDeliveryEvent {
  const typed = typedSchema.safeParse(raw);
  if (!typed.success) {
    return invalidFormat(undefined);
  }
  const { type } = typed.data;
  if (!versionSchema.safeParse(raw).success) {
    return invalidFormat(type);
  }
  const name = toEventName(type);
  if (name === undefined) {
    return { ok: false, reason: 'unknown-type', type };
  }
  const base = baseSchema.safeParse(raw);
  if (!base.success) {
    return invalidFormat(type);
  }
  const { payload, metadata } = base.data;
  const common: DeliveryEventBase = {
    eventId: payload.eventId,
    recipient: payload.recipient,
    occurredAt:
      metadata.eventTimestamp === undefined
        ? receivedAt
        : new Date(metadata.eventTimestamp),
  };
  const event = normalize(name, common, raw);
  return event === undefined ? invalidFormat(type) : { ok: true, event };
}

function toEventName(type: string): DeliveryEventName | undefined {
  if (!type.startsWith(DELIVERY_EVENT_TYPE_PREFIX)) {
    return undefined;
  }
  const name = type.slice(DELIVERY_EVENT_TYPE_PREFIX.length);
  return DELIVERY_EVENT_NAMES.find((known) => known === name);
}

function normalize(
  name: DeliveryEventName,
  common: DeliveryEventBase,
  raw: unknown,
): DeliveryEvent | undefined {
  switch (name) {
    case 'delivered':
    case 'deferred':
      return { ...common, kind: 'ignored', type: name };
    case 'complained':
      return { ...common, kind: 'complaint' };
    case 'bounced': {
      const parsed = bouncedSchema.safeParse(raw);
      if (!parsed.success) {
        return undefined;
      }
      const isHard = parsed.data.payload.bounce?.type === 'hard';
      return { ...common, kind: isHard ? 'hard-bounce' : 'soft-bounce' };
    }
    case 'rejected': {
      const parsed = rejectedSchema.safeParse(raw);
      if (!parsed.success) {
        return undefined;
      }
      const rejection = parsed.data.payload.rejection;
      return {
        ...common,
        kind: 'rejected',
        party: rejection?.party === 'recipient' ? 'recipient' : 'other',
        reason: toReason(rejection?.reason),
      };
    }
    case 'failed': {
      const parsed = failedSchema.safeParse(raw);
      if (!parsed.success) {
        return undefined;
      }
      return {
        ...common,
        kind: 'failed',
        reason: toReason(parsed.data.payload.failure?.reason),
      };
    }
  }
}

function toReason(value: string | undefined): string {
  return value !== undefined && REASON_PATTERN.test(value)
    ? value
    : UNKNOWN_DELIVERY_EVENT_REASON;
}

function invalidFormat(type: string | undefined): ParsedDeliveryEvent {
  return { ok: false, reason: 'invalid-format', type };
}
