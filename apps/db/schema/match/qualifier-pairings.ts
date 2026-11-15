import { inArray } from 'drizzle-orm';
import { check, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

const PAIRING_STATUSES = ['pending', 'completed'] as const;

export const qualifierPairings = snakeCase.table(
  'qualifier_pairings',
  {
    id: ulidPrimaryKey(),
    matchDate: text().notNull().unique(),
    status: text({ enum: PAIRING_STATUSES }).notNull().default('pending'),
    launchCount: integer(),
    matchCount: integer(),
    completedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    check(
      'qualifier_pairings_status_check',
      inArray(table.status, PAIRING_STATUSES).inlineParams(),
    ),
  ],
);
