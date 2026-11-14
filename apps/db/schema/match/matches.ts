import { inArray, lt } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

const MATCH_KINDS = ['qualifier', 'week', 'year'] as const;

const MATCH_STAGES = ['quarterfinal', 'semifinal', 'final'] as const;

const MATCH_DECISIONS = [
  'votes',
  'last_upvote',
  'no_votes',
  'bye',
  'walkover',
  'both_forfeited',
] as const;

export const matches = snakeCase.table(
  'matches',
  {
    id: ulidPrimaryKey(),
    kind: text({ enum: MATCH_KINDS }).notNull(),
    matchDate: text().notNull(),
    round: integer(),
    stage: text({ enum: MATCH_STAGES }),
    startsAt: integer({ mode: 'timestamp_ms' }).notNull(),
    endsAt: integer({ mode: 'timestamp_ms' }).notNull(),
    startedAt: integer({ mode: 'timestamp_ms' }),
    decidedAt: integer({ mode: 'timestamp_ms' }),
    decision: text({ enum: MATCH_DECISIONS }),
    endedEarlyAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('matches_match_date_kind_idx').on(table.matchDate, table.kind),
    index('matches_started_at_starts_at_idx').on(
      table.startedAt,
      table.startsAt,
    ),
    index('matches_decided_at_ends_at_idx').on(table.decidedAt, table.endsAt),
    index('matches_decided_at_idx').on(table.decidedAt),
    check(
      'matches_kind_check',
      inArray(table.kind, MATCH_KINDS).inlineParams(),
    ),
    check(
      'matches_stage_check',
      inArray(table.stage, MATCH_STAGES).inlineParams(),
    ),
    check(
      'matches_decision_check',
      inArray(table.decision, MATCH_DECISIONS).inlineParams(),
    ),
    check('matches_starts_before_ends_check', lt(table.startsAt, table.endsAt)),
  ],
);
