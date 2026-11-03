import { ADMIN_PASSWORD_RESET_KIND } from '../../../../../lib/core/email/kinds/admin.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { AdminPasswordResetEmailBody } from './admin-password-reset-email-body.tsx';

export const ADMIN_PASSWORD_RESET_TEMPLATE = defineEmailTemplate({
  kind: ADMIN_PASSWORD_RESET_KIND,
  subject: () => '管理者アカウントのパスワードを再設定してください',
  preview: () => 'パスワードを再設定するためのリンクをお送りします。',
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'パスワードを再設定する', url: input.resetUrl }),
  Body: AdminPasswordResetEmailBody,
});
