import { integer, snakeCase, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { productLifecycleEvents } from './product-lifecycle-events.ts';

export const productLifecycleHandlerRuns = snakeCase.table(
  'product_lifecycle_handler_runs',
  {
    id: ulidPrimaryKey(),
    eventId: text()
      .notNull()
      .references(() => productLifecycleEvents.id),
    handlerName: text().notNull(),
    completedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex(
      'product_lifecycle_handler_runs_event_id_handler_name_unique',
    ).on(table.eventId, table.handlerName),
  ],
);
