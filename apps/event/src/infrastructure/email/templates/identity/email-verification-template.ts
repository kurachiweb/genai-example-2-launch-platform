import { IDENTITY_EMAIL_VERIFICATION_KIND } from '../../../../../lib/core/email/kinds/identity.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { EmailVerificationEmailBody } from './email-verification-email-body.tsx';

export const EMAIL_VERIFICATION_TEMPLATE = defineEmailTemplate({
  kind: IDENTITY_EMAIL_VERIFICATION_KIND,
  subject: () => 'あともう少し！メールアドレスを確認してください',
  preview: () => 'メールアドレスを確認して、登録を完了してください。',
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: 'メールアドレスを確認する',
    url: input.verifyUrl,
  }),
  Body: EmailVerificationEmailBody,
});
