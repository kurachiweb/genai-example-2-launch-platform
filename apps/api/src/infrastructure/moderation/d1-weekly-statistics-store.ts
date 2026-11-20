import { and, asc, desc, eq, gte, or, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { moderationWeeklyStatistics } from '../../../db/schema/moderation/moderation-weekly-statistics.ts';
import { chunk } from '../../../lib/core/d1/statement-chunks.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type {
  WeeklyStatisticsRow,
  WeeklyStatisticsStore,
} from '../../application/moderation/ports.ts';

const WEEKLY_STATISTICS_COLUMNS = {
  weekStart: moderationWeeklyStatistics.weekStart,
  netRevenue: moderationWeeklyStatistics.netRevenue,
  usersTotal: moderationWeeklyStatistics.usersTotal,
  productsTotal: moderationWeeklyStatistics.productsTotal,
  qualifierMatches: moderationWeeklyStatistics.qualifierMatches,
  upvotes: moderationWeeklyStatistics.upvotes,
  finalized: moderationWeeklyStatistics.finalized,
  computedAt: moderationWeeklyStatistics.computedAt,
};

// D1は1文のバインド変数を100個までに限る。1行は列の値の11個、文ごとに更新日時と確定の条件の2個を使うため、1文に8行までを入れる
const MAX_BOUND_PARAMETERS = 100;
const PARAMETERS_PER_ROW = 11;
const PARAMETERS_PER_STATEMENT = 2;
const ROWS_PER_UPSERT_STATEMENT = Math.floor(
  (MAX_BOUND_PARAMETERS - PARAMETERS_PER_STATEMENT) / PARAMETERS_PER_ROW,
);

function excluded(column: SQLiteColumn): SQL {
  return sql.raw(`excluded."${column.name}"`);
}

// ジョブが止まって確定できないまま後の週に追い越された週は、次に成功した集計が確定させるまで値が週の途中のものであるため、確定した週と最も新しい週だけを表示の対象にする
const shownWeek = or(
  eq(moderationWeeklyStatistics.finalized, true),
  sql`${moderationWeeklyStatistics.weekStart} = (select max(${moderationWeeklyStatistics.weekStart}) from ${moderationWeeklyStatistics})`,
);

@injectable()
export class D1WeeklyStatisticsStore implements WeeklyStatisticsStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 分割した文を1つの一括で書くため、一部の週だけが保存されることは無い
  async upsert(rows: readonly WeeklyStatisticsRow[]): Promise<void> {
    const now = new Date();
    const [first, ...rest] = chunk(rows, ROWS_PER_UPSERT_STATEMENT).map(
      (part) => this.upsertStatement(part, now),
    );
    if (first === undefined) {
      return;
    }
    await this.db.batch([first, ...rest]);
  }

  private upsertStatement(rows: readonly WeeklyStatisticsRow[], now: Date) {
    return this.db
      .insert(moderationWeeklyStatistics)
      .values(rows.map((row) => ({ ...row, createdAt: now, updatedAt: now })))
      .onConflictDoUpdate({
        target: moderationWeeklyStatistics.weekStart,
        set: {
          netRevenue: excluded(moderationWeeklyStatistics.netRevenue),
          usersTotal: excluded(moderationWeeklyStatistics.usersTotal),
          productsTotal: excluded(moderationWeeklyStatistics.productsTotal),
          qualifierMatches: excluded(
            moderationWeeklyStatistics.qualifierMatches,
          ),
          upvotes: excluded(moderationWeeklyStatistics.upvotes),
          finalized: excluded(moderationWeeklyStatistics.finalized),
          computedAt: excluded(moderationWeeklyStatistics.computedAt),
          updatedAt: now,
        },
        setWhere: eq(moderationWeeklyStatistics.finalized, false),
      });
  }

  async findFinalizedWeekStarts(
    from: BusinessDate,
  ): Promise<readonly BusinessDate[]> {
    const rows = await this.db
      .select({ weekStart: moderationWeeklyStatistics.weekStart })
      .from(moderationWeeklyStatistics)
      .where(
        and(
          gte(moderationWeeklyStatistics.weekStart, from),
          eq(moderationWeeklyStatistics.finalized, true),
        ),
      )
      .orderBy(asc(moderationWeeklyStatistics.weekStart));
    return rows.map(({ weekStart }) => parseBusinessDate(weekStart));
  }

  async listRecent(limit: number): Promise<readonly WeeklyStatisticsRow[]> {
    const rows = await this.db
      .select(WEEKLY_STATISTICS_COLUMNS)
      .from(moderationWeeklyStatistics)
      .where(shownWeek)
      .orderBy(desc(moderationWeeklyStatistics.weekStart))
      .limit(limit);
    return rows.toReversed().map((row) => ({
      ...row,
      weekStart: parseBusinessDate(row.weekStart),
    }));
  }
}
