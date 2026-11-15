import type { FollowedUserAwardEmailInput } from '../../../../../lib/core/email/kinds/notifications.ts';
import { awardName } from '../../../../../lib/core/notifications/notice-copy.ts';

export function awardSentence(input: FollowedUserAwardEmailInput): string {
  return `${input.makerNickname}さんの${input.productName}が${input.periodLabel}の${awardName(input.award)}を受賞しました。`;
}
