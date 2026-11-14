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
import { matches } from './matches.ts';

const MATCH_EVENT_TYPES = ['scheduled', 'started', 'decided'] as const;

const MATCH_EVENT_STATUSES = ['pending', 'completed'] as const;

export const matchEvents = snakeCase.table(
  'match_events',
  {
    id: ulidPrimaryKey(),
    matchId: text()
      .notNull()
      .references(() => matches.id),
    matchKind: text({ enum: matches.kind.enumValues }).notNull(),
    type: text({ enum: MATCH_EVENT_TYPES }).notNull(),
    occurredAt: integer({ mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: MATCH_EVENT_STATUSES }).notNull().default('pending'),
    dispatchCount: integer().notNull().default(1),
    lastDispatchedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    completedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('match_events_match_id_type_unique').on(
      table.matchId,
      table.type,
    ),
    index('match_events_match_id_status_occurred_at_id_idx').on(
      table.matchId,
      table.status,
      table.occurredAt,
      table.id,
    ),
    index('match_events_status_last_dispatched_at_idx').on(
      table.status,
      table.lastDispatchedAt,
    ),
    index('match_events_status_completed_at_idx').on(
      table.status,
      table.completedAt,
    ),
    check(
      'match_events_match_kind_check',
      inArray(table.matchKind, matches.kind.enumValues).inlineParams(),
    ),
    check(
      'match_events_type_check',
      inArray(table.type, MATCH_EVENT_TYPES).inlineParams(),
    ),
    check(
      'match_events_status_check',
      inArray(table.status, MATCH_EVENT_STATUSES).inlineParams(),
    ),
  ],
);
