import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  lt,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { userLifecycleEvents } from '../../../db/schema/identity/user-lifecycle-events.ts';
import { userLifecycleHandlerRuns } from '../../../db/schema/identity/user-lifecycle-handler-runs.ts';
import { users } from '../../../db/schema/identity/users.ts';
import type { UserLifecycleStore } from '../../core/identity/ports.ts';
import type { UserLifecycleEvent } from '../../core/identity/user-lifecycle.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';

const events = userLifecycleEvents;
const handlerRuns = userLifecycleHandlerRuns;

// D1のバインド変数の上限(100)から、識別子以外の条件と更新値に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

// イベントの1行は9個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const EVENT_ROWS_PER_STATEMENT = 10;

const STORED_EVENT_COLUMNS = {
  id: events.id,
  userId: events.userId,
  type: events.type,
  occurredAt: events.occurredAt,
  status: events.status,
  dispatchCount: events.dispatchCount,
  lastDispatchedAt: events.lastDispatchedAt,
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function uniqueOf(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

// 部分一意索引と同じ条件の値を埋め込み、物理削除の開始のイベントの有無を索引で判定させる
function purgeNotStarted(): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${events} WHERE ${events.userId} = ${users.id} AND ${events.type} = 'purge_due')`;
}

function withdrawnBefore(deletedBefore: Date): SQL | undefined {
  return and(isNotNull(users.deletedAt), lt(users.deletedAt, deletedBefore));
}

export function createUserLifecycleStore(
  db: Database,
  ids: IdGenerator,
): UserLifecycleStore {
  // 分割した文を1つの一括実行にまとめ、途中で失敗した場合に一部の記録だけが変わった状態を残さない
  async function runAll<T extends BatchItem<'sqlite'>>(
    statements: readonly T[],
  ) {
    const [first, ...rest] = statements;
    if (first === undefined) {
      return [];
    }
    return db.batch([first, ...rest]);
  }

  return {
    async findEvent(eventId) {
      const [row] = await db
        .select(STORED_EVENT_COLUMNS)
        .from(events)
        .where(eq(events.id, eventId));
      return row;
    },

    async findOldestPending(userId) {
      const [row] = await db
        .select(STORED_EVENT_COLUMNS)
        .from(events)
        .where(and(eq(events.userId, userId), eq(events.status, 'pending')))
        .orderBy(asc(events.occurredAt), asc(events.id))
        .limit(1);
      return row;
    },

    async completedHandlers(eventId) {
      const rows = await db
        .select({ handlerName: handlerRuns.handlerName })
        .from(handlerRuns)
        .where(eq(handlerRuns.eventId, eventId));
      return new Set(rows.map((row) => row.handlerName));
    },

    async markHandlerCompleted(eventId, handlerName, at) {
      await db
        .insert(handlerRuns)
        .values({
          id: ids.generate(),
          eventId,
          handlerName,
          completedAt: at,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing({
          target: [handlerRuns.eventId, handlerRuns.handlerName],
        });
    },

    async markEventCompleted(eventId, at) {
      await db
        .update(events)
        .set({ status: 'completed', completedAt: at, updatedAt: at })
        .where(and(eq(events.id, eventId), eq(events.status, 'pending')));
    },

    async listStalePending(dispatchedBefore, limit) {
      return db
        .select(STORED_EVENT_COLUMNS)
        .from(events)
        .where(
          and(
            eq(events.status, 'pending'),
            lt(events.lastDispatchedAt, dispatchedBefore),
          ),
        )
        .orderBy(asc(events.lastDispatchedAt), asc(events.id))
        .limit(limit);
    },

    async markRedispatched(eventIds, at) {
      await runAll(
        chunk(uniqueOf(eventIds), IDS_PER_STATEMENT).map((page) =>
          db
            .update(events)
            .set({
              dispatchCount: sql`${events.dispatchCount} + 1`,
              lastDispatchedAt: at,
              updatedAt: at,
            })
            .where(and(inArray(events.id, page), eq(events.status, 'pending'))),
        ),
      );
    },

    // 物理削除の開始のイベントの部分一意索引(利用者ごとに1件)に当たった行を無視し、同じ日に2回実行しても1件にする。
    // DrizzleのonConflictDoNothingは衝突の対象のWHEREをDO NOTHINGの後に出力しSQLiteの構文に合わないため、対象を指定しない
    async createPurgeDueEvents(userIds, at) {
      const rows = uniqueOf(userIds).map((userId) => ({
        id: ids.generate(),
        userId,
        type: 'purge_due' as const,
        occurredAt: at,
        status: 'pending' as const,
        dispatchCount: 1,
        lastDispatchedAt: at,
        createdAt: at,
        updatedAt: at,
      }));
      const pages = await runAll(
        chunk(rows, EVENT_ROWS_PER_STATEMENT).map((page) =>
          db.insert(events).values(page).onConflictDoNothing().returning({
            id: events.id,
            userId: events.userId,
            type: events.type,
            occurredAt: events.occurredAt,
          }),
        ),
      );
      const created = new Map<string, UserLifecycleEvent>(
        pages.flat().map((event) => [event.id, event]),
      );
      return rows.flatMap((row) => created.get(row.id) ?? []);
    },

    async listPurgeCandidates(deletedBefore, limit) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(withdrawnBefore(deletedBefore), purgeNotStarted()))
        .orderBy(asc(users.deletedAt), asc(users.id))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    async countOverduePurges(deletedBefore) {
      const [row] = await db
        .select({ overdue: count() })
        .from(users)
        .where(withdrawnBefore(deletedBefore));
      return row?.overdue ?? 0;
    },
  };
}
