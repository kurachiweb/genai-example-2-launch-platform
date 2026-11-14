import { PencilIcon } from 'lucide-react';
import { useId } from 'react';

import {
  type DirectoryQuery,
  withConditions,
} from '../../../common-lib/directory/directory-query-rules.ts';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { HighlightedText } from '../../../lib/components/search/highlighted-text.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { checkExternalUrl } from '../../../common-lib/url/external-url.ts';
import {
  myProductEditHref,
  productDetailHref,
  profileHref,
} from '../layout/site-links.ts';
import { ProductSiteLink } from '../match/product-site-link.tsx';
import {
  EDIT_PRODUCT_LABEL,
  editProductLabel,
  productLogoAlt,
} from '../product/my-product-messages.ts';
import { UserAvatar } from '../profile/user-avatar.tsx';
import { OWNER_LINK_PREFIX } from '../upvote-history/upvote-history-messages.ts';
import { AwardBadges } from './award-badges.tsx';
import { directoryHref } from './directory-href.ts';
import type { DirectoryItemData } from './directory-item-types.ts';
import {
  categoryFilterLabel,
  OWN_PRODUCT_BADGE,
} from './directory-item-messages.ts';
import type { DirectoryItemMetric } from './directory-section-types.ts';
import { UnmarkedPathLink } from './unmarked-path-link.tsx';
import { WinSummary } from './win-summary.tsx';

export interface DirectoryItemProps {
  readonly item: DirectoryItemData;
  // URLから正規化した現在の条件。カテゴリの絞り込みのリンクが他の条件を保つために使う
  readonly query: DirectoryQuery;
  // 名称・タグラインの強調に使う検索語
  readonly searchTerms: readonly string[];
  readonly metricRegistrations: readonly DirectoryItemMetric[];
}

// 項目全体に広げた名称のリンクの上に、他の操作を重ねて押せるようにする
const RAISED_CLASS_NAME = 'relative z-10';

// ディレクトリに載るプロダクトは投票で勝ち上がったプロダクトのため、ugcを付けない
const SITE_LINK_REL = 'noopener';

function OwnerLink({
  owner,
}: {
  readonly owner: NonNullable<DirectoryItemData['owner']>;
}) {
  return (
    <PathLink
      href={profileHref(owner.handle)}
      className="relative z-10 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm text-muted-foreground no-underline hover:text-foreground hover:underline"
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

function ItemMetrics({
  item,
  registrations,
}: {
  readonly item: DirectoryItemData;
  readonly registrations: readonly DirectoryItemMetric[];
}) {
  const valueOf = new Map(item.metrics.map(({ key, value }) => [key, value]));
  return registrations
    .toSorted((left, right) => left.order - right.order)
    .map(({ key, component: Metric }) => {
      const value = valueOf.get(key);
      return value === undefined ? null : (
        <span key={key} className={RAISED_CLASS_NAME}>
          <Metric
            value={value}
            productHandle={item.handle}
            productName={item.name}
          />
        </span>
      );
    });
}

function ItemActions({ item }: { readonly item: DirectoryItemData }) {
  // APIサーバーは検証できない外部WebサイトURLを空で返すため、リンクにできるURLが無く本人でもなければ操作の枠ごと出さない
  const hasSite = checkExternalUrl(item.websiteUrl) === 'ok';
  if (!item.isViewerOwn && !hasSite) {
    return null;
  }
  return (
    <div className="flex flex-wrap justify-end gap-2 md:col-start-2 lg:col-start-auto lg:flex-col lg:items-stretch">
      {item.isViewerOwn && (
        <Button
          asChild
          size="xs"
          variant="outline"
          className="relative z-10 rounded-full px-3"
        >
          <PathLink
            href={myProductEditHref(item.handle)}
            aria-label={editProductLabel(item.name)}
          >
            <PencilIcon aria-hidden="true" />
            {EDIT_PRODUCT_LABEL}
          </PathLink>
        </Button>
      )}
      {hasSite && (
        <span className={`${RAISED_CLASS_NAME} flex flex-col`}>
          <ProductSiteLink
            name={item.name}
            websiteUrl={item.websiteUrl}
            rel={SITE_LINK_REL}
          />
        </span>
      )}
    </div>
  );
}

// ロゴ・受賞・名称・タグライン・カテゴリ・投稿者・項目の値と、勝利した予選マッチ・操作を、1024px以上は3列、768px以上は2列、それ未満は縦に積んで示す。名称のリンクを項目全体に広げて詳細ページへ導く
export function DirectoryItem({
  item,
  query,
  searchTerms,
  metricRegistrations,
}: DirectoryItemProps) {
  const nameId = useId();
  const { category, owner } = item;
  return (
    <article
      aria-labelledby={nameId}
      className="relative grid gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30 sm:p-5 md:grid-cols-[minmax(0,1fr)_15rem] lg:grid-cols-[minmax(0,1fr)_15rem_7.5rem] lg:items-center lg:gap-5"
    >
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        <MediaPicture
          image={item.logo}
          display={{ kind: 'square', size: 64 }}
          alt={productLogoAlt(item.name)}
          placeholder={{ label: item.name, seed: item.handle }}
          loading="lazy"
          className="size-14 shrink-0 rounded-xl sm:size-16"
        />
        <div className="min-w-0 flex-1">
          <AwardBadges
            awards={item.awards}
            className={`mb-1.5 w-fit max-w-full ${RAISED_CLASS_NAME}`}
          />
          <h3
            id={nameId}
            className="text-lg leading-snug font-extrabold tracking-tight wrap-anywhere"
          >
            <PathLink
              href={productDetailHref(item.handle)}
              className="rounded-sm text-foreground no-underline after:absolute after:inset-0 after:rounded-2xl hover:underline"
            >
              <HighlightedText text={item.name} terms={searchTerms} />
            </PathLink>
          </h3>
          <p className="mt-1 line-clamp-2 text-sm wrap-anywhere text-muted-foreground">
            <HighlightedText text={item.tagline} terms={searchTerms} />
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <Button
              asChild
              size="xs"
              variant="outline"
              className="relative z-10 h-auto max-w-full rounded-full whitespace-normal"
            >
              <UnmarkedPathLink
                href={directoryHref(
                  withConditions(query, { category: category.handle }),
                )}
                aria-label={categoryFilterLabel(category.name)}
              >
                <span className="wrap-anywhere">{category.name}</span>
              </UnmarkedPathLink>
            </Button>
            {item.isViewerOwn ? (
              <span className="rounded-full bg-primary/12 px-2.5 py-0.5 font-bold text-primary">
                {OWN_PRODUCT_BADGE}
              </span>
            ) : (
              owner !== null && <OwnerLink owner={owner} />
            )}
            <ItemMetrics item={item} registrations={metricRegistrations} />
          </div>
        </div>
      </div>
      <WinSummary win={item.win} />
      <ItemActions item={item} />
    </article>
  );
}
