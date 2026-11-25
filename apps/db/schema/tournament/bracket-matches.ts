import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps } from '../_shared/columns.ts';
import { tournamentBrackets } from './tournament-brackets.ts';

const BRACKET_MATCH_STATUSES = ['planned', 'scheduled', 'decided'] as const;

export const bracketMatches = snakeCase.table(
  'bracket_matches',
  {
    // マッチの予定を作る前に挿入するため、マッチへの外部キーにしない
    matchId: text().primaryKey(),
    bracketId: text()
      .notNull()
      .references(() => tournamentBrackets.id),
    round: integer().notNull(),
    position: integer().notNull(),
    matchDate: text().notNull(),
    participant1No: integer().notNull(),
    participant2No: integer(),
    status: text({ enum: BRACKET_MATCH_STATUSES }).notNull(),
    winnerParticipantNo: integer(),
    decidedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('bracket_matches_bracket_id_round_position_unique').on(
      table.bracketId,
      table.round,
      table.position,
    ),
    index('bracket_matches_bracket_id_status_idx').on(
      table.bracketId,
      table.status,
    ),
    check(
      'bracket_matches_status_check',
      inArray(table.status, BRACKET_MATCH_STATUSES).inlineParams(),
    ),
  ],
);
