import { inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { products } from './products.ts';

const LAUNCH_OUTCOMES = ['won', 'lost'] as const;

export const productLaunches = snakeCase.table(
  'product_launches',
  {
    id: ulidPrimaryKey(),
    productId: text()
      .notNull()
      .references(() => products.id),
    launchDate: text().notNull(),
    outcome: text({ enum: LAUNCH_OUTCOMES }),
    decidedAt: integer({ mode: 'timestamp_ms' }),
    cancelledAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('product_launches_product_id_open_unique')
      .on(table.productId)
      .where(sql`(${table.outcome} is null and ${table.cancelledAt} is null)`),
    index('product_launches_launch_date_id_idx').on(table.launchDate, table.id),
    index('product_launches_product_id_launch_date_idx').on(
      table.productId,
      table.launchDate,
    ),
    check(
      'product_launches_outcome_check',
      inArray(table.outcome, LAUNCH_OUTCOMES).inlineParams(),
    ),
  ],
);
