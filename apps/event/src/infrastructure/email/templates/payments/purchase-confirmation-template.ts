import { PAYMENTS_PURCHASE_CONFIRMATION_KIND } from '../../../../../lib/core/email/kinds/payments.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { PurchaseConfirmationEmailBody } from './purchase-confirmation-email-body.tsx';

export const PURCHASE_CONFIRMATION_TEMPLATE = defineEmailTemplate({
  kind: PAYMENTS_PURCHASE_CONFIRMATION_KIND,
  subject: () => '購入が完了しました',
  preview: () =>
    'ご購入ありがとうございます。購入の内容と、同意いただいた条件をお知らせします。',
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: '決済履歴を見る',
    url: input.paymentHistoryUrl,
  }),
  Body: PurchaseConfirmationEmailBody,
});
