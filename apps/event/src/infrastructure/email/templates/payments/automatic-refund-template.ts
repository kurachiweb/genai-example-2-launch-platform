import { PAYMENTS_AUTOMATIC_REFUND_KIND } from '../../../../../lib/core/email/kinds/payments.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { AutomaticRefundEmailBody } from './automatic-refund-email-body.tsx';

export const AUTOMATIC_REFUND_TEMPLATE = defineEmailTemplate({
  kind: PAYMENTS_AUTOMATIC_REFUND_KIND,
  subject: () => 'お支払いを返金しました',
  preview: () =>
    '購入を確定できなかったため、お支払いいただいた金額の全額を返金しました。',
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: '決済履歴を見る',
    url: input.paymentHistoryUrl,
  }),
  Body: AutomaticRefundEmailBody,
});
