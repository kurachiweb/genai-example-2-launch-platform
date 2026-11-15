import { INQUIRY_REPLY_NOTIFICATION_KIND } from '../../../../../lib/core/email/kinds/inquiry.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { InquiryReplyBody } from './inquiry-reply-body.tsx';

export const INQUIRY_REPLY_TEMPLATE = defineEmailTemplate({
  kind: INQUIRY_REPLY_NOTIFICATION_KIND,
  subject: () => 'お問い合わせに返信がありました',
  preview: () =>
    'お問い合わせへの返信がありました。チャットページで内容を確認してください。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: '問い合わせを確認する', url: input.inquiryUrl }),
  Body: InquiryReplyBody,
});
