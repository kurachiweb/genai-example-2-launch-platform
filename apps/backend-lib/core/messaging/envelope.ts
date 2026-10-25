import { z } from 'zod';

export interface QueueEnvelope {
  readonly v: 1;
  readonly type: string;
  readonly id: string;
  readonly sentAt: string;
  readonly body: unknown;
}

export type DeadLetterReason =
  | 'invalid-envelope'
  | 'unknown-type'
  | 'invalid-body'
  | 'handler-failed'
  | 'auto-moved';

export interface DeadLetterNotice {
  readonly v: 1;
  readonly kind: 'dead-letter-notice';
  readonly messageId: string | undefined;
  readonly type: string | undefined;
  readonly attempts: number;
  readonly reason: DeadLetterReason;
  // 例外のクラス名だけを持ち、本文や例外の文言は通知に含めない
  readonly errorName: string | undefined;
  readonly failedAt: string;
}

export type ParsedMessage =
  | { readonly ok: true; readonly envelope: QueueEnvelope }
  | { readonly ok: false; readonly reason: 'invalid-envelope' };

const envelopeSchema = z.object({
  v: z.literal(1),
  type: z.string().min(1),
  id: z.ulid(),
  sentAt: z.iso.datetime(),
  body: z.unknown(),
});

const deadLetterNoticeSchema = z.object({
  v: z.literal(1),
  kind: z.literal('dead-letter-notice'),
  messageId: z.string().optional(),
  type: z.string().optional(),
  attempts: z.int().nonnegative(),
  reason: z.enum([
    'invalid-envelope',
    'unknown-type',
    'invalid-body',
    'handler-failed',
    'auto-moved',
  ] satisfies readonly DeadLetterReason[]),
  errorName: z.string().optional(),
  failedAt: z.iso.datetime(),
});

const INVALID_ENVELOPE: ParsedMessage = Object.freeze({
  ok: false,
  reason: 'invalid-envelope',
});

export function parseEnvelope(raw: unknown): ParsedMessage {
  // z.unknown()は欠けたキーも受け付けるため、本文のキーの有無は別に確かめる
  if (typeof raw !== 'object' || raw === null || !Object.hasOwn(raw, 'body')) {
    return INVALID_ENVELOPE;
  }
  const result = envelopeSchema.safeParse(raw);
  if (!result.success) {
    return INVALID_ENVELOPE;
  }
  const { v, type, id, sentAt, body } = result.data;
  return { ok: true, envelope: { v, type, id, sentAt, body } };
}

export function isDeadLetterNotice(raw: unknown): raw is DeadLetterNotice {
  return deadLetterNoticeSchema.safeParse(raw).success;
}
