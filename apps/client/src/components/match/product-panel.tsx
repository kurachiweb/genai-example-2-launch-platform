import { ChevronUpIcon, ExternalLinkIcon, PackageIcon } from 'lucide-react';

import { NumberText } from '../../../lib/components/datetime/number-text.tsx';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { checkExternalUrl } from '../../../common-lib/url/external-url.ts';
import { productDetailHref } from '../layout/site-links.ts';
import {
  OPEN_SITE_LABEL,
  openSiteLabelPrefix,
} from '../launch-history/launch-history-messages.ts';
import { NEW_TAB_NOTICE } from '../profile/profile-messages.ts';
import { VOTE_UNIT } from './match-card-messages.ts';
import type { EntryOutcome, MatchEntryView } from './match-card-model.ts';
import { HIDDEN_PRODUCT_NAME } from './match-labels.ts';
import type { PitchSide } from './pitch-model.ts';
import { UpvoteButton } from './upvote-button.tsx';

type MatchProductView = NonNullable<MatchEntryView['product']>;

export interface ProductPanelProps {
  readonly entry: MatchEntryView;
  readonly side: PitchSide;
  // 外部Webサイトへのリンクのrel。表示場所ごとの値はページ構成の「外部Webサイトへのリンク」に従う
  readonly siteRel: string;
  readonly pressed: boolean;
  readonly pending: boolean;
  readonly disabledReason: string | null;
  // 結果の確定の後の勝敗。確定の前はnull
  readonly outcome: EntryOutcome;
  readonly onUpvote: () => void;
}

// 横に並べた配置では右の側を鏡写しにし、外側から内側へ同じ順に読めるようにする
const MIRRORED = '@[768px]:flex-row-reverse @[768px]:text-right';

const MIRRORED_ROW = '@[768px]:justify-end';

function VoteCount({ count }: { readonly count: number }) {
  return (
    <p className="flex size-16 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-border bg-card text-foreground">
      <ChevronUpIcon aria-hidden="true" strokeWidth={3} className="size-5" />
      <span className="text-xl leading-none font-extrabold tabular-nums">
        <NumberText value={count} />
        <span className="sr-only">{VOTE_UNIT}</span>
      </span>
    </p>
  );
}

function SiteLink({
  product,
  siteRel,
}: {
  readonly product: MatchProductView;
  readonly siteRel: string;
}) {
  // 保存時の検証を通った値だけが入る前提だが、危険なスキームのリンクを作らないよう描画でも確かめる
  if (checkExternalUrl(product.websiteUrl) !== 'ok') {
    return null;
  }
  return (
    <Button asChild size="xs" variant="outline" className="rounded-full px-3">
      <a href={product.websiteUrl} target="_blank" rel={siteRel}>
        <span className="sr-only">{openSiteLabelPrefix(product.name)}</span>
        {OPEN_SITE_LABEL}
        <ExternalLinkIcon aria-hidden="true" />
        <span className="sr-only">{NEW_TAB_NOTICE}</span>
      </a>
    </Button>
  );
}

function ProductName({
  product,
  linked,
}: {
  readonly product: MatchProductView;
  readonly linked: boolean;
}) {
  if (!linked) {
    return product.name;
  }
  return (
    <PathLink
      href={productDetailHref(product.handle)}
      className="rounded-sm text-inherit no-underline hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {product.name}
    </PathLink>
  );
}

function HiddenProductBody({ side }: { readonly side: PitchSide }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <PackageIcon className="size-6" />
      </span>
      <div className={cn('min-w-0 flex-1', side === 'right' && MIRRORED_ROW)}>
        <h3 className="text-base font-bold text-muted-foreground @[768px]:text-lg">
          {HIDDEN_PRODUCT_NAME}
        </h3>
      </div>
    </>
  );
}

export function ProductPanel({
  entry,
  side,
  siteRel,
  pressed,
  pending,
  disabledReason,
  outcome,
  onUpvote,
}: ProductPanelProps) {
  const { product } = entry;
  const isRight = side === 'right';
  const showsButton = product !== null && !entry.isViewerOwn;
  return (
    <div
      data-match-side={side}
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-xl border bg-card/85 p-3 shadow-sm backdrop-blur-sm',
        isRight && MIRRORED,
        outcome === 'won' && 'border-gold ring-2 ring-gold/50',
        // 敗北を文字の色で示すと本文のコントラスト比を下回るため、枠線とロゴの彩度で示す
        outcome === 'lost' && 'border-dashed border-border',
      )}
    >
      {product === null ? (
        <HiddenProductBody side={side} />
      ) : (
        <>
          <MediaPicture
            image={product.logo}
            display={{ kind: 'square', size: 64 }}
            alt=""
            placeholder={{ label: product.name, seed: product.handle }}
            loading="lazy"
            className={cn(
              'size-12 shrink-0 rounded-lg',
              outcome === 'lost' && 'opacity-70 saturate-50',
            )}
          />
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                'flex flex-wrap items-center gap-1.5',
                isRight && MIRRORED_ROW,
              )}
            >
              <Badge variant="outline">{product.category.name}</Badge>
            </div>
            <h3 className="mt-1 text-base font-extrabold tracking-tight wrap-anywhere text-foreground @[768px]:text-lg">
              <ProductName
                product={product}
                linked={product.listed || entry.isViewerOwn}
              />
            </h3>
            <p className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground @[768px]:text-sm">
              {product.tagline}
            </p>
            <div className={cn('mt-2 flex', isRight && MIRRORED_ROW)}>
              <SiteLink product={product} siteRel={siteRel} />
            </div>
          </div>
        </>
      )}
      {showsButton ? (
        <UpvoteButton
          productName={product.name}
          count={entry.upvoteCount}
          pressed={pressed}
          pending={pending}
          disabledReason={disabledReason}
          onClick={onUpvote}
        />
      ) : (
        <VoteCount count={entry.upvoteCount} />
      )}
    </div>
  );
}
