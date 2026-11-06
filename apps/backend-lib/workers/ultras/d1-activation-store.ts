import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { ultrasActivations } from '../../../db/schema/ultras/ultras-activations.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  ActivationStore,
  UltrasActivationRow,
} from '../../core/ultras/ports.ts';
import type { ActivationStatements } from './statement-contracts.ts';

type ActivationTableRow = typeof ultrasActivations.$inferSelect;

const activations = ultrasActivations;

function toRow(row: ActivationTableRow): UltrasActivationRow {
  return {
    id: row.id,
    userId: row.userId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    activatedAt: row.activatedAt,
    dispatchedAt: row.dispatchedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

@injectable()
export class D1ActivationStore
  implements ActivationStore, ActivationStatements
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findById(id: string): Promise<UltrasActivationRow | undefined> {
    return this.findOne(eq(activations.id, id));
  }

  async findByStripeId(
    stripeSubscriptionId: string,
  ): Promise<UltrasActivationRow | undefined> {
    return this.findOne(
      eq(activations.stripeSubscriptionId, stripeSubscriptionId),
    );
  }

  // 送り出し直しでも時刻を改め、次の送り出し直しの起点にする
  async markDispatched(id: string, at: Date): Promise<void> {
    await this.db
      .update(activations)
      .set({ dispatchedAt: at })
      .where(eq(activations.id, id));
  }

  // 同じ知らせの処理が重なっても最初の完了の時刻を保つ
  async markCompleted(id: string, at: Date): Promise<void> {
    await this.db
      .update(activations)
      .set({ completedAt: at })
      .where(and(eq(activations.id, id), isNull(activations.completedAt)));
  }

  async findUndispatched(input: {
    readonly createdBefore: Date;
    readonly redispatchBefore: Date;
    readonly limit: number;
  }): Promise<readonly UltrasActivationRow[]> {
    const rows = await this.db
      .select()
      .from(activations)
      .where(
        and(
          isNull(activations.completedAt),
          or(
            and(
              isNull(activations.dispatchedAt),
              lte(activations.createdAt, input.createdBefore),
            ),
            and(
              isNotNull(activations.dispatchedAt),
              lte(activations.dispatchedAt, input.redispatchBefore),
            ),
          ),
        ),
      )
      .orderBy(asc(activations.createdAt), asc(activations.id))
      .limit(input.limit);
    return rows.map(toRow);
  }

  // SQLiteのDELETEはLIMITを持たないため、上限の件数のIDを副問い合わせで絞って1つの文で消す
  async deleteCompletedBefore(threshold: Date, limit: number): Promise<number> {
    const expiredIds = this.db
      .select({ id: activations.id })
      .from(activations)
      .where(lte(activations.completedAt, threshold))
      .orderBy(asc(activations.completedAt), asc(activations.id))
      .limit(limit);
    const result = await this.db
      .delete(activations)
      .where(inArray(activations.id, expiredIds));
    return result.meta.changes;
  }

  insertIfAbsent(input: {
    readonly id: string;
    readonly userId: string;
    readonly stripeSubscriptionId: string;
    readonly activatedAt: Date;
  }): BatchItem<'sqlite'> {
    return this.db
      .insert(activations)
      .values(input)
      .onConflictDoNothing({ target: activations.stripeSubscriptionId });
  }

  deleteByUser(userId: string): BatchItem<'sqlite'> {
    return this.db.delete(activations).where(eq(activations.userId, userId));
  }

  private async findOne(
    condition: SQL,
  ): Promise<UltrasActivationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(activations)
      .where(condition)
      .limit(1);
    return row === undefined ? undefined : toRow(row);
  }
}
