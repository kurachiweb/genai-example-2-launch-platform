import { TrophyIcon } from 'lucide-react';
import { useId } from 'react';

import { withConditions } from '../../../common-lib/directory/directory-query-rules.ts';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ProductPageView } from '../../graphql/product-page.ts';
import { directoryHref } from '../directory/directory-href.ts';
import { categoryFilterLabel } from '../directory/directory-item-messages.ts';
import { UnmarkedPathLink } from '../directory/unmarked-path-link.tsx';
import { productDetailHref, profileHref } from '../layout/site-links.ts';
import { ProductSiteLink } from '../match/product-site-link.tsx';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import { productLogoAlt } from '../product/my-product-messages.ts';
import { UserAvatar } from '../profile/user-avatar.tsx';
import { CopyLinkButton } from './copy-link-button.tsx';
import { OwnerFollow } from './owner-follow.tsx';
import {
  awardCountLabel,
  FIRST_LAUNCH_LABEL,
  handleLabel,
  LAUNCH_COUNT_LABEL,
  LAUNCH_COUNT_UNIT,
  LOSS_UNIT,
  OWNER_LABEL,
  RECORD_LABEL,
  WIN_UNIT,
} from './product-header-messages.ts';

export interface ProductHeaderProps {
  readonly page: ProductPageView;
}

// 詳細ページは投票で勝ち上がったプロダクトか、本人だけが見る未掲載のプロダクトのため、ugcを付けない
const SITE_LINK_REL = 'noopener';

const UNIT_CLASS_NAME = 'text-xs font-bold';

const totalAwardCount = (awards: ProductPageView['awards']): number =>
  awards.reduce((total, { count }) => total + count, 0);

function OwnerLink({ owner }: { readonly owner: ProductPageView['owner'] }) {
  return (
    <PathLink
      href={profileHref(owner.handle)}
      className="group flex min-w-0 items-center gap-3 rounded-md text-foreground no-underline"
    >
      {/* リンクの名前にニックネームが重ねて入らないよう、プロフィール画像は支援技術から隠す */}
      <span aria-hidden="true" className="shrink-0">
        <UserAvatar user={owner} size={32} className="size-10" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">
          {OWNER_LABEL}
        </span>
        <span className="block font-bold wrap-anywhere group-hover:underline">
          {owner.nickname}
        </span>
        <span className="block text-xs wrap-anywhere text-muted-foreground">
          {handleLabel(owner.handle)}
        </span>
      </span>
    </PathLink>
  );
}

function ProductRecord({
  record,
}: {
  readonly record: ProductPageView['record'];
}) {
  // キックオフ済みのローンチが無ければ数える対象が無いため、欄ごと出さない
  if (record.firstLaunchDate === null) {
    return null;
  }
  return (
    <dl className="mt-5 grid grid-cols-3 divide-x divide-border rounded-xl bg-muted/60 text-center">
      <div className="px-2 py-2.5">
        <dt className="text-xs text-muted-foreground">{FIRST_LAUNCH_LABEL}</dt>
        <dd className="mt-0.5 text-sm font-bold">
          <LaunchDateText date={record.firstLaunchDate} />
        </dd>
      </div>
      <div className="px-2 py-2.5">
        <dt className="text-xs text-muted-foreground">{LAUNCH_COUNT_LABEL}</dt>
        <dd className="mt-0.5 text-lg font-extrabold tabular-nums">
          {record.launchCount}
          <span className={UNIT_CLASS_NAME}>{LAUNCH_COUNT_UNIT}</span>
        </dd>
      </div>
      <div className="px-2 py-2.5">
        <dt className="text-xs text-muted-foreground">{RECORD_LABEL}</dt>
        <dd className="mt-0.5 text-lg font-extrabold tabular-nums">
          {record.wins}
          <span className={UNIT_CLASS_NAME}>{WIN_UNIT}</span>
          {record.losses}
          <span className={UNIT_CLASS_NAME}>{LOSS_UNIT}</span>
        </dd>
      </div>
    </dl>
  );
}

export function ProductHeader({ page }: ProductHeaderProps) {
  const nameId = useId();
  const { category, owner } = page;
  const awardCount = totalAwardCount(page.awards);
  return (
    <section
      aria-labelledby={nameId}
      className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-7"
    >
      <div className="flex items-start gap-4 sm:gap-6">
        <MediaPicture
          image={page.logo}
          display={{ kind: 'square', size: 128 }}
          alt={productLogoAlt(page.name)}
          placeholder={{ label: page.name, seed: page.handle }}
          loading="eager"
          className="size-20 shrink-0 rounded-2xl shadow-md sm:size-32"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              size="xs"
              variant="outline"
              className="h-auto max-w-full rounded-full whitespace-normal"
            >
              <UnmarkedPathLink
                href={directoryHref(
                  withConditions({}, { category: category.handle }),
                )}
                aria-label={categoryFilterLabel(category.name)}
              >
                <span className="wrap-anywhere">{category.name}</span>
              </UnmarkedPathLink>
            </Button>
            {awardCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold-strong bg-gold px-2.5 py-0.5 text-xs font-bold text-gold-foreground">
                <TrophyIcon aria-hidden="true" className="size-3.5" />
                {awardCountLabel(awardCount)}
              </span>
            )}
          </div>
          <h1
            id={nameId}
            className="mt-2 text-2xl leading-tight font-extrabold tracking-tight text-balance wrap-anywhere sm:text-4xl"
          >
            {page.name}
          </h1>
          <p className="mt-2 text-base wrap-anywhere text-muted-foreground sm:text-lg">
            {page.tagline}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-border pt-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <OwnerLink owner={owner} />
          <OwnerFollow
            ownerHandle={owner.handle}
            viewerIsOwner={page.viewerIsOwner}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyLinkButton path={productDetailHref(page.handle)} />
          <ProductSiteLink
            name={page.name}
            websiteUrl={page.websiteUrl}
            rel={SITE_LINK_REL}
            size="lg"
            variant="default"
            className="rounded-md px-6"
          />
        </div>
      </div>

      <ProductRecord record={page.record} />
    </section>
  );
}
