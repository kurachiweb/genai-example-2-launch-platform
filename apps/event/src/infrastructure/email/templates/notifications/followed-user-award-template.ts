import { NOTIFICATION_FOLLOWED_USER_AWARD_KIND } from '../../../../../lib/core/email/kinds/notifications.ts';
import { awardSubject } from '../../../../../lib/core/notifications/notice-copy.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { awardSentence } from './followed-user-award-copy.ts';
import { FollowedUserAwardEmailBody } from './followed-user-award-email-body.tsx';

export const FOLLOWED_USER_AWARD_TEMPLATE = defineEmailTemplate({
  kind: NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
  subject: (input) => awardSubject(input.productName, input.award),
  preview: awardSentence,
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'プロダクトを見る', url: input.productUrl }),
  unsubscribeLinks: (input) => [{ url: input.unsubscribeUrl }],
  Body: FollowedUserAwardEmailBody,
});
