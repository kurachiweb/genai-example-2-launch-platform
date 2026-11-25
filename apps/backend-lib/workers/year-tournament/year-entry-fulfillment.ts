import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import type {
  YearCalendar,
  YearEntryRecord,
  YearEntryStore,
} from '../../core/year-tournament/ports.ts';
import { GRANTABLE_STATUSES } from '../../core/year-tournament/year-entry-rules.ts';
import type { YearSchedule } from '../../core/year-tournament/year-schedule.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
} from '../payments/fulfillment-contract.ts';
import { yearEntryNotFrozen } from './d1-year-entry-store.ts';

const REJECTED: FulfillmentPlan = Object.freeze({
  kind: 'reject',
  reason: 'ineligible',
});

const GRANTABLE: ReadonlySet<YearEntryRecord['status']> = new Set(
  GRANTABLE_STATUSES,
);

interface GrantableEntry {
  readonly entry: YearEntryRecord;
  readonly productId: string;
  readonly schedule: YearSchedule;
}

// 準備から確定までの間に資格が変わるか凍結されると、状態がNULLになりNOT NULL制約の違反で一括の書き込み全体が取り消される。決済の機能はprepareを呼び直して拒否する
function grantStatement(
  db: Database,
  entryId: string,
  purchase: FulfillablePurchase,
): BatchItem<'sqlite'> {
  const stillGrantable = and(
    inArray(yearTournamentEntries.status, GRANTABLE_STATUSES),
    yearEntryNotFrozen(db),
  );
  return db
    .update(yearTournamentEntries)
    .set({
      status: sql<'entitled'>`case when ${stillGrantable} then 'entitled' else null end`,
      entitlementSource: 'payment',
      purchaseId: purchase.purchaseId,
      entitledAt: purchase.paidAt,
      updatedAt: purchase.paidAt,
    })
    .where(eq(yearTournamentEntries.id, entryId));
}

export class YearEntryFulfillment implements PurchaseFulfillment {
  constructor(
    private readonly store: YearEntryStore,
    private readonly calendar: YearCalendar,
    private readonly products: ProductDirectory,
  ) {}

  // 決済の機能は反映の時刻を支払いの時刻(paidAt)として渡すため、paidAtを反映の時刻として扱う
  async prepare(
    purchase: FulfillablePurchase,
    db: Database,
  ): Promise<FulfillmentPlan> {
    const grantable = await this.grantableEntryOf(purchase);
    if (grantable === undefined) {
      return REJECTED;
    }
    if (await this.hasNewerLaunchAfterDeadline(grantable, purchase.paidAt)) {
      return REJECTED;
    }
    return {
      kind: 'fulfill',
      statements: [grantStatement(db, grantable.entry.entryId, purchase)],
    };
  }

  private async grantableEntryOf(
    purchase: FulfillablePurchase,
  ): Promise<GrantableEntry | undefined> {
    const { targetId } = purchase;
    if (targetId === null) {
      return undefined;
    }
    const entry = (await this.store.findByLaunches([targetId])).get(targetId);
    if (
      entry === undefined ||
      entry.ownerUserId !== purchase.userId ||
      entry.productId === null ||
      !GRANTABLE.has(entry.status)
    ) {
      return undefined;
    }
    // 対象年が凍結済みならlate
    const target = await this.calendar.resolveAward(
      entry.awardedDate,
      purchase.paidAt,
    );
    if (target.kind === 'late') {
      return undefined;
    }
    const { productId } = entry;
    // 非公開化と停止は組み合わせ決定の分類で除外するため、ここでは論理削除だけを拒否する
    const products = await this.products.findSummaries(
      [productId],
      'not-deleted',
    );
    return products.has(productId)
      ? { entry, productId, schedule: target.year.schedule }
      : undefined;
  }

  // 決済期限で再ローンチの禁止が解けるため、期限の後に予約された新しいローンチと参加資格が並ばないよう、期限の後の反映だけを拒否する
  private async hasNewerLaunchAfterDeadline(
    { entry, productId, schedule }: GrantableEntry,
    reflectedAt: Date,
  ): Promise<boolean> {
    if (reflectedAt <= schedule.deadlineAt) {
      return false;
    }
    const launches =
      (await this.products.listLaunches([productId], reflectedAt)).get(
        productId,
      ) ?? [];
    return launches.some(
      (launch) =>
        launch.status !== 'canceled' && launch.launchDate > entry.launchDate,
    );
  }
}
