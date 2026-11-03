import { ADMIN_INVITATION_KIND } from '../../../../../lib/core/email/kinds/admin.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { AdminInvitationEmailBody } from './admin-invitation-email-body.tsx';

export const ADMIN_INVITATION_TEMPLATE = defineEmailTemplate({
  kind: ADMIN_INVITATION_KIND,
  subject: () => '管理者アカウントの設定を完了してください',
  preview: () => '管理者アカウントの招待のリンクをお送りします。',
  // 招待の時点ではニックネームが決まっていないため宛名を省く
  greeting: () => undefined,
  action: (input) => ({
    label: '招待を受けて設定する',
    url: input.invitationUrl,
  }),
  Body: AdminInvitationEmailBody,
});
