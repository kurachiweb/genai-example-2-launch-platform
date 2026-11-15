import { IDENTITY_PASSWORD_RESET_KIND } from '../../../../../lib/core/email/kinds/identity.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { PasswordResetEmailBody } from './password-reset-email-body.tsx';

export const PASSWORD_RESET_TEMPLATE = defineEmailTemplate({
  kind: IDENTITY_PASSWORD_RESET_KIND,
  subject: () => 'パスワードを再設定してください',
  preview: () => 'パスワードを再設定するためのリンクをお送りします。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'パスワードを再設定する', url: input.resetUrl }),
  Body: PasswordResetEmailBody,
});
