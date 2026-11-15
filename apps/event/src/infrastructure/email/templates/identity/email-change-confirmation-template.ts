import { IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND } from '../../../../../lib/core/email/kinds/identity.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { EmailChangeConfirmationEmailBody } from './email-change-confirmation-email-body.tsx';

export const EMAIL_CHANGE_CONFIRMATION_TEMPLATE = defineEmailTemplate({
  kind: IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
  subject: () => '新しいメールアドレスを確認してください',
  preview: () => '新しいメールアドレスを確認して、変更を確定してください。',
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: 'メールアドレスの変更を確定する',
    url: input.confirmUrl,
  }),
  Body: EmailChangeConfirmationEmailBody,
});
