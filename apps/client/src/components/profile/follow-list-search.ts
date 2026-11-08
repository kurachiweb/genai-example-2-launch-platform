import { z } from '../../../lib/utilities/validation/zod.ts';
import type { FollowListDirection } from '../../graphql/follow-list.ts';

const FOLLOWERS_TAB = 'followers';

export interface FollowListSearch {
  readonly tab?: typeof FOLLOWERS_TAB | undefined;
}

const SEARCH_SCHEMA = z.object({
  tab: z.literal(FOLLOWERS_TAB).optional().catch(undefined),
});

// 共有されたURLや手で書き換えたURLの不正な値と既定のタブを明示した値は欠落と同じに扱う。ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に項目を返す
export const toFollowListSearch = (
  search: Record<string, unknown>,
): FollowListSearch => ({ tab: SEARCH_SCHEMA.parse(search).tab });

export const followListDirectionOf = (
  tab: FollowListSearch['tab'],
): FollowListDirection => (tab === FOLLOWERS_TAB ? 'followers' : 'following');

// 既定のフォロー中はクエリから省く
export const followListTabQueryValue = (
  direction: FollowListDirection,
): FollowListSearch['tab'] =>
  direction === 'followers' ? FOLLOWERS_TAB : undefined;
