import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { ultrasSubscriptions } from '../../../db/schema/ultras/ultras-subscriptions.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { SubscriptionSnapshot } from '../../core/ultras/entitlement-rules.ts';
import type {
  SubscriptionRow,
  SubscriptionStore,
} from '../../core/ultras/ports.ts';
import { ENDED_STRIPE_STATUSES } from '../../core/ultras/subscription-transition.ts';
import type { SubscriptionStatements } from './statement-contracts.ts';

type SubscriptionTableRow = typeof ultrasSubscriptions.$inferSelect;

type BenefitOverlap = Pick<
  SubscriptionRow,
  'userId' | 'startedAt' | 'benefitEndsAt'
>;

const subscriptions = ultrasSubscriptions;

// D1のバインド変数の上限(100)から、期間の両端の分を残す
const USERS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function toRow(row: SubscriptionTableRow): SubscriptionRow {
  return {
    id: row.id,
    stripeSubscriptionId: row.stripeSubscriptionId,
    userId: row.userId,
    purchaseId: row.purchaseId,
    ...stripeStateOf(row),
    startedAt: row.startedAt,
  };
}

// sinkが定期課金の状態の変化から書くStripe側の列。有効化が書く開始時刻・利用者・購入IDを含めない
function stripeStateOf(
  snapshot: SubscriptionSnapshot,
): Omit<SubscriptionSnapshot, 'startedAt'> {
  return {
    stripeStatus: snapshot.stripeStatus,
    cancelScheduled: snapshot.cancelScheduled,
    cancelAt: snapshot.cancelAt,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    endedAt: snapshot.endedAt,
    benefitEndsAt: snapshot.benefitEndsAt,
    benefitEndFixed: snapshot.benefitEndFixed,
    canceledAt: snapshot.canceledAt,
    cancellationSource: snapshot.cancellationSource,
    pendingCancellationSource: snapshot.pendingCancellationSource,
    pastDueSince: snapshot.pastDueSince,
  };
}

// 特典の継続期間[started_at, benefit_ends_at)が両端を含む期間[from, to]と重なる条件。時点の判定はfromとtoを同じ値にする
function overlapsPeriod(from: Date, to: Date): SQL | undefined {
  return and(
    isNotNull(subscriptions.startedAt),
    lte(subscriptions.startedAt, to),
    or(
      isNull(subscriptions.benefitEndsAt),
      gt(subscriptions.benefitEndsAt, from),
    ),
  );
}

@injectable()
export class D1SubscriptionStore
  implements SubscriptionStore, SubscriptionStatements
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findByStripeId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionRow | undefined> {
    return this.findOne(
      eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
    );
  }

  async findEntitledOverlapping(input: {
    readonly userId: string;
    readonly at: Date;
    readonly excludeStripeId?: string;
  }): Promise<SubscriptionRow | undefined> {
    return this.findOne(
      and(
        eq(subscriptions.userId, input.userId),
        overlapsPeriod(input.at, input.at),
        input.excludeStripeId === undefined
          ? undefined
          : ne(subscriptions.stripeSubscriptionId, input.excludeStripeId),
      ),
    );
  }

  async findOverlapping(input: {
    readonly userIds: readonly string[];
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly BenefitOverlap[]> {
    const pages = await Promise.all(
      chunk([...new Set(input.userIds)], USERS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            userId: subscriptions.userId,
            startedAt: subscriptions.startedAt,
            benefitEndsAt: subscriptions.benefitEndsAt,
          })
          .from(subscriptions)
          .where(
            and(
              inArray(subscriptions.userId, page),
              overlapsPeriod(input.from, input.to),
            ),
          )
          .orderBy(asc(subscriptions.userId), asc(subscriptions.startedAt)),
      ),
    );
    return pages.flat();
  }

  async findLatestActivated(
    userId: string,
  ): Promise<SubscriptionRow | undefined> {
    return this.findOne(
      and(eq(subscriptions.userId, userId), isNotNull(subscriptions.startedAt)),
    );
  }

  async findCancellable(userId: string): Promise<readonly SubscriptionRow[]> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          notInArray(subscriptions.stripeStatus, [...ENDED_STRIPE_STATUSES]),
        ),
      )
      .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id));
    return rows.map(toRow);
  }

  async markPendingCancellation(input: {
    readonly id: string;
    readonly source: 'suspension' | 'withdrawal';
  }): Promise<void> {
    await this.db
      .update(subscriptions)
      .set({ pendingCancellationSource: input.source })
      .where(eq(subscriptions.id, input.id));
  }

  upsertStripeState(input: {
    readonly row: SubscriptionRow;
  }): BatchItem<'sqlite'> {
    return this.db
      .insert(subscriptions)
      .values(input.row)
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: { ...stripeStateOf(input.row), updatedAt: new Date() },
      });
  }

  activate(input: {
    readonly id: string;
    readonly stripeSubscriptionId: string;
    readonly userId: string;
    readonly purchaseId: string;
    readonly startedAt: Date;
  }): BatchItem<'sqlite'> {
    const activation = {
      userId: input.userId,
      purchaseId: input.purchaseId,
      startedAt: input.startedAt,
    };
    return this.db
      .insert(subscriptions)
      .values({
        id: input.id,
        stripeSubscriptionId: input.stripeSubscriptionId,
        stripeStatus: 'active',
        cancelScheduled: false,
        benefitEndFixed: false,
        ...activation,
      })
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: { ...activation, updatedAt: new Date() },
      });
  }

  deleteByUser(userId: string): BatchItem<'sqlite'> {
    return this.db
      .delete(subscriptions)
      .where(eq(subscriptions.userId, userId));
  }

  // 複数の行が条件に合うときは開始時刻が最も遅い行を返す
  private async findOne(
    condition: SQL | undefined,
  ): Promise<SubscriptionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(condition)
      .orderBy(desc(subscriptions.startedAt), desc(subscriptions.id))
      .limit(1);
    return row === undefined ? undefined : toRow(row);
  }
}
