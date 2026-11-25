import { PURCHASE_KIND_LABELS } from '../../../common-lib/payments/purchase-kinds.ts';
import type {
  PurchaseOffer,
  PurchaseOfferDecision,
  PurchaseOfferPolicy,
  PurchaseOfferRequest,
} from '../../core/payments/purchase-kind-contract.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../core/time/business-time.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import type {
  YearCalendar,
  YearEntryRecord,
  YearEntryStore,
} from '../../core/year-tournament/ports.ts';
import { formatBusinessDateWithWeekdayLabel } from '../../../common-lib/time/business-date-label.ts';
import { GRANTABLE_STATUSES } from '../../core/year-tournament/year-entry-rules.ts';
import {
  YEAR_ENTRY_PRICE_LOOKUP_KEY,
  type YearSchedule,
} from '../../core/year-tournament/year-schedule.ts';

export type YearEntryOfferRejectionCode =
  | 'year_entry_not_found'
  | 'year_entry_already_entitled'
  | 'year_entry_closed'
  | 'year_entry_product_unavailable'
  | 'year_entry_exempt';

export const YEAR_ENTRY_OFFER_REJECTION_MESSAGES: Readonly<
  Record<YearEntryOfferRejectionCode, string>
> = Object.freeze({
  year_entry_not_found: 'このYearトーナメントの参加枠は見つかりません。',
  year_entry_already_entitled:
    'このプロダクトはYearトーナメントの参加資格を得ています。',
  year_entry_closed: 'Yearトーナメントの参加受付は終了しました。',
  year_entry_product_unavailable:
    'このプロダクトは現在Yearトーナメントに参加できません。',
  year_entry_exempt: 'Ultrasの特典により参加費は免除されます。',
});

const YEAR_ENTRY_CHECKOUT_NOTES = Object.freeze([
  '組み合わせ決定前にプロダクトを削除・退会すると参加資格を失い、参加費は自動で全額返金されます',
  'トーナメントの不戦勝・不戦敗・両者敗北による返金はありません',
  '決勝実施日は変更期限(決勝の7日前)まで変わることがあり、変更後の日程で行います',
]);

const ENTITLED_STATUSES: ReadonlySet<YearEntryRecord['status']> = new Set([
  'entitled',
  'drawn',
]);

const GRANTABLE: ReadonlySet<YearEntryRecord['status']> = new Set(
  GRANTABLE_STATUSES,
);

const TWO_DIGIT_WIDTH = 2;

function rejectionOf(code: YearEntryOfferRejectionCode): PurchaseOfferDecision {
  return {
    kind: 'unavailable',
    code,
    message: YEAR_ENTRY_OFFER_REJECTION_MESSAGES[code],
  };
}

function formatDate(date: BusinessDate): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${String(year)}年${String(month)}月${String(day)}日`;
}

// 購入に保存して購入確認メールにも載せるため、閲覧の年に依らず年を付ける
function formatDrawTime(drawAt: Date): string {
  const { date, hour, minute } = toBusinessDateTime(drawAt);
  const time = `${String(hour).padStart(TWO_DIGIT_WIDTH, '0')}:${String(minute).padStart(TWO_DIGIT_WIDTH, '0')}`;
  return `${formatDate(date)}${time}(UTC-08:00)`;
}

function offerOf(launchId: string, schedule: YearSchedule): PurchaseOffer {
  return Object.freeze({
    priceLookupKey: YEAR_ENTRY_PRICE_LOOKUP_KEY,
    quantity: 1,
    relatedId: launchId,
    exclusivityKey: `launch:${launchId}:year`,
    deadlineAt: schedule.deadlineAt,
    acceptUntil: schedule.acceptUntil,
    fulfillableUntil: schedule.drawAt,
    summary: Object.freeze({
      itemName: PURCHASE_KIND_LABELS.year_tournament_entry,
      quantityLabel: `1件(${String(schedule.year)}年のYearトーナメント)`,
      serviceTiming: `決済の反映後ただちに参加資格を付与し、${formatDrawTime(schedule.drawAt)}に組み合わせを決定します。決勝は${formatBusinessDateWithWeekdayLabel(schedule.finalDate)}です`,
      additionalNotes: YEAR_ENTRY_CHECKOUT_NOTES,
    }),
    requiresBotVerification: false,
  });
}

export class YearEntryOfferPolicy implements PurchaseOfferPolicy {
  constructor(
    private readonly store: YearEntryStore,
    private readonly calendar: YearCalendar,
    private readonly products: ProductDirectory,
    private readonly entitlements: UltrasEntitlements,
  ) {}

  // 受付期限の後の開始は決済の機能が期限で拒否するため、ここでは受付期限を見ない
  async describe({
    userId,
    targetId,
    now,
  }: PurchaseOfferRequest): Promise<PurchaseOfferDecision> {
    if (targetId === null) {
      return rejectionOf('year_entry_not_found');
    }
    const entry = (await this.store.findByLaunches([targetId])).get(targetId);
    if (
      entry === undefined ||
      entry.ownerUserId !== userId ||
      entry.productId === null
    ) {
      return rejectionOf('year_entry_not_found');
    }
    if (ENTITLED_STATUSES.has(entry.status)) {
      return rejectionOf('year_entry_already_entitled');
    }
    if (!GRANTABLE.has(entry.status)) {
      return rejectionOf('year_entry_closed');
    }
    // 対象年が凍結済みならlate(組み合わせ決定の後に届いたWeek優勝の枠を含む)
    const target = await this.calendar.resolveAward(entry.awardedDate, now);
    if (target.kind === 'late') {
      return rejectionOf('year_entry_closed');
    }
    const product = (
      await this.products.findSummaries([entry.productId], 'not-deleted')
    ).get(entry.productId);
    if (product?.visible !== true) {
      return rejectionOf('year_entry_product_unavailable');
    }
    const { schedule } = target.year;
    if (await this.wasExempt(userId, entry.awardedAt, schedule, now)) {
      return rejectionOf('year_entry_exempt');
    }
    return { kind: 'available', offer: offerOf(targetId, schedule) };
  }

  private async wasExempt(
    userId: string,
    awardedAt: Date,
    schedule: YearSchedule,
    now: Date,
  ): Promise<boolean> {
    const to =
      now.getTime() < schedule.deadlineAt.getTime() ? now : schedule.deadlineAt;
    if (awardedAt.getTime() > to.getTime()) {
      return false;
    }
    return this.entitlements.wasEntitledDuring(userId, awardedAt, to);
  }
}
