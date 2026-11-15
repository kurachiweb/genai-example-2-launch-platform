import { ExternalLinkIcon } from 'lucide-react';
import { useId } from 'react';

import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { checkExternalUrl } from '../../../common-lib/url/external-url.ts';
import type { LaunchHistoryItemView } from '../../graphql/launch-history.ts';
import {
  directoryCategoryHref,
  myProductEditHref,
  productDetailHref,
} from '../layout/site-links.ts';
import {
  EDIT_PRODUCT_LABEL,
  editProductLabel,
  productLogoAlt,
} from '../product/my-product-messages.ts';
import { NEW_TAB_NOTICE } from '../profile/profile-messages.ts';
import { AwardBadgeList } from './award-badge-list.tsx';
import { LaunchHistoryLaunches } from './launch-history-launches.tsx';
import {
  OPEN_SITE_LABEL,
  openSiteLabelPrefix,
  PRIVATE_PRODUCT_BADGE,
  UNLISTED_PRODUCT_BADGE,
} from './launch-history-messages.ts';

export interface LaunchHistoryItemProps {
  readonly item: LaunchHistoryItemView;
  readonly viewerIsOwner: boolean;
  // 閲覧者が停止中の本人
  readonly ownerSuspended: boolean;
}

// 項目全体に広げた名称のリンクの上に、他の操作を重ねて押せるようにする
const RAISED_CLASS_NAME = 'relative z-10';

const SECONDARY_LINK_CLASS_NAME =
  'rounded-sm font-medium text-primary underline-offset-4 hover:underline';

// 掲載済みのプロダクトは審査を経ているため評価を渡し、本人にだけ表示する未掲載のプロダクトは利用者の投稿としてugcを付ける
const siteRelOf = (listed: boolean): string =>
  listed ? 'noopener' : 'noopener ugc';

function SiteLink({ item }: { readonly item: LaunchHistoryItemView }) {
  const { name, websiteUrl, listed } = item.product;
  // 保存時の検証を通った値だけが入る前提だが、危険なスキームのリンクを作らないよう描画でも確かめる
  if (checkExternalUrl(websiteUrl) !== 'ok') {
    return null;
  }
  return (
    <a
      href={websiteUrl}
      target="_blank"
      rel={siteRelOf(listed)}
      className={cn(
        RAISED_CLASS_NAME,
        SECONDARY_LINK_CLASS_NAME,
        'inline-flex items-center gap-1',
      )}
    >
      <span className="sr-only">{openSiteLabelPrefix(name)}</span>
      {OPEN_SITE_LABEL}
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{NEW_TAB_NOTICE}</span>
    </a>
  );
}

// ロゴ・受賞・名称・タグライン・カテゴリ・サイトと本人の編集の導線・ローンチを示す。名称のリンクを項目全体に広げ、プロダクト詳細へ移す。停止中の本人にはリンクを出さず薄く示す
export function LaunchHistoryItem({
  item,
  viewerIsOwner,
  ownerSuspended,
}: LaunchHistoryItemProps) {
  const nameId = useId();
  const { product } = item;
  const linked = !ownerSuspended;
  const unlisted = viewerIsOwner && !ownerSuspended && !product.listed;
  return (
    <article
      aria-labelledby={nameId}
      className={cn(
        'relative flex gap-4 rounded-xl border border-border p-4 text-card-foreground sm:p-5',
        linked ? 'bg-card hover:bg-accent/40' : 'border-dashed bg-muted/40',
      )}
    >
      <MediaPicture
        image={product.logo}
        display={{ kind: 'square', size: 64 }}
        alt={productLogoAlt(product.name)}
        placeholder={{ label: product.name, seed: product.handle }}
        loading="lazy"
        className={cn(
          'size-16 shrink-0 rounded-lg',
          ownerSuspended && 'opacity-50',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={nameId} className="text-lg font-bold wrap-anywhere">
            {linked ? (
              <PathLink
                href={productDetailHref(product.handle)}
                className="rounded-sm text-foreground no-underline after:absolute after:inset-0 after:rounded-xl hover:underline"
              >
                {product.name}
              </PathLink>
            ) : (
              product.name
            )}
          </h3>
          {unlisted && (
            <Badge variant="outline">{UNLISTED_PRODUCT_BADGE}</Badge>
          )}
          {ownerSuspended && (
            <Badge variant="secondary">{PRIVATE_PRODUCT_BADGE}</Badge>
          )}
        </div>
        <AwardBadgeList awards={item.awards} className={RAISED_CLASS_NAME} />
        <p className="line-clamp-2 text-sm wrap-anywhere text-muted-foreground">
          {product.tagline}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {linked ? (
            <PathLink
              href={directoryCategoryHref(product.category.handle)}
              className={cn(RAISED_CLASS_NAME, SECONDARY_LINK_CLASS_NAME)}
            >
              {product.category.name}
            </PathLink>
          ) : (
            <span className="text-muted-foreground">
              {product.category.name}
            </span>
          )}
          {linked && <SiteLink item={item} />}
          {linked && viewerIsOwner && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className={RAISED_CLASS_NAME}
            >
              <PathLink
                href={myProductEditHref(product.handle)}
                aria-label={editProductLabel(product.name)}
              >
                {EDIT_PRODUCT_LABEL}
              </PathLink>
            </Button>
          )}
        </div>
        <LaunchHistoryLaunches launches={item.launches} linked={linked} />
      </div>
    </article>
  );
}
