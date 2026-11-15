import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { ProfileListItemSkeletons } from './profile-list-item-skeletons.tsx';

export function ProfileTabPanelSkeleton() {
  return (
    <LoadingSkeleton>
      <ProfileListItemSkeletons />
    </LoadingSkeleton>
  );
}
