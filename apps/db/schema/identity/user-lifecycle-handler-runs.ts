import { integer, snakeCase, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { userLifecycleEvents } from './user-lifecycle-events.ts';

export const userLifecycleHandlerRuns = snakeCase.table(
  'user_lifecycle_handler_runs',
  {
    id: ulidPrimaryKey(),
    eventId: text()
      .notNull()
      .references(() => userLifecycleEvents.id),
    handlerName: text().notNull(),
    completedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('user_lifecycle_handler_runs_event_id_handler_name_unique').on(
      table.eventId,
      table.handlerName,
    ),
  ],
);
