import { between, inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { tournamentBrackets } from './tournament-brackets.ts';

const MIN_YEAR = 1000;

const MAX_YEAR = 9999;

const FINAL_DATE_SOURCES = ['explicit', 'default'] as const;

const YEAR_TOURNAMENT_STATUSES = [
  'open',
  'drawing',
  'in_progress',
  'finished',
] as const;

const YEAR_TOURNAMENT_OUTCOMES = ['awarded', 'no_award'] as const;

export const yearTournaments = snakeCase.table(
  'year_tournaments',
  {
    id: ulidPrimaryKey(),
    year: integer().notNull(),
    finalDate: text().notNull(),
    finalDateSource: text({ enum: FINAL_DATE_SOURCES }).notNull(),
    finalDateVersion: integer().notNull().default(0),
    finalDateUpdatedAt: integer({ mode: 'timestamp_ms' }),
    // 管理者の機能の表を直接読まないため外部キーにしない
    finalDateUpdatedByAdminId: text(),
    deadlineDate: text().notNull(),
    acceptUntil: integer({ mode: 'timestamp_ms' }).notNull(),
    deadlineAt: integer({ mode: 'timestamp_ms' }).notNull(),
    drawAt: integer({ mode: 'timestamp_ms' }).notNull(),
    changeLockAt: integer({ mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: YEAR_TOURNAMENT_STATUSES }).notNull(),
    drawStartedAt: integer({ mode: 'timestamp_ms' }),
    drawnAt: integer({ mode: 'timestamp_ms' }),
    bracketId: text().references(() => tournamentBrackets.id),
    firstRoundDate: text(),
    participantCount: integer(),
    outcome: text({ enum: YEAR_TOURNAMENT_OUTCOMES }),
    // 参加の枠の物理削除の順に縛られないよう外部キーにしない
    championEntryId: text(),
    awardedAt: integer({ mode: 'timestamp_ms' }),
    finishedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('year_tournaments_year_unique').on(table.year),
    index('year_tournaments_status_draw_at_idx').on(table.status, table.drawAt),
    index('year_tournaments_draw_started_at_deadline_date_idx').on(
      table.drawStartedAt,
      table.deadlineDate,
    ),
    check(
      'year_tournaments_year_range_check',
      between(table.year, MIN_YEAR, MAX_YEAR).inlineParams(),
    ),
    check(
      'year_tournaments_final_date_source_check',
      inArray(table.finalDateSource, FINAL_DATE_SOURCES).inlineParams(),
    ),
    check(
      'year_tournaments_final_date_version_check',
      sql`${table.finalDateVersion} >= 0`,
    ),
    check(
      'year_tournaments_status_check',
      inArray(table.status, YEAR_TOURNAMENT_STATUSES).inlineParams(),
    ),
    check(
      'year_tournaments_outcome_check',
      inArray(table.outcome, YEAR_TOURNAMENT_OUTCOMES).inlineParams(),
    ),
    check(
      'year_tournaments_explicit_version_check',
      sql`(${table.finalDateSource} <> 'explicit' or ${table.finalDateVersion} >= 1)`,
    ),
    check(
      'year_tournaments_finished_outcome_check',
      sql`(${table.status} <> 'finished' or ${table.outcome} is not null)`,
    ),
    check(
      'year_tournaments_awarded_champion_check',
      sql`(${table.outcome} is null or ${table.outcome} <> 'awarded' or ${table.championEntryId} is not null)`,
    ),
  ],
);
