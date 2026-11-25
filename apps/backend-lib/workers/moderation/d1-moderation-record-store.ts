import { and, asc, eq, inArray, lt, lte, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { moderationActions } from '../../../db/schema/moderation/moderation-actions.ts';
import {
  MODERATION_ACTION_DEFINITIONS,
  type ModerationAction,
} from '../../../common-lib/moderation/moderation-actions.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  LatestModeration,
  ModerationRecord,
  ModerationRecordStore,
  NewModerationRecord,
} from '../../core/moderation/ports.ts';
import type { ModerationRecordStatements } from './moderation-record-statements.ts';

const MAX_BOUND_PARAMETERS = 100;

const MAX_TARGETS_PER_QUERY = 90;

type ModerationRow = typeof moderationActions.$inferSelect;

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function recordOf(row: ModerationRow): ModerationRecord {
  return {
    id: row.id,
    action: row.action,
    targetId: row.targetId,
    subjectUserId: row.subjectUserId,
    productId: row.productId,
    operatorAdminId: row.operatorAdminId,
    reason: row.reason,
    lifecycleEventId: row.lifecycleEventId,
    occurredAt: row.occurredAt,
    noticeStatus: row.noticeStatus,
    noticeRequestedAt: row.noticeRequestedAt,
  };
}

@injectable()
export class D1ModerationRecordStore
  implements ModerationRecordStore, ModerationRecordStatements
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  insertStatement(record: NewModerationRecord): BatchItem<'sqlite'> {
    return this.db.insert(moderationActions).values({
      ...record,
      targetKind: MODERATION_ACTION_DEFINITIONS[record.action].targetKind,
      noticeRequestedAt: null,
      createdAt: record.occurredAt,
      updatedAt: record.occurredAt,
    });
  }

  async find(id: string): Promise<ModerationRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, id))
      .limit(1);
    return row === undefined ? undefined : recordOf(row);
  }

  async latestFor(input: {
    readonly targetIds: readonly string[];
    readonly actions: readonly ModerationAction[];
  }): Promise<ReadonlyMap<string, LatestModeration>> {
    const actions = [...new Set(input.actions)];
    const targetKinds = [
      ...new Set(
        actions.map(
          (action) => MODERATION_ACTION_DEFINITIONS[action].targetKind,
        ),
      ),
    ];
    const targetIds = [...new Set(input.targetIds)];
    if (targetIds.length === 0 || actions.length === 0) {
      return new Map();
    }
    // 対象のIDに加えて種類と対象の種類も同じ文のバインド変数になるため、その分だけ1文の対象を減らす
    const targetsPerQuery = Math.min(
      MAX_TARGETS_PER_QUERY,
      MAX_BOUND_PARAMETERS - actions.length - targetKinds.length,
    );
    const [first, ...rest] = chunksOf(targetIds, targetsPerQuery).map((chunk) =>
      this.latestQuery(chunk, actions, targetKinds),
    );
    if (first === undefined) {
      return new Map();
    }
    const results = await this.db.batch([first, ...rest]);
    return new Map(
      results.flat().map((row) => [
        row.targetId,
        {
          action: row.action,
          reason: row.reason,
          occurredAt: row.occurredAt,
        },
      ]),
    );
  }

  async listPendingNotices(input: {
    readonly occurredBefore: Date;
    readonly limit: number;
  }): Promise<readonly ModerationRecord[]> {
    const rows = await this.db
      .select()
      .from(moderationActions)
      .where(
        and(
          eq(moderationActions.noticeStatus, 'pending'),
          lte(moderationActions.occurredAt, input.occurredBefore),
        ),
      )
      .orderBy(asc(moderationActions.occurredAt), asc(moderationActions.id))
      .limit(input.limit);
    return rows.map(recordOf);
  }

  // 依頼待ちを条件にした1文の更新にして、同じ記録の通知を2回以上依頼しない
  async markNotice(input: {
    readonly id: string;
    readonly from: 'pending';
    readonly to: 'requested' | 'skipped';
    readonly at: Date;
  }): Promise<boolean> {
    const result = await this.db
      .update(moderationActions)
      .set({
        noticeStatus: input.to,
        noticeRequestedAt: input.to === 'requested' ? input.at : null,
        updatedAt: input.at,
      })
      .where(
        and(
          eq(moderationActions.id, input.id),
          eq(moderationActions.noticeStatus, input.from),
        ),
      );
    return result.meta.changes > 0;
  }

  async eraseBySubjectUser(
    userId: string,
    limit: number,
  ): Promise<{ readonly remaining: boolean }> {
    return this.eraseMatching(
      eq(moderationActions.subjectUserId, userId),
      limit,
    );
  }

  async eraseByProduct(
    productId: string,
    limit: number,
  ): Promise<{ readonly remaining: boolean }> {
    return this.eraseMatching(
      eq(moderationActions.productId, productId),
      limit,
    );
  }

  async eraseOccurredBefore(threshold: Date, limit: number): Promise<number> {
    const result = await this.db
      .delete(moderationActions)
      .where(
        inArray(
          moderationActions.id,
          this.db
            .select({ id: moderationActions.id })
            .from(moderationActions)
            .where(lt(moderationActions.occurredAt, threshold))
            .orderBy(
              asc(moderationActions.occurredAt),
              asc(moderationActions.id),
            )
            .limit(limit),
        ),
      );
    return result.meta.changes;
  }

  private latestQuery(
    targetIds: readonly string[],
    actions: readonly ModerationAction[],
    targetKinds: readonly ModerationRow['targetKind'][],
  ) {
    const ranked = this.db
      .select({
        targetId: moderationActions.targetId,
        action: moderationActions.action,
        reason: moderationActions.reason,
        occurredAt: moderationActions.occurredAt,
        // 同じ日時の記録は後に作った(IDの大きい)記録を最新とする
        rank: sql<number>`row_number() over (partition by ${moderationActions.targetId} order by ${moderationActions.occurredAt} desc, ${moderationActions.id} desc)`.as(
          'rank',
        ),
      })
      .from(moderationActions)
      .where(
        and(
          inArray(moderationActions.targetKind, targetKinds),
          inArray(moderationActions.targetId, targetIds),
          inArray(moderationActions.action, actions),
        ),
      )
      .as('ranked');
    return this.db
      .select({
        targetId: ranked.targetId,
        action: ranked.action,
        reason: ranked.reason,
        occurredAt: ranked.occurredAt,
      })
      .from(ranked)
      .where(sql`${ranked.rank} = 1`);
  }

  private async eraseMatching(
    condition: SQL,
    limit: number,
  ): Promise<{ readonly remaining: boolean }> {
    const [, left] = await this.db.batch([
      this.db
        .delete(moderationActions)
        .where(
          inArray(
            moderationActions.id,
            this.db
              .select({ id: moderationActions.id })
              .from(moderationActions)
              .where(condition)
              .limit(limit),
          ),
        ),
      this.db
        .select({ id: moderationActions.id })
        .from(moderationActions)
        .where(condition)
        .limit(1),
    ]);
    return { remaining: left.length > 0 };
  }
}
