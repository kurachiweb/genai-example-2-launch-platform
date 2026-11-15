import { NOTIFICATION_FOLLOWED_USER_MATCHES_KIND } from '../../../../../lib/core/email/kinds/notifications.ts';
import { followedMatchesSubject } from '../../../../../lib/core/notifications/notice-copy.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { FOLLOWED_MATCHES_LEAD_SENTENCE } from './followed-user-matches-copy.ts';
import { FollowedUserMatchesEmailBody } from './followed-user-matches-email-body.tsx';

export const FOLLOWED_USER_MATCHES_TEMPLATE = defineEmailTemplate({
  kind: NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
  // 件名の件数は本文に載せなかった項目も含めた、その日の対象の全件数
  subject: (input) =>
    followedMatchesSubject(
      input.items.map((item) => item.productName),
      input.items.length + input.omittedCount,
    ),
  preview: () => FOLLOWED_MATCHES_LEAD_SENTENCE,
  greeting: (input) => input.nickname,
  action: (input) => ({
    label: 'トップページで応援する',
    url: input.topPageUrl,
  }),
  unsubscribeLinks: (input) => [{ url: input.unsubscribeUrl }],
  Body: FollowedUserMatchesEmailBody,
});
