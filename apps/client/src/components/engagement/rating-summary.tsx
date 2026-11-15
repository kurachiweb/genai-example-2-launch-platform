import { StarIcon } from 'lucide-react';

import {
  RATING_EMPTY_MESSAGE,
  RATING_FIRST_INVITE,
  RATING_OUT_OF_FIVE,
  ratingCountLabelOf,
} from './rating-messages.ts';

export interface RatingSummaryProps {
  readonly average: number | null;
  readonly count: number;
  // 評価が0件の時に最初の評価を促すか
  readonly invite: boolean;
}

const AVERAGE_FORMAT = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const COUNT_FORMAT = new Intl.NumberFormat('ja-JP');

const MAX_SCORE = 5;

const METER_STARS = [1, 2, 3, 4, 5] as const;

// 平均値を星5つの塗りの割合で示す。読み上げは平均値の数字で行う
function RatingMeter({ average }: { readonly average: number }) {
  const ratio = Math.min(1, Math.max(0, average / MAX_SCORE));
  return (
    <span
      aria-hidden="true"
      data-slot="rating-meter"
      className="relative inline-flex"
    >
      <span className="flex">
        {METER_STARS.map((star) => (
          <StarIcon key={star} className="size-5 text-muted-foreground/40" />
        ))}
      </span>
      <span
        className="absolute inset-y-0 left-0 flex overflow-hidden"
        style={{ width: `${String(ratio * 100)}%` }}
      >
        {METER_STARS.map((star) => (
          <StarIcon
            key={star}
            className="size-5 shrink-0 fill-primary text-primary"
          />
        ))}
      </span>
    </span>
  );
}

export function RatingSummary({ average, count, invite }: RatingSummaryProps) {
  if (average === null || count === 0) {
    return (
      <div className="flex items-center gap-3">
        <StarIcon
          aria-hidden="true"
          className="size-8 shrink-0 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          {RATING_EMPTY_MESSAGE}
          {invite && RATING_FIRST_INVITE}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-3">
      <p className="text-5xl leading-none font-extrabold tabular-nums">
        {AVERAGE_FORMAT.format(average)}
        <span className="sr-only">{RATING_OUT_OF_FIVE}</span>
      </p>
      <div className="pb-1">
        <RatingMeter average={average} />
        <p className="mt-1 text-xs text-muted-foreground">
          {ratingCountLabelOf(COUNT_FORMAT.format(count))}
        </p>
      </div>
    </div>
  );
}
