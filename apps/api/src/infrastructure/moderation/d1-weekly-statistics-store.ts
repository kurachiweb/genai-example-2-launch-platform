import { desc, eq, or, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { moderationWeeklyStatistics } from '../../../db/schema/moderation/moderation-weekly-statistics.ts';
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

function excluded(column: SQLiteColumn): SQL {
  return sql.raw(`excluded."${column.name}"`);
}

// ジョブが止まって確定できないまま後の週に追い越された週は値が週の途中のものであるため、確定した週と最も新しい週だけを表示の対象にする
const shownWeek = or(
  eq(moderationWeeklyStatistics.finalized, true),
  sql`${moderationWeeklyStatistics.weekStart} = (select max(${moderationWeeklyStatistics.weekStart}) from ${moderationWeeklyStatistics})`,
);

@injectable()
export class D1WeeklyStatisticsStore implements WeeklyStatisticsStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async upsert(rows: readonly WeeklyStatisticsRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const now = new Date();
    await this.db
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

  async findFinalized(weekStart: BusinessDate): Promise<boolean> {
    const [row] = await this.db
      .select({ finalized: moderationWeeklyStatistics.finalized })
      .from(moderationWeeklyStatistics)
      .where(eq(moderationWeeklyStatistics.weekStart, weekStart));
    return row?.finalized ?? false;
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
