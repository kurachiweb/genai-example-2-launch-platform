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

const NOTIFICATION_SLOT_KINDS = ['evening', 'morning', 'award'] as const;

const NOTIFICATION_SLOT_PHASES = [
  'waiting',
  'collecting',
  'sending',
  'done',
] as const;

export const notificationSlots = snakeCase.table(
  'notification_slots',
  {
    id: ulidPrimaryKey(),
    slotKey: text().notNull(),
    kind: text({ enum: NOTIFICATION_SLOT_KINDS }).notNull(),
    dueAt: integer({ mode: 'timestamp_ms' }).notNull(),
    settleUntil: integer({ mode: 'timestamp_ms' }).notNull(),
    // 夜の枠の送り出しの前提の機能の名前を、一覧を確定させた時点の写しとして持つ。NULLは未確定
    requiredParticipants: text({ mode: 'json' }).$type<readonly string[]>(),
    dispatchRequestedAt: integer({ mode: 'timestamp_ms' }),
    phase: text({ enum: NOTIFICATION_SLOT_PHASES })
      .notNull()
      .default('waiting'),
    cursor: text(),
    leaseHolder: text(),
    leaseUntil: integer({ mode: 'timestamp_ms' }),
    startedAt: integer({ mode: 'timestamp_ms' }),
    completedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('notification_slots_slot_key_unique').on(table.slotKey),
    index('notification_slots_phase_settle_until_idx').on(
      table.phase,
      table.settleUntil,
    ),
    index('notification_slots_phase_completed_at_idx').on(
      table.phase,
      table.completedAt,
    ),
    check(
      'notification_slots_kind_check',
      inArray(table.kind, NOTIFICATION_SLOT_KINDS).inlineParams(),
    ),
    check(
      'notification_slots_phase_check',
      inArray(table.phase, NOTIFICATION_SLOT_PHASES).inlineParams(),
    ),
  ],
);
