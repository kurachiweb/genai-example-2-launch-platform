import { z } from 'zod';

import { isMinorUnitAmount } from '../../../../common-lib/payments/money.ts';
import { REJECTION_REASONS } from '../../../../common-lib/payments/purchase-states.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const text = z.string().min(1);

const utcDateTime = z.iso.datetime();

const amount = z.number().int().positive().refine(isMinorUnitAmount, {
  message: '金額は最小通貨単位の範囲内の整数で指定してください',
});

const purchaseConfirmationInput = z.object({
  nickname: text,
  itemName: text,
  quantityLabel: text,
  amount,
  purchasedAt: utcDateTime,
  serviceTiming: text,
  additionalNotes: z.array(text),
  consentedAt: utcDateTime,
  consentText: text,
  paymentHistoryUrl: linkUrl,
});

const automaticRefundInput = z.object({
  nickname: text,
  itemName: text,
  quantityLabel: text,
  amount,
  reason: z.enum(REJECTION_REASONS),
  purchasedAt: utcDateTime,
  refundedAt: utcDateTime,
  paymentHistoryUrl: linkUrl,
});

export type PurchaseConfirmationInput = z.infer<
  typeof purchaseConfirmationInput
>;

export type AutomaticRefundInput = z.infer<typeof automaticRefundInput>;

export const PAYMENTS_PURCHASE_CONFIRMATION_KIND = defineEmailKind({
  name: 'payments.purchase-confirmation',
  category: 'transactional',
  inputSchema: purchaseConfirmationInput,
});

export const PAYMENTS_AUTOMATIC_REFUND_KIND = defineEmailKind({
  name: 'payments.automatic-refund',
  category: 'transactional',
  inputSchema: automaticRefundInput,
});

export const PAYMENTS_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  PAYMENTS_PURCHASE_CONFIRMATION_KIND,
  PAYMENTS_AUTOMATIC_REFUND_KIND,
]);
