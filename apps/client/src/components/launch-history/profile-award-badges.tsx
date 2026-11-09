import { useQuery } from '@tanstack/react-query';

import {
  profileAwardsQueryOptions,
  toProfileAwardViews,
} from '../../graphql/launch-history.ts';
import { useViewer } from '../auth/use-viewer.ts';
import type { PublicProfileSectionContext } from '../profile/public-profile-section-types.ts';
import { AwardBadgeList } from './award-badge-list.tsx';

// 受賞バッジの区画はエラーの境界とSuspenseの外で描かれるため、失敗を境界へ投げずに区画の中で捨てる。読み込み中と失敗の間も何も描かず、人物情報の表示をずらしたり止めたりしない
export function ProfileAwardBadges({ handle }: PublicProfileSectionContext) {
  const viewer = useViewer();
  const { data: awards } = useQuery({
    ...profileAwardsQueryOptions(viewer, handle),
    select: toProfileAwardViews,
  });
  return awards === undefined ? null : <AwardBadgeList awards={awards} />;
}
