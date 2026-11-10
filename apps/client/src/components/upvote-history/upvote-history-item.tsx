import { ArrowRightIcon } from 'lucide-react';
import { useId } from 'react';

import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type { UpvoteHistoryItemView } from '../../graphql/upvote-history.ts';
import {
  HOME_HREF,
  productDetailHref,
  profileHref,
} from '../layout/site-links.ts';
import { MatchStageBadge } from '../match/match-stage-badge.tsx';
import { productLogoAlt } from '../product/my-product-messages.ts';
import { WATCH_ON_TOP_LABEL } from '../product/launch-messages.ts';
import { UserAvatar } from '../profile/user-avatar.tsx';
import {
  LIVE_MATCH_BADGE,
  OWNER_LINK_PREFIX,
  UNLISTED_BADGE,
} from './upvote-history-messages.ts';

export interface UpvoteHistoryItemProps {
  readonly item: UpvoteHistoryItemView;
}

function OwnerLink({
  owner,
}: {
  readonly owner: NonNullable<UpvoteHistoryItemView['owner']>;
}) {
  return (
    <PathLink
      href={profileHref(owner.handle)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-muted-foreground no-underline hover:text-foreground hover:underline"
    >
      <span className="sr-only">{OWNER_LINK_PREFIX}</span>
      {/* リンクの名前にニックネームが重ねて入らないよう、プロフィール画像は支援技術から隠す */}
      <span aria-hidden="true" className="shrink-0">
        <UserAvatar user={owner} size={32} className="size-5" />
      </span>
      <span className="min-w-0 wrap-anywhere">{owner.nickname}</span>
    </PathLink>
  );
}

// Upvoteしたプロダクトのロゴ・名称・投稿者とマッチの種別を示す。生活時間帯を推測させないため時刻を示さず、勝敗とスコアも示さない。取り消しの操作はマッチカードに一本化し、ここには置かない
export function UpvoteHistoryItem({ item }: UpvoteHistoryItemProps) {
  const nameId = useId();
  const { product, owner } = item;
  return (
    <article
      aria-labelledby={nameId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5 text-card-foreground shadow-xs sm:flex-nowrap sm:px-4"
    >
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <MediaPicture
          image={product.logo}
          display={{ kind: 'square', size: 64 }}
          alt={productLogoAlt(product.name)}
          placeholder={{ label: product.name, seed: product.handle }}
          loading="lazy"
          className="size-10 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span id={nameId} className="min-w-0 font-bold wrap-anywhere">
              {product.listed ? (
                <PathLink
                  href={productDetailHref(product.handle)}
                  className="rounded-sm text-foreground no-underline hover:underline"
                >
                  {product.name}
                </PathLink>
              ) : (
                product.name
              )}
            </span>
            {!product.listed && (
              <Badge variant="outline" className="text-muted-foreground">
                {UNLISTED_BADGE}
              </Badge>
            )}
          </p>
          {owner !== null && (
            <p className="mt-0.5 text-xs">
              <OwnerLink owner={owner} />
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-col sm:items-end sm:gap-1.5">
        <MatchStageBadge match={item} />
        {item.live && (
          <span className="flex items-center gap-2">
            <Badge>{LIVE_MATCH_BADGE}</Badge>
            <PathLink
              href={HOME_HREF}
              className={cn(
                INLINE_LINK_CLASS_NAME,
                'inline-flex items-center gap-0.5 rounded-sm text-xs whitespace-nowrap',
              )}
            >
              {WATCH_ON_TOP_LABEL}
              <ArrowRightIcon aria-hidden="true" className="size-3.5" />
            </PathLink>
          </span>
        )}
      </div>
    </article>
  );
}
