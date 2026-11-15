import { IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND } from '../../../../../lib/core/email/kinds/identity.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { PasswordChangeConfirmationEmailBody } from './password-change-confirmation-email-body.tsx';

export const PASSWORD_CHANGE_CONFIRMATION_TEMPLATE = defineEmailTemplate({
  kind: IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
  subject: () => 'パスワードの変更を確認してください',
  preview: () => 'パスワードの変更を確定するためのリンクをお送りします。',
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: 'パスワードの変更を確定する',
    url: input.confirmUrl,
  }),
  Body: PasswordChangeConfirmationEmailBody,
});
