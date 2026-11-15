import { IDENTITY_EMAIL_CHANGED_KIND } from '../../../../../lib/core/email/kinds/identity.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { EmailChangedEmailBody } from './email-changed-email-body.tsx';

export const EMAIL_CHANGED_TEMPLATE = defineEmailTemplate({
  kind: IDENTITY_EMAIL_CHANGED_KIND,
  subject: () => 'メールアドレスが変更されました',
  preview: () => 'アカウントのメールアドレスが変更されました。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'お問い合わせ', url: input.contactUrl }),
  Body: EmailChangedEmailBody,
});
