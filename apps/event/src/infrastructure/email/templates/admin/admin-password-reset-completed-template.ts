import { ADMIN_PASSWORD_RESET_COMPLETED_KIND } from '../../../../../lib/core/email/kinds/admin.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { AdminPasswordResetCompletedEmailBody } from './admin-password-reset-completed-email-body.tsx';

export const ADMIN_PASSWORD_RESET_COMPLETED_TEMPLATE = defineEmailTemplate({
  kind: ADMIN_PASSWORD_RESET_COMPLETED_KIND,
  subject: () => '管理者アカウントのパスワードが再設定されました',
  preview: () => '管理者アカウントのパスワードが再設定されました。',
  greeting: (input) => input.nickname,
  Body: AdminPasswordResetCompletedEmailBody,
});
