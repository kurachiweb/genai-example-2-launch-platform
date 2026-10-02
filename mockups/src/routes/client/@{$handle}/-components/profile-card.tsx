import { useState } from 'react';
import { PencilIcon } from 'lucide-react';

import { AwardBadges } from '#/components/client/award-badges';
import { CollapsibleMarkdown } from '#/components/client/collapsible-markdown';
import { FollowButton } from '#/components/client/follow-button';
import { Button } from '#/components/ui/button';

import type { ProfileModel } from '../-model/page-model';
import { ExternalLinks } from './external-links';
import { FollowerCount } from './follower-count';
import { ProfileAvatar } from './profile-avatar';
import { ProfileCompletion } from './profile-completion';
import { UserActionsMenu } from './user-actions-menu';

type Props = {
  model: ProfileModel;
  onRequireLogin: () => void;
  onReport: () => void;
};

// サイドバーが長くなりすぎないよう、自己紹介はこれを超える高さで折りたたむ
const BIO_COLLAPSED_HEIGHT_PX = 240;
// 自己紹介のリンクはFR-UPROF-009によりugcを付ける
const BIO_LINK_REL = 'noopener ugc';

export function ProfileCard({ model, onRequireLogin, onReport }: Props) {
  const { user, role, suspended } = model;
  const isOwner = role === 'owner';
  // フォロー・フォロー解除した分をその場でフォロワー数に反映する
  const [followDelta, setFollowDelta] = useState(0);
  const incomplete = !model.headline && !model.bio && model.links.length === 0;

  return (
    <section
      aria-labelledby="profile-name"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-4">
        <ProfileAvatar
          user={user}
          broken={model.ownImagesBroken}
          ultras={model.ultras}
        />
        <div className="min-w-0 flex-1 pt-1">
          <h1
            id="profile-name"
            className="text-2xl leading-tight font-extrabold tracking-tight text-balance wrap-anywhere"
          >
            {user.nickname}
          </h1>
          <p className="mt-1 text-sm wrap-anywhere text-muted-foreground">
            @{user.handle}
          </p>
        </div>
      </div>

      {model.headline && (
        <p className="mt-4 font-semibold text-pretty wrap-anywhere">
          {model.headline}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <FollowerCount count={model.followers + followDelta} linked={isOwner} />
        {model.awards.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <AwardBadges awards={model.awards} />
          </div>
        )}
      </div>

      {!(isOwner && suspended) && (
        <div className="mt-4 flex items-center gap-2">
          {isOwner ? (
            <Button variant="outline" size="sm" className="flex-1" asChild>
              <a href="#">
                <PencilIcon aria-hidden="true" />
                プロフィールを編集
              </a>
            </Button>
          ) : (
            <>
              <FollowButton
                target={user}
                viewer={role}
                onRequireLogin={onRequireLogin}
                onFollowingChange={(following) =>
                  setFollowDelta(following ? 1 : 0)
                }
                className="flex-1"
              />
              <UserActionsMenu onReport={onReport} />
            </>
          )}
        </div>
      )}

      {isOwner && !suspended && incomplete && <ProfileCompletion />}

      {model.bio && (
        <div className="mt-5 border-t border-border pt-5">
          <h2 className="sr-only">自己紹介</h2>
          <CollapsibleMarkdown
            markdown={model.bio}
            collapsedHeight={BIO_COLLAPSED_HEIGHT_PX}
            externalRel={BIO_LINK_REL}
            size="sm"
            fadeClassName="from-card"
          />
        </div>
      )}

      {model.links.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <ExternalLinks links={model.links} />
        </div>
      )}
    </section>
  );
}
