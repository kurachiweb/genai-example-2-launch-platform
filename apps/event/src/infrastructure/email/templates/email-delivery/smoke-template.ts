import { EMAIL_DELIVERY_SMOKE_KIND } from '../../../../../lib/core/email/kinds/email-delivery-smoke.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { SmokeEmailBody } from './smoke-email-body.tsx';

export const SMOKE_TEMPLATE = defineEmailTemplate({
  kind: EMAIL_DELIVERY_SMOKE_KIND,
  subject: () => 'メール送信の確認',
  preview: () => 'メール送信の確認のために送信したメールです。',
  greeting: () => undefined,
  Body: SmokeEmailBody,
});
