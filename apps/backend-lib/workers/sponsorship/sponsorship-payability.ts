import { validatePeriod } from '../../../common-lib/sponsorship/sponsorship-period.ts';
import type { SponsorshipOfferRejectionCode } from '../../core/sponsorship/offer-rejection.ts';
import type {
  EligibleProductReader,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../core/sponsorship/ports.ts';
import { toBusinessDateTime } from '../../core/time/business-time.ts';

export interface PayabilitySources {
  readonly store: SponsorshipStore;
  readonly eligibleProducts: EligibleProductReader;
}

// 決済の開始は開始日が今日より前の申込を先に拒否し、決済の確定は反映の期限で拒否するため、開始日が過ぎたことはここで判定しない
export async function payabilityRejectionOf(
  record: SponsorshipRecord,
  now: Date,
  { store, eligibleProducts }: PayabilitySources,
): Promise<SponsorshipOfferRejectionCode | undefined> {
  const violations = validatePeriod({
    startsOn: record.startsOn,
    endsOn: record.endsOn,
    today: toBusinessDateTime(now).date,
  });
  if (
    (violations.startsOn !== undefined && violations.startsOn !== 'past') ||
    violations.endsOn !== undefined
  ) {
    return 'sponsorship_period_invalid';
  }
  if (
    !(await eligibleProducts.isEligible(record.userId, record.productId, now))
  ) {
    return 'sponsorship_product_ineligible';
  }
  const overlaps = await store.hasPaidOverlap({
    productId: record.productId,
    tier: record.tier,
    startsOn: record.startsOn,
    endsOn: record.endsOn,
    excludeId: record.id,
  });
  return overlaps ? 'sponsorship_overlap' : undefined;
}
