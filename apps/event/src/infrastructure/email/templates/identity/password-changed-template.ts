import { IDENTITY_PASSWORD_CHANGED_KIND } from '../../../../../lib/core/email/kinds/identity.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { PasswordChangedEmailBody } from './password-changed-email-body.tsx';

export const PASSWORD_CHANGED_TEMPLATE = defineEmailTemplate({
  kind: IDENTITY_PASSWORD_CHANGED_KIND,
  subject: () => 'パスワードが変更されました',
  preview: () => 'アカウントのパスワードが変更されました。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'お問い合わせ', url: input.contactUrl }),
  Body: PasswordChangedEmailBody,
});
