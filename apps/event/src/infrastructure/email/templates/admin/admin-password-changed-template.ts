import { ADMIN_PASSWORD_CHANGED_KIND } from '../../../../../lib/core/email/kinds/admin.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { AdminPasswordChangedEmailBody } from './admin-password-changed-email-body.tsx';

export const ADMIN_PASSWORD_CHANGED_TEMPLATE = defineEmailTemplate({
  kind: ADMIN_PASSWORD_CHANGED_KIND,
  subject: () => '管理者アカウントのパスワードが変更されました',
  preview: () => '管理者アカウントのパスワードが変更されました。',
  greeting: (input) => input.nickname,
  Body: AdminPasswordChangedEmailBody,
});
