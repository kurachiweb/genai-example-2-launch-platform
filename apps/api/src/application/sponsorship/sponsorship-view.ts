import {
  deriveSponsorshipStatus,
  type ProductAvailability,
  type SponsorshipStatus,
} from '../../../common-lib/sponsorship/sponsorship-status.ts';
import type { ProductSummaryRecord } from '../../../lib/core/product/ports.ts';
import type { SponsorshipRecord } from '../../../lib/core/sponsorship/ports.ts';
import {
  addBusinessDays,
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';

export interface SponsorshipView {
  readonly record: SponsorshipRecord;
  // 論理削除済みはundefined
  readonly product: ProductSummaryRecord | undefined;
  readonly status: SponsorshipStatus;
}

const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });

export const nextDayStartsAtOf = (today: BusinessDate): Date =>
  fromBusinessDateTime(addBusinessDays(today, 1), START_OF_DAY);

export const uniqueProductIdsOf = (
  records: readonly SponsorshipRecord[],
): readonly string[] => [...new Set(records.map(({ productId }) => productId))];

const availabilityOf = (
  summary: ProductSummaryRecord | undefined,
): ProductAvailability => {
  if (summary === undefined) {
    return 'deleted';
  }
  return summary.visible ? 'visible' : 'hidden';
};

// summariesはnot-deletedの範囲で照会した結果。返らないプロダクトは論理削除済みとみなす
export const sponsorshipViewOf = (
  record: SponsorshipRecord,
  summaries: ReadonlyMap<string, ProductSummaryRecord>,
  today: BusinessDate,
): SponsorshipView => {
  const summary =
    record.productDeletedAt === null
      ? summaries.get(record.productId)
      : undefined;
  return {
    record,
    product: summary,
    status: deriveSponsorshipStatus({
      state: record.state,
      startsOn: record.startsOn,
      endsOn: record.endsOn,
      product: availabilityOf(summary),
      today,
    }),
  };
};
