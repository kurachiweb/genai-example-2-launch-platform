import { ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND } from '../../../../../lib/core/email/kinds/admin.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { AdminEmailChangeConfirmationEmailBody } from './admin-email-change-confirmation-email-body.tsx';

export const ADMIN_EMAIL_CHANGE_CONFIRMATION_TEMPLATE = defineEmailTemplate({
  kind: ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
  subject: () => '管理者アカウントの新しいメールアドレスを確認してください',
  preview: () => '新しいメールアドレスを確認して、変更を確定してください。',
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: 'メールアドレスの変更を確定する',
    url: input.confirmUrl,
  }),
  Body: AdminEmailChangeConfirmationEmailBody,
});
