import { z } from 'zod';

import {
  defineMessageContract,
  type MessageContract,
} from '../messaging/message-contract.ts';
import { UPPERCASE_ULID_PATTERN } from '../ids/uppercase-ulid.ts';

export interface RefundPaymentBody {
  readonly refundRequestId: string;
}

// 金額や決済の識別子は受信側が返金の依頼の行から読み直すため、本文には依頼のIDだけを持たせる
const refundPaymentBodySchema = z.object({
  refundRequestId: z.ulid().regex(UPPERCASE_ULID_PATTERN),
});

export const PAYMENTS_REFUND_MESSAGE: MessageContract<
  'payments.refund-payment',
  RefundPaymentBody
> = defineMessageContract('payments.refund-payment', refundPaymentBodySchema);
