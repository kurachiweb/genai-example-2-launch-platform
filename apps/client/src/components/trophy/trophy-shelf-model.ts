import { toDateTimeValue } from '../../../lib/utilities/datetime/date-time-value.ts';
import type {
  ClientProductTrophiesQuery,
  TrophyKind,
} from '../../graphql/generated/graphql.ts';
import { businessDateOf } from '../product/business-time.ts';

export type ProductTrophyView = NonNullable<
  ClientProductTrophiesQuery['productTrophies']
>[number];

const KIND_RANK: Readonly<Record<TrophyKind, number>> = Object.freeze({
  YEAR: 0,
  WEEK: 1,
});

// Product of the Yearを先頭に置き、同じ種類は受賞が新しい順に並べる
export const orderTrophies = (
  trophies: readonly ProductTrophyView[],
): ProductTrophyView[] =>
  [...trophies].sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      toDateTimeValue(b.awardedAt).getTime() -
        toDateTimeValue(a.awardedAt).getTime(),
  );

// 受賞日はブラケットのページの決勝の日と同じく業務日付で示し、閲覧者のタイムゾーンで日をずらさない
export const trophyAwardedDateOf = (awardedAt: string): string =>
  businessDateOf(toDateTimeValue(awardedAt));
