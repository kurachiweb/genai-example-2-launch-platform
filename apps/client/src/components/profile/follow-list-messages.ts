import type { FollowListDirection } from '../../graphql/follow-list.ts';
import { FOLLOWER_LABEL, FOLLOWING_LABEL } from './profile-messages.ts';

export const FOLLOW_LIST_PAGE_TITLE = 'フォロー';

export const FOLLOW_LIST_TABS_LABEL = 'フォロー一覧';

export const FOLLOW_LIST_TAB_LABELS: Readonly<
  Record<FollowListDirection, string>
> = Object.freeze({
  following: FOLLOWING_LABEL,
  followers: FOLLOWER_LABEL,
});

export const FOLLOW_LIST_EMPTY_MESSAGES: Readonly<
  Record<FollowListDirection, string>
> = Object.freeze({
  following: 'まだフォローしているユーザーはいません。',
  followers: 'まだフォロワーはいません。',
});

export const FOLLOW_LIST_ERROR_MESSAGE =
  'フォロー一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

export const FOLLOW_LIST_LOAD_MORE_ERROR_MESSAGE =
  '続きを読み込めませんでした。';

export const FOLLOW_LIST_LOAD_MORE_LABEL = 'さらに読み込む';

export const FOLLOW_LIST_LOAD_MORE_PENDING_LABEL = '読み込み中';

export const FOLLOW_LIST_FOLLOWED_AT_LABELS: Readonly<
  Record<FollowListDirection, string>
> = Object.freeze({
  following: 'フォローした日時',
  followers: 'フォローされた日時',
});
