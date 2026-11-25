import { inArray, sql } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

const BRACKET_KINDS = ['week', 'year'] as const;

const BRACKET_STATUSES = ['active', 'finished'] as const;

const BRACKET_OUTCOMES = ['champion', 'no_award'] as const;

export const tournamentBrackets = snakeCase.table(
  'tournament_brackets',
  {
    id: ulidPrimaryKey(),
    kind: text({ enum: BRACKET_KINDS }).notNull(),
    // 種類ごとのトーナメントの表を指すため外部キーにしない
    tournamentId: text().notNull(),
    participantCount: integer().notNull(),
    seedCount: integer().notNull(),
    secondRoundSize: integer().notNull(),
    roundCount: integer().notNull(),
    firstRoundDate: text(),
    status: text({ enum: BRACKET_STATUSES }).notNull(),
    outcome: text({ enum: BRACKET_OUTCOMES }),
    championParticipantNo: integer(),
    finishedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('tournament_brackets_kind_tournament_id_unique').on(
      table.kind,
      table.tournamentId,
    ),
    check(
      'tournament_brackets_kind_check',
      inArray(table.kind, BRACKET_KINDS).inlineParams(),
    ),
    check(
      'tournament_brackets_status_check',
      inArray(table.status, BRACKET_STATUSES).inlineParams(),
    ),
    check(
      'tournament_brackets_outcome_check',
      inArray(table.outcome, BRACKET_OUTCOMES).inlineParams(),
    ),
    check(
      'tournament_brackets_finished_outcome_check',
      sql`(${table.status} <> 'finished' or ${table.outcome} is not null)`,
    ),
    check(
      'tournament_brackets_champion_participant_check',
      sql`(${table.outcome} is null or ${table.outcome} <> 'champion' or ${table.championParticipantNo} is not null)`,
    ),
  ],
);
