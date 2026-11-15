import { ADMIN_EMAIL_CHANGED_KIND } from '../../../../../lib/core/email/kinds/admin.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { AdminEmailChangedEmailBody } from './admin-email-changed-email-body.tsx';

export const ADMIN_EMAIL_CHANGED_TEMPLATE = defineEmailTemplate({
  kind: ADMIN_EMAIL_CHANGED_KIND,
  subject: () => '管理者アカウントのメールアドレスが変更されました',
  preview: () => '管理者アカウントのメールアドレスが変更されました。',
  greeting: (input) => input.nickname,
  Body: AdminEmailChangedEmailBody,
});
