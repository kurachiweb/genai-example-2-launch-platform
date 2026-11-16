import type { ClientViewer } from '../../graphql/viewer.ts';

export type EngagementViewerKind = 'guest' | 'unverified' | 'owner' | 'member';

// 未確認の投稿者本人は書き込めないためunverifiedにする。評価欄は本人の文言を優先するため、isOwnerを別に見る
export function engagementViewerKind(
  viewer: ClientViewer | null,
  isOwner: boolean,
): EngagementViewerKind {
  if (viewer === null) {
    return 'guest';
  }
  if (!viewer.emailVerified) {
    return 'unverified';
  }
  return isOwner ? 'owner' : 'member';
}
