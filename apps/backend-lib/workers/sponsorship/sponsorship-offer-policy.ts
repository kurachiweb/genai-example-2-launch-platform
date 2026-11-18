import { inject, injectable } from 'inversify';

import { PURCHASE_KIND_LABELS } from '../../../common-lib/payments/purchase-kinds.ts';
import { SPONSORSHIP_PURCHASE_CONDITIONS } from '../../../common-lib/sponsorship/sponsorship-purchase-conditions.ts';
import {
  SPONSORSHIP_PRICE_LOOKUP_KEYS,
  SPONSORSHIP_TIER_LABELS,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { parseCalendarDate } from '../../../common-lib/time/business-date-arithmetic.ts';
import type {
  PurchaseOffer,
  PurchaseOfferDecision,
  PurchaseOfferPolicy,
  PurchaseOfferRequest,
} from '../../core/payments/purchase-kind-contract.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../core/sponsorship/identifiers.ts';
import {
  SPONSORSHIP_OFFER_REJECTION_MESSAGES,
  type SponsorshipOfferRejectionCode,
} from '../../core/sponsorship/offer-rejection.ts';
import type {
  EligibleProductReader,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../core/sponsorship/ports.ts';
import {
  addBusinessDays,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../../core/time/business-time.ts';
import { payabilityRejectionOf } from './sponsorship-payability.ts';

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

function rejectionOf(
  code: SponsorshipOfferRejectionCode,
): PurchaseOfferDecision {
  return {
    kind: 'unavailable',
    code,
    message: SPONSORSHIP_OFFER_REJECTION_MESSAGES[code],
  };
}

// 購入に保存して購入確認メールにも載るため、開始日は閲覧の年に依らず年を付け、終了日は年をまたぐときだけ年を付ける
function formatPeriod(startsOn: string, endsOn: string): string {
  const start = parseCalendarDate(startsOn);
  const end = parseCalendarDate(endsOn);
  const endMonthDay = `${String(end.month)}月${String(end.day)}日`;
  const endLabel =
    start.year === end.year
      ? endMonthDay
      : `${String(end.year)}年${endMonthDay}`;
  return `${String(start.year)}年${String(start.month)}月${String(start.day)}日〜${endLabel}`;
}

function offerOf(record: SponsorshipRecord): PurchaseOffer {
  const period = formatPeriod(record.startsOn, record.endsOn);
  return Object.freeze({
    priceLookupKey: SPONSORSHIP_PRICE_LOOKUP_KEYS[record.tier],
    quantity: record.days,
    relatedId: record.id,
    exclusivityKey: `sponsorship:${record.id}`,
    deadlineAt: null,
    acceptUntil: null,
    fulfillableUntil: fromBusinessDateTime(
      addBusinessDays(record.startsOn, 1),
      START_OF_DAY,
    ),
    summary: Object.freeze({
      itemName: `${PURCHASE_KIND_LABELS.sponsorship}(${SPONSORSHIP_TIER_LABELS[record.tier]})`,
      quantityLabel: `${String(record.days)}日間(${period})`,
      serviceTiming: `選んだ掲載期間(${period}、UTC-08:00の日付)`,
      additionalNotes: SPONSORSHIP_PURCHASE_CONDITIONS,
    }),
    // 申込と決済の再開の操作が決済の開始の前にbot判定を行う
    requiresBotVerification: false,
  });
}

@injectable()
export class SponsorshipOfferPolicy implements PurchaseOfferPolicy {
  constructor(
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
    @inject(SPONSORSHIP_PLATFORM_TYPES.EligibleProductReader)
    private readonly eligibleProducts: EligibleProductReader,
  ) {}

  // 画面の表示や申込の受付の判定に頼らず、決済の開始の時点の行で判定し直す
  async describe({
    userId,
    targetId,
    now,
  }: PurchaseOfferRequest): Promise<PurchaseOfferDecision> {
    if (targetId === null) {
      return rejectionOf('sponsorship_not_payable');
    }
    const record = await this.store.findById(targetId);
    if (
      record === undefined ||
      record.userId !== userId ||
      record.state !== 'pending_payment'
    ) {
      return rejectionOf('sponsorship_not_payable');
    }
    const today = toBusinessDateTime(now).date;
    if (record.startsOn < today) {
      return rejectionOf('sponsorship_not_payable');
    }
    const rejection = await payabilityRejectionOf(record, now, {
      store: this.store,
      eligibleProducts: this.eligibleProducts,
    });
    return rejection === undefined
      ? { kind: 'available', offer: offerOf(record) }
      : rejectionOf(rejection);
  }
}
