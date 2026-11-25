import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import { GRANTABLE_STATUSES } from '../../core/week-tournament/week-entry-rules.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
} from '../payments/fulfillment-contract.ts';

const REJECTED: FulfillmentPlan = Object.freeze({
  kind: 'reject',
  reason: 'ineligible',
});

const GRANTABLE: ReadonlySet<WeekEntryRecord['status']> = new Set(
  GRANTABLE_STATUSES,
);

interface GrantableEntry {
  readonly entry: WeekEntryRecord;
  readonly productId: string;
  readonly tournament: WeekTournamentRecord;
}

// 準備から確定までの間に資格が変わるか凍結されると、状態がNULLになりNOT NULL制約の違反で一括の書き込み全体が取り消される。決済の機能はprepareを呼び直して拒否する
function grantStatement(
  db: Database,
  entryId: string,
  purchase: FulfillablePurchase,
): BatchItem<'sqlite'> {
  const stillGrantable = and(
    inArray(weekTournamentEntries.status, GRANTABLE_STATUSES),
    inArray(
      weekTournamentEntries.tournamentId,
      db
        .select({ id: weekTournaments.id })
        .from(weekTournaments)
        .where(isNull(weekTournaments.drawStartedAt)),
    ),
  );
  return db
    .update(weekTournamentEntries)
    .set({
      status: sql<'entitled'>`case when ${stillGrantable} then 'entitled' else null end`,
      entitlementSource: 'payment',
      purchaseId: purchase.purchaseId,
      entitledAt: purchase.paidAt,
      updatedAt: purchase.paidAt,
    })
    .where(eq(weekTournamentEntries.id, entryId));
}

export class WeekEntryFulfillment implements PurchaseFulfillment {
  constructor(
    private readonly store: WeekTournamentStore,
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
    const entry = (await this.store.findEntriesByLaunch([targetId])).get(
      targetId,
    );
    if (
      entry === undefined ||
      entry.ownerUserId !== purchase.userId ||
      entry.productId === null ||
      !GRANTABLE.has(entry.status)
    ) {
      return undefined;
    }
    const tournament = await this.store.findTournament(entry.tournamentId);
    if (tournament === undefined) {
      throw new Error(
        `参加の枠の週のトーナメントがありません: ${entry.tournamentId}`,
      );
    }
    if (tournament.drawStartedAt !== null) {
      return undefined;
    }
    const { productId } = entry;
    // 非公開化と停止は組み合わせ決定の分類で除外するため、ここでは論理削除だけを拒否する
    const products = await this.products.findSummaries(
      [productId],
      'not-deleted',
    );
    return products.has(productId)
      ? { entry, productId, tournament }
      : undefined;
  }

  // 決済期限で再ローンチの禁止が解けるため、期限の後に予約された新しいローンチとトーナメントが並行しないよう、期限の後の反映だけを拒否する
  private async hasNewerLaunchAfterDeadline(
    { entry, productId, tournament }: GrantableEntry,
    reflectedAt: Date,
  ): Promise<boolean> {
    if (reflectedAt <= tournament.window.deadlineAt) {
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
