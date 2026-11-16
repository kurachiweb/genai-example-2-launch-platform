import { inArray } from 'drizzle-orm';
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

const WEEK_TOURNAMENT_STATUSES = [
  'open',
  'drawing',
  'in_progress',
  'finished',
] as const;

const WEEK_TOURNAMENT_OUTCOMES = ['awarded', 'no_award'] as const;

export const weekTournaments = snakeCase.table(
  'week_tournaments',
  {
    id: ulidPrimaryKey(),
    weekStart: text().notNull(),
    acceptUntil: integer({ mode: 'timestamp_ms' }).notNull(),
    deadlineAt: integer({ mode: 'timestamp_ms' }).notNull(),
    drawAt: integer({ mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: WEEK_TOURNAMENT_STATUSES }).notNull(),
    drawStartedAt: integer({ mode: 'timestamp_ms' }),
    drawnAt: integer({ mode: 'timestamp_ms' }),
    bracketId: text().references(() => tournamentBrackets.id),
    outcome: text({ enum: WEEK_TOURNAMENT_OUTCOMES }),
    // 参加の枠が週のトーナメントを外部キーで参照するため、循環する外部キーにしない
    championEntryId: text(),
    awardedAt: integer({ mode: 'timestamp_ms' }),
    finishedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('week_tournaments_week_start_unique').on(table.weekStart),
    index('week_tournaments_status_draw_at_idx').on(table.status, table.drawAt),
    check(
      'week_tournaments_status_check',
      inArray(table.status, WEEK_TOURNAMENT_STATUSES).inlineParams(),
    ),
    check(
      'week_tournaments_outcome_check',
      inArray(table.outcome, WEEK_TOURNAMENT_OUTCOMES).inlineParams(),
    ),
  ],
);
