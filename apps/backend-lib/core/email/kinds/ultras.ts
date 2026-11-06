import { z } from 'zod';

import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const text = z.string().min(1);

const utcDateTime = z.iso.datetime();

const paymentFailedInput = z.object({
  nickname: text,
  planUrl: linkUrl,
});

const cancellationAcceptedInput = z.object({
  nickname: text,
  acceptedAt: utcDateTime,
  benefitEndsAt: utcDateTime,
  planUrl: linkUrl,
});

export type PaymentFailedInput = z.infer<typeof paymentFailedInput>;

export type CancellationAcceptedInput = z.infer<
  typeof cancellationAcceptedInput
>;

export const ULTRAS_PAYMENT_FAILED_KIND = defineEmailKind({
  name: 'ultras.payment-failed',
  category: 'transactional',
  inputSchema: paymentFailedInput,
});

export const ULTRAS_CANCELLATION_ACCEPTED_KIND = defineEmailKind({
  name: 'ultras.cancellation-accepted',
  category: 'transactional',
  inputSchema: cancellationAcceptedInput,
});

export const ULTRAS_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  ULTRAS_PAYMENT_FAILED_KIND,
  ULTRAS_CANCELLATION_ACCEPTED_KIND,
]);
