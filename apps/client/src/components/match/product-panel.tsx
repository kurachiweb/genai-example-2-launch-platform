import { ChevronUpIcon, PackageIcon } from 'lucide-react';

import { NumberText } from '../../../lib/components/datetime/number-text.tsx';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { VOTE_UNIT } from './match-card-messages.ts';
import type { EntryOutcome, MatchEntryView } from './match-card-model.ts';
import { HIDDEN_PRODUCT_NAME } from './match-labels.ts';
import type { PitchSide } from './pitch-model.ts';
import { ProductNameLink } from './product-name-link.tsx';
import { ProductSiteLink } from './product-site-link.tsx';
import { UpvoteButton } from './upvote-button.tsx';

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
              <ProductNameLink
                name={product.name}
                handle={product.handle}
                linked={product.listed || entry.isViewerOwn}
              />
            </h3>
            <p className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground @[768px]:text-sm">
              {product.tagline}
            </p>
            <div className={cn('mt-2 flex', isRight && MIRRORED_ROW)}>
              <ProductSiteLink
                name={product.name}
                websiteUrl={product.websiteUrl}
                rel={siteRel}
              />
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
