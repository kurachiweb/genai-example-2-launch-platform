import { z } from 'zod';

import {
  defineMessageContract,
  type MessageContract,
} from '../messaging/message-contract.ts';
import { isValidEmailAddress } from './email-address.ts';
import { type ExtraHeaders, validateExtraHeaders } from './email-headers.ts';

export interface EmailSendBody {
  readonly kind: string;
  readonly to: string;
  readonly input: unknown;
  readonly deadline?: string;
  readonly headers?: ExtraHeaders;
  readonly idempotencyKey?: string;
}

export const MAX_EMAIL_SEND_BODY_BYTES = 65_536;

export const MAX_EMAIL_IDEMPOTENCY_KEY_LENGTH = 128;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/;

export function isValidEmailIdempotencyKey(key: string): boolean {
  return (
    key.length <= MAX_EMAIL_IDEMPOTENCY_KEY_LENGTH &&
    IDEMPOTENCY_KEY_PATTERN.test(key)
  );
}

const textEncoder = new TextEncoder();

export function isWithinEmailSendBodyLimit(body: EmailSendBody): boolean {
  try {
    const json = JSON.stringify(body);
    return textEncoder.encode(json).byteLength <= MAX_EMAIL_SEND_BODY_BYTES;
  } catch {
    return false;
  }
}

// 送信側が検証した結果をそのまま封筒の本文にするため、検証の結果をもう一度検証しても同じ値になる規則だけで組む
const emailSendBodySchema = z
  .object({
    kind: z.string().min(1),
    to: z.string().refine(isValidEmailAddress),
    input: z.unknown(),
    deadline: z.iso.datetime().optional(),
    headers: z
      .record(z.string(), z.string())
      .refine((headers) => validateExtraHeaders(headers).ok)
      .optional(),
    idempotencyKey: z.string().refine(isValidEmailIdempotencyKey).optional(),
  })
  .refine(isWithinEmailSendBodyLimit);

export const EMAIL_SEND_MESSAGE: MessageContract<'email.send', EmailSendBody> =
  defineMessageContract('email.send', emailSendBodySchema);
