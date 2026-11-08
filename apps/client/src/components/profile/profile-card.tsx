import { PencilIcon } from 'lucide-react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  PUBLIC_PROFILE_BADGES,
  PUBLIC_PROFILE_MENU_ITEMS,
} from '../../composition/public-profile-sections.ts';
import { ExternalWebsiteList } from './external-website-list.tsx';
import { FollowButton } from './follow-button.tsx';
import type { FollowState } from './follow-button-types.ts';
import { FollowerCount } from './follower-count.tsx';
import { ProfileActionsMenu } from './profile-actions-menu.tsx';
import { ProfileAvatar } from './profile-avatar.tsx';
import { ProfileBio } from './profile-bio.tsx';
import { ProfileCompletion } from './profile-completion.tsx';
import { PROFILE_EDIT_LABEL } from './profile-messages.ts';
import { PROFILE_EDIT_HREF } from './profile-paths.ts';
import { orderPublicProfileSections } from './public-profile-section-order.ts';
import { publicProfileSectionContextOf } from './public-profile-section-context.ts';
import type {
  PublicProfileBadgeSection,
  PublicProfileMenuItem,
} from './public-profile-section-types.ts';
import type { PublicProfileView } from './public-profile-view.ts';

export interface ProfileCardProps {
  readonly profile: PublicProfileView;
  readonly badges?: readonly PublicProfileBadgeSection[];
  readonly menuItems?: readonly PublicProfileMenuItem[];
  // フォロー・フォロー解除の結果。呼び出し側がフォロワー数と関係を更新する
  readonly onFollowChange?: (state: FollowState) => void;
}

const HEADING_ID = 'profile-name';

const isBlank = (value: string | null): boolean =>
  value === null || value.trim() === '';

// 必須項目のニックネームとハンドルだけの本人に、任意項目の入力を促す条件
const isUnfilled = (profile: PublicProfileView): boolean =>
  profile.avatar === null &&
  isBlank(profile.headline) &&
  isBlank(profile.bio) &&
  profile.websites.length === 0;

export function ProfileCard({
  profile,
  badges = PUBLIC_PROFILE_BADGES,
  menuItems = PUBLIC_PROFILE_MENU_ITEMS,
  onFollowChange,
}: ProfileCardProps) {
  const context = publicProfileSectionContextOf(profile);
  const { isOwner } = context;
  const canEdit = isOwner && !profile.suspended;
  const { headline, bio } = profile;

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-4">
        <ProfileAvatar user={profile} ultras={profile.ultras} />
        <div className="min-w-0 flex-1 pt-1">
          <h1
            id={HEADING_ID}
            className="text-2xl leading-tight font-extrabold tracking-tight text-balance wrap-anywhere"
          >
            {profile.nickname}
          </h1>
          <p className="mt-1 text-sm wrap-anywhere text-muted-foreground">
            @{profile.handle}
          </p>
        </div>
      </div>

      {!isBlank(headline) && (
        <p
          data-slot="profile-headline"
          className="mt-4 font-semibold text-pretty wrap-anywhere"
        >
          {headline}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <FollowerCount count={profile.followerCount} linked={isOwner} />
        {badges.length > 0 && (
          <div
            data-slot="profile-badges"
            className="flex flex-wrap gap-1.5 empty:hidden"
          >
            {orderPublicProfileSections(badges).map(({ id, Section }) => (
              <Section key={id} {...context} />
            ))}
          </div>
        )}
      </div>

      {isOwner ? (
        canEdit && (
          <div className="mt-4">
            <Button variant="outline" size="sm" className="w-full" asChild>
              <PathLink href={PROFILE_EDIT_HREF}>
                <PencilIcon aria-hidden="true" />
                {PROFILE_EDIT_LABEL}
              </PathLink>
            </Button>
          </div>
        )
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <FollowButton
            target={profile}
            initialFollowing={profile.viewerRelation === 'FOLLOWING'}
            onChange={onFollowChange}
            className="flex-1"
          />
          <ProfileActionsMenu context={context} items={menuItems} />
        </div>
      )}

      {canEdit && isUnfilled(profile) && <ProfileCompletion />}

      {bio !== null && !isBlank(bio) && (
        <div
          data-slot="profile-bio"
          className="mt-5 border-t border-border pt-5"
        >
          <ProfileBio markdown={bio} />
        </div>
      )}

      <ExternalWebsiteList websites={profile.websites} />
    </section>
  );
}
