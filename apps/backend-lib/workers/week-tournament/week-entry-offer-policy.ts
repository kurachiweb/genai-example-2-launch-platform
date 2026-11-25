import { PURCHASE_KIND_LABELS } from '../../../common-lib/payments/purchase-kinds.ts';
import { formatWeekPeriodLabel } from '../../../common-lib/tournament/week-period.ts';
import type {
  PurchaseOffer,
  PurchaseOfferDecision,
  PurchaseOfferPolicy,
  PurchaseOfferRequest,
} from '../../core/payments/purchase-kind-contract.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import { toBusinessDateTime } from '../../core/time/business-time.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import {
  GRANTABLE_STATUSES,
  ultrasExemptionPeriodOf,
} from '../../core/week-tournament/week-entry-rules.ts';
import { WEEK_ENTRY_PRICE_LOOKUP_KEY } from '../../core/week-tournament/week-schedule.ts';

export type WeekEntryOfferRejectionCode =
  | 'week_entry_not_found'
  | 'week_entry_already_entitled'
  | 'week_entry_closed'
  | 'week_entry_product_unavailable'
  | 'week_entry_exempt';

export const WEEK_ENTRY_OFFER_REJECTION_MESSAGES: Readonly<
  Record<WeekEntryOfferRejectionCode, string>
> = Object.freeze({
  week_entry_not_found: 'このWeekトーナメントの参加枠は見つかりません。',
  week_entry_already_entitled:
    'このプロダクトはWeekトーナメントの参加資格を得ています。',
  week_entry_closed: 'Weekトーナメントの参加受付は終了しました。',
  week_entry_product_unavailable:
    'このプロダクトは現在Weekトーナメントに参加できません。',
  week_entry_exempt: 'Ultrasの特典により参加費は免除されます。',
});

const WEEK_ENTRY_CHECKOUT_NOTES = Object.freeze([
  '組み合わせ決定前にプロダクトを削除・退会すると参加資格を失い、参加費は自動で全額返金されます',
  'トーナメントの不戦勝・不戦敗・両者敗北による返金はありません',
]);

const ENTITLED_STATUSES: ReadonlySet<WeekEntryRecord['status']> = new Set([
  'entitled',
  'drawn',
]);

const GRANTABLE: ReadonlySet<WeekEntryRecord['status']> = new Set(
  GRANTABLE_STATUSES,
);

const TWO_DIGIT_WIDTH = 2;

function rejectionOf(code: WeekEntryOfferRejectionCode): PurchaseOfferDecision {
  return {
    kind: 'unavailable',
    code,
    message: WEEK_ENTRY_OFFER_REJECTION_MESSAGES[code],
  };
}

// 購入に保存して購入確認メールにも載せるため、閲覧の年に依らず年を付ける
function formatDrawTime(drawAt: Date): string {
  const { date, hour, minute } = toBusinessDateTime(drawAt);
  const [year, month, day] = date.split('-').map(Number);
  const time = `${String(hour).padStart(TWO_DIGIT_WIDTH, '0')}:${String(minute).padStart(TWO_DIGIT_WIDTH, '0')}`;
  return `${String(year)}年${String(month)}月${String(day)}日${time}(UTC-08:00)`;
}

function offerOf(
  launchId: string,
  { window }: WeekTournamentRecord,
): PurchaseOffer {
  return Object.freeze({
    priceLookupKey: WEEK_ENTRY_PRICE_LOOKUP_KEY,
    quantity: 1,
    relatedId: launchId,
    exclusivityKey: `launch:${launchId}:week`,
    deadlineAt: window.deadlineAt,
    acceptUntil: window.acceptUntil,
    fulfillableUntil: window.drawAt,
    summary: Object.freeze({
      itemName: PURCHASE_KIND_LABELS.week_tournament_entry,
      quantityLabel: `1件(${formatWeekPeriodLabel(window.weekStart)}のWeekトーナメント)`,
      serviceTiming: `決済の反映後ただちに参加資格を付与し、${formatDrawTime(window.drawAt)}に組み合わせを決定します`,
      additionalNotes: WEEK_ENTRY_CHECKOUT_NOTES,
    }),
    requiresBotVerification: false,
  });
}

export class WeekEntryOfferPolicy implements PurchaseOfferPolicy {
  constructor(
    private readonly store: WeekTournamentStore,
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
      return rejectionOf('week_entry_not_found');
    }
    const entry = (await this.store.findEntriesByLaunch([targetId])).get(
      targetId,
    );
    if (
      entry === undefined ||
      entry.ownerUserId !== userId ||
      entry.productId === null
    ) {
      return rejectionOf('week_entry_not_found');
    }
    if (ENTITLED_STATUSES.has(entry.status)) {
      return rejectionOf('week_entry_already_entitled');
    }
    const tournament = await this.store.findTournament(entry.tournamentId);
    if (tournament === undefined) {
      throw new Error(
        `参加の枠の週のトーナメントがありません: ${entry.tournamentId}`,
      );
    }
    if (!GRANTABLE.has(entry.status) || tournament.drawStartedAt !== null) {
      return rejectionOf('week_entry_closed');
    }
    const product = (
      await this.products.findSummaries([entry.productId], 'not-deleted')
    ).get(entry.productId);
    if (product?.visible !== true) {
      return rejectionOf('week_entry_product_unavailable');
    }
    const period = ultrasExemptionPeriodOf(
      entry.wonAt,
      tournament.window.deadlineAt,
      now,
    );
    if (
      period !== null &&
      (await this.entitlements.wasEntitledDuring(
        userId,
        period.from,
        period.to,
      ))
    ) {
      return rejectionOf('week_entry_exempt');
    }
    return { kind: 'available', offer: offerOf(targetId, tournament) };
  }
}
