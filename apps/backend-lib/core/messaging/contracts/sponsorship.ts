import { z } from 'zod';

import {
  defineMessageContract,
  type MessageContract,
} from '../message-contract.ts';

export interface SponsorshipRequestBody {
  readonly requestedAt: string;
}

// 送る通知と精算する広告は受信側が行の状態から決めるため、本文には申込の識別子や利用者の情報を入れず、依頼の時刻だけを持たせる
const sponsorshipRequestBodySchema = z.object({
  requestedAt: z.iso.datetime(),
});

export const SPONSORSHIP_DISPATCH_NOTICES_MESSAGE: MessageContract<
  'sponsorship.dispatch-notices',
  SponsorshipRequestBody
> = defineMessageContract(
  'sponsorship.dispatch-notices',
  sponsorshipRequestBodySchema,
);

export const SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE: MessageContract<
  'sponsorship.settle-period-end',
  SponsorshipRequestBody
> = defineMessageContract(
  'sponsorship.settle-period-end',
  sponsorshipRequestBodySchema,
);
