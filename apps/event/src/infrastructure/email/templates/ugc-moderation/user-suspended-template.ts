import { MODERATION_USER_SUSPENDED_EMAIL } from '../../../../../lib/core/email/kinds/ugc-moderation.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import {
  CONTACT_ACTION_LABEL,
  USER_SUSPENDED_LEAD,
} from './moderation-notice-copy.ts';
import { UserSuspendedEmailBody } from './user-suspended-email-body.tsx';

export const MODERATION_USER_SUSPENDED_TEMPLATE = defineEmailTemplate({
  kind: MODERATION_USER_SUSPENDED_EMAIL,
  subject: () => 'アカウントが停止されました',
  preview: () => USER_SUSPENDED_LEAD,
  greeting: (input) => input.nickname,
  action: (input) => ({ label: CONTACT_ACTION_LABEL, url: input.contactUrl }),
  Body: UserSuspendedEmailBody,
});
