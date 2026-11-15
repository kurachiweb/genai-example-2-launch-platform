import { PUBLIC_PROFILE_TABS } from '../../composition/public-profile-sections.ts';
import type { FollowState } from './follow-button-types.ts';
import { ProfileCard } from './profile-card.tsx';
import { ProfileTabs } from './profile-tabs.tsx';
import { publicProfileSectionContextOf } from './public-profile-section-context.ts';
import type {
  PublicProfileBadgeSection,
  PublicProfileMenuItem,
  PublicProfileTab,
} from './public-profile-section-types.ts';
import type { PublicProfileView } from './public-profile-view.ts';
import { SuspendedProfileBanner } from './suspended-profile-banner.tsx';

export interface PublicProfilePageProps {
  readonly profile: PublicProfileView;
  // URLのクエリ`tab`の値
  readonly tab: string | undefined;
  readonly onTabChange: (tab: string | undefined) => void;
  readonly onFollowChange?: (state: FollowState) => void;
  readonly tabs?: readonly PublicProfileTab[];
  readonly badges?: readonly PublicProfileBadgeSection[];
  readonly menuItems?: readonly PublicProfileMenuItem[];
}

// PC(1024px以上)は左に人物情報、右にタブの2カラム。それ未満は人物情報の下にタブを置く。タブが1つも無ければ人物情報だけを表示する
export function PublicProfilePage({
  profile,
  tab,
  onTabChange,
  onFollowChange,
  tabs = PUBLIC_PROFILE_TABS,
  badges,
  menuItems,
}: PublicProfilePageProps) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-12 sm:pt-8">
      {profile.suspended && <SuspendedProfileBanner />}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[22rem_minmax(0,1fr)]">
        <ProfileCard
          profile={profile}
          badges={badges}
          menuItems={menuItems}
          onFollowChange={onFollowChange}
        />
        {tabs.length > 0 && (
          <ProfileTabs
            tabs={tabs}
            context={publicProfileSectionContextOf(profile)}
            tab={tab}
            onTabChange={onTabChange}
          />
        )}
      </div>
    </div>
  );
}
