import { NOTIFICATION_MATCH_PREVIEW_KIND } from '../../../../../lib/core/email/kinds/notifications.ts';
import { matchPreviewSubject } from '../../../../../lib/core/notifications/notice-copy.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { MatchPreviewEmailBody } from './match-preview-email-body.tsx';

export const MATCH_PREVIEW_TEMPLATE = defineEmailTemplate({
  kind: NOTIFICATION_MATCH_PREVIEW_KIND,
  subject: (input) =>
    matchPreviewSubject(input.ownProductName, input.opponentProductName),
  preview: (input) =>
    `${input.ownProductName}の次のマッチの対戦相手と開始時刻をお知らせします。`,
  greeting: (input) => input.nickname,
  action: (input) => ({ label: 'トップページを見る', url: input.topPageUrl }),
  unsubscribeLinks: (input) => [{ url: input.unsubscribeUrl }],
  Body: MatchPreviewEmailBody,
});
