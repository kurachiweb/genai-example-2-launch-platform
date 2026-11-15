import { useViewer } from '../auth/use-viewer.ts';
import { ProfileTabLoadBoundary } from '../profile/profile-tab-load-boundary.tsx';
import type { PublicProfileSectionContext } from '../profile/public-profile-section-types.ts';
import { UpvoteHistoryList } from './upvote-history-list.tsx';
import { UPVOTE_HISTORY_LOAD_ERROR } from './upvote-history-messages.ts';

// 停止中の本人はUpvoteできないため、0件の時にトップページへの導線を添えない
export function UpvoteHistoryPanel({
  handle,
  isOwner,
  suspended,
}: PublicProfileSectionContext) {
  const viewer = useViewer();
  return (
    <ProfileTabLoadBoundary message={UPVOTE_HISTORY_LOAD_ERROR}>
      <UpvoteHistoryList
        viewer={viewer}
        handle={handle}
        guided={isOwner && !suspended}
      />
    </ProfileTabLoadBoundary>
  );
}
