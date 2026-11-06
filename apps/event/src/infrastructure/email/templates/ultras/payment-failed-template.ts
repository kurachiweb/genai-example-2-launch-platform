import { ULTRAS_PAYMENT_FAILED_KIND } from '../../../../../lib/core/email/kinds/ultras.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { PaymentFailedEmailBody } from './payment-failed-email-body.tsx';

export const PAYMENT_FAILED_TEMPLATE = defineEmailTemplate({
  kind: ULTRAS_PAYMENT_FAILED_KIND,
  subject: () => 'Ultrasの支払いに失敗しました',
  preview: () =>
    'Ultrasの毎月のお支払いに失敗しました。特典を続けるには、支払い方法を更新してください。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'プランを見る', url: input.planUrl }),
  Body: PaymentFailedEmailBody,
});
