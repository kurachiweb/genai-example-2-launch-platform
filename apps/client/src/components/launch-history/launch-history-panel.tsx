import { useViewer } from '../auth/use-viewer.ts';
import { ProfileTabLoadBoundary } from '../profile/profile-tab-load-boundary.tsx';
import type { PublicProfileSectionContext } from '../profile/public-profile-section-types.ts';
import { LaunchHistoryList } from './launch-history-list.tsx';
import { LAUNCH_HISTORY_LOAD_ERROR } from './launch-history-messages.ts';

export function LaunchHistoryPanel({ handle }: PublicProfileSectionContext) {
  const viewer = useViewer();
  return (
    <ProfileTabLoadBoundary message={LAUNCH_HISTORY_LOAD_ERROR}>
      <LaunchHistoryList viewer={viewer} handle={handle} />
    </ProfileTabLoadBoundary>
  );
}
