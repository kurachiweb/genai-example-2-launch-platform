import { useSuspenseQuery } from '@tanstack/react-query';
import { ChevronRightIcon } from 'lucide-react';
import { useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import { productTrophiesQueryOptions } from '../../graphql/week-tournament.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import type { ProductPageContext } from '../product-page/product-page-section-types.ts';
import { TrophyArt } from './trophy-art.tsx';
import {
  TROPHY_AWARD_NAMES,
  TROPHY_AWARDED_SUFFIX,
  TROPHY_BRACKET_LINK_LABEL,
  TROPHY_SHELF_TITLE,
  trophyBracketLinkLabel,
} from './trophy-messages.ts';
import {
  orderTrophies,
  type ProductTrophyView,
  trophyAwardedDateOf,
} from './trophy-shelf-model.ts';

const YEAR_ART_SIZE = 96;
const WEEK_ART_SIZE = 72;

function TrophyItem({ trophy }: { readonly trophy: ProductTrophyView }) {
  const year = trophy.kind === 'YEAR';
  return (
    <li
      className={cn(
        'flex shrink-0 snap-start flex-col items-center text-center',
        year ? 'w-48' : 'w-44',
      )}
    >
      <TrophyArt
        kind={trophy.kind}
        size={year ? YEAR_ART_SIZE : WEEK_ART_SIZE}
      />
      <p
        className={cn(
          'mt-2 leading-tight font-extrabold',
          year ? 'text-base' : 'text-sm',
        )}
        translate="no"
      >
        {TROPHY_AWARD_NAMES[trophy.kind]}
      </p>
      <p className="mt-0.5 text-xs font-semibold text-gold-foreground dark:text-gold">
        {trophy.periodLabel}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        <LaunchDateText date={trophyAwardedDateOf(trophy.awardedAt)} />
        {TROPHY_AWARDED_SUFFIX}
      </p>
      {trophy.bracketPath !== null && (
        <a
          href={trophy.bracketPath}
          aria-label={trophyBracketLinkLabel(trophy.periodLabel)}
          className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-primary underline underline-offset-4"
        >
          {TROPHY_BRACKET_LINK_LABEL}
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

// プロダクト詳細の本文のトロフィーの区画。Product of the Yearを先頭に大きく、Product of the Weekを受賞が新しい順に棚へ並べる。
// 受賞が無い・閲覧できないプロダクトでは何も描かない。取得の失敗はページの区画のエラーの境界がこの区画の位置に留める
export function TrophyShelf({ product }: ProductPageContext) {
  const titleId = useId();
  const viewer = useViewer();
  const { data } = useSuspenseQuery(
    productTrophiesQueryOptions(viewer, product.handle),
  );
  const trophies = data.productTrophies;
  if (trophies === null || trophies.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 overflow-hidden rounded-2xl border border-gold/50 bg-card text-card-foreground shadow-sm"
    >
      <h2
        id={titleId}
        className="border-b border-gold/30 bg-gold/10 px-5 py-2.5 text-sm font-extrabold tracking-wide"
      >
        {TROPHY_SHELF_TITLE}
      </h2>
      <ul className="flex snap-x gap-3 overflow-x-auto px-5 pt-5 pb-1">
        {orderTrophies(trophies).map((trophy) => (
          <TrophyItem key={`${trophy.kind}:${trophy.period}`} trophy={trophy} />
        ))}
      </ul>
      <div
        aria-hidden="true"
        className="mx-5 mt-1 mb-5 h-2 rounded-full bg-linear-to-b from-[oklch(0.62_0.08_60)] to-[oklch(0.45_0.07_55)] shadow-md"
      />
    </section>
  );
}
