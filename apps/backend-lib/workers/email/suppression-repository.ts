import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import type { Database } from '../../../db/client.ts';
import { emailSuppressions } from '../../../db/schema/email/email-suppressions.ts';
import { toMatchingKey } from '../../core/email/email-address.ts';
import type {
  SuppressionList,
  SuppressionRecorder,
  SuppressionStatus,
} from '../../core/email/ports.ts';
import type { SuppressionState } from '../../core/email/suppression-policy.ts';
import type { Clock } from '../../core/time/clock.ts';

export interface SuppressionStore {
  deleteByKeys(keys: readonly string[]): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
  // 照合キーの昇順で返す。afterKeyには前のページの最後の照合キーを渡す
  listLastEventBefore(
    cutoff: Date,
    limit: number,
    afterKey: string | undefined,
  ): Promise<readonly string[]>;
}

export type SuppressionRepository = SuppressionList &
  SuppressionRecorder &
  SuppressionStore;

// D1のバインド変数の上限(100)から、照合キー以外に使う変数の分を残す
const KEYS_PER_STATEMENT = 90;

function uniqueKeys(addresses: readonly string[]): string[] {
  return [...new Set(addresses.map(toMatchingKey))];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function excluded(column: SQLiteColumn): SQL {
  return sql.raw(`excluded."${column.name}"`);
}

// 同時刻の契機の理由を決める順位で、抑止の方針のmergeSuppressionと同じ順に並べる
function reasonStrength(reason: SQL | SQLiteColumn): SQL {
  return sql`(CASE ${reason} WHEN 'complaint' THEN 3 WHEN 'hard_bounce' THEN 2 ELSE 1 END)`;
}

// mergeSuppressionと同値の合成を競合時更新の式で表す。SET句の列の参照はすべて更新前の行の値になる
function mergedOnConflict(updatedAt: Date) {
  const current = emailSuppressions;
  const isIncomingLater = sql`(${excluded(current.lastEventAt)} > ${current.lastEventAt} OR (${excluded(current.lastEventAt)} = ${current.lastEventAt} AND ${reasonStrength(excluded(current.lastReason))} > ${reasonStrength(current.lastReason)}))`;
  return {
    lastReason: sql`CASE WHEN ${isIncomingLater} THEN ${excluded(current.lastReason)} ELSE ${current.lastReason} END`,
    lastEventAt: sql`max(${current.lastEventAt}, ${excluded(current.lastEventAt)})`,
    // SQLiteの複数引数のmaxは引数にNULLがあればNULLを返すため、期限なしが勝つ規則と一致する
    expiresAt: sql`max(${current.expiresAt}, ${excluded(current.expiresAt)})`,
    updatedAt,
  };
}

function isActiveAt(now: Date): SQL | undefined {
  return or(
    isNull(emailSuppressions.expiresAt),
    gt(emailSuppressions.expiresAt, now),
  );
}

export function createSuppressionRepository(
  db: Database,
  clock: Clock,
): SuppressionRepository {
  return {
    async getStatus(address): Promise<SuppressionStatus> {
      const [row] = await db
        .select({
          lastReason: emailSuppressions.lastReason,
          lastEventAt: emailSuppressions.lastEventAt,
          expiresAt: emailSuppressions.expiresAt,
        })
        .from(emailSuppressions)
        .where(
          and(
            eq(emailSuppressions.address, toMatchingKey(address)),
            isActiveAt(clock.now()),
          ),
        );
      if (row === undefined) {
        return { suppressed: false };
      }
      const suppressionState: SuppressionState = row;
      return { suppressed: true, ...suppressionState };
    },

    async findSuppressed(addresses) {
      const now = clock.now();
      const pages = await Promise.all(
        chunk(uniqueKeys(addresses), KEYS_PER_STATEMENT).map((keys) =>
          db
            .select({ address: emailSuppressions.address })
            .from(emailSuppressions)
            .where(
              and(inArray(emailSuppressions.address, keys), isActiveAt(now)),
            ),
        ),
      );
      return new Set(pages.flat().map((row) => toMatchingKey(row.address)));
    },

    async record(address, state) {
      const now = clock.now();
      await db
        .insert(emailSuppressions)
        .values({
          address: toMatchingKey(address),
          lastReason: state.lastReason,
          lastEventAt: state.lastEventAt,
          expiresAt: state.expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: emailSuppressions.address,
          set: mergedOnConflict(now),
        });
    },

    async deleteByKeys(keys) {
      const pages = await Promise.all(
        chunk(uniqueKeys(keys), KEYS_PER_STATEMENT).map((page) =>
          db
            .delete(emailSuppressions)
            .where(inArray(emailSuppressions.address, page))
            .returning({ address: emailSuppressions.address }),
        ),
      );
      return pages.reduce((total, deleted) => total + deleted.length, 0);
    },

    async deleteExpired(now) {
      const deleted = await db
        .delete(emailSuppressions)
        .where(
          and(
            isNotNull(emailSuppressions.expiresAt),
            lte(emailSuppressions.expiresAt, now),
          ),
        )
        .returning({ address: emailSuppressions.address });
      return deleted.length;
    },

    async listLastEventBefore(cutoff, limit, afterKey) {
      const rows = await db
        .select({ address: emailSuppressions.address })
        .from(emailSuppressions)
        .where(
          and(
            lt(emailSuppressions.lastEventAt, cutoff),
            afterKey === undefined
              ? undefined
              : gt(emailSuppressions.address, afterKey),
          ),
        )
        .orderBy(asc(emailSuppressions.address))
        .limit(limit);
      return rows.map((row) => row.address);
    },
  };
}
