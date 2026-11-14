import type { FollowedUserMatchesEmailInput } from '../../../../../lib/core/email/kinds/notifications.ts';
import { formatCount } from '../../../../../lib/core/notifications/notice-copy.ts';

type FollowedMatchItem = FollowedUserMatchesEmailInput['items'][number];

export const FOLLOWED_MATCHES_LEAD_SENTENCE =
  'フォローしているユーザーのプロダクトのマッチが始まりました。';

export function followedMatchItemLine(item: FollowedMatchItem): string {
  return `${item.productName}(${item.makerNickname}さん)— ${item.matchLabel} vs ${item.opponentProductName}`;
}

export function omittedItemsLine(omittedCount: number): string {
  return `ほか${formatCount(omittedCount)}件`;
}
