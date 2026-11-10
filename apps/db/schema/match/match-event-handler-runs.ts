import { integer, snakeCase, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { matchEvents } from './match-events.ts';

export const matchEventHandlerRuns = snakeCase.table(
  'match_event_handler_runs',
  {
    id: ulidPrimaryKey(),
    eventId: text()
      .notNull()
      .references(() => matchEvents.id),
    handlerName: text().notNull(),
    completedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('match_event_handler_runs_event_id_handler_name_unique').on(
      table.eventId,
      table.handlerName,
    ),
  ],
);
