import { integer, snakeCase, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { ulidPrimaryKey } from '../_shared/columns.ts';

export const notificationSlotReadyMarks = snakeCase.table(
  'notification_slot_ready_marks',
  {
    id: ulidPrimaryKey(),
    slotKey: text().notNull(),
    participant: text().notNull(),
    createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('notification_slot_ready_marks_slot_key_participant_unique').on(
      table.slotKey,
      table.participant,
    ),
  ],
);
