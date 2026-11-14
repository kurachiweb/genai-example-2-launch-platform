import { IDENTITY_PASSWORD_RESET_COMPLETED_KIND } from '../../../../../lib/core/email/kinds/identity.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { PasswordResetCompletedEmailBody } from './password-reset-completed-email-body.tsx';

export const PASSWORD_RESET_COMPLETED_TEMPLATE = defineEmailTemplate({
  kind: IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
  subject: () => 'パスワードが再設定されました',
  preview: () => 'アカウントのパスワードが再設定されました。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'お問い合わせ', url: input.contactUrl }),
  Body: PasswordResetCompletedEmailBody,
});
