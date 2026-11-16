import { asc } from 'drizzle-orm';

import { notificationEvents } from '../../../../db/schema/notifications/notification-events.ts';
import { notificationNotices } from '../../../../db/schema/notifications/notification-notices.ts';
import { notificationSlotReadyMarks } from '../../../../db/schema/notifications/notification-slot-ready-marks.ts';
import { notificationSlots } from '../../../../db/schema/notifications/notification-slots.ts';
import {
  db,
  recipientIdOf,
  T0,
} from '../../../../lib/workers/notifications/testing/notification-store-fixtures.ts';

export const RECIPIENT = 1;

// 1行が使うバインド変数の数から、上限(100)に収まる行数ずつ追加する
const EVENT_ROWS_PER_INSERT = 5;

type SlotRow = typeof notificationSlots.$inferInsert;
type NoticeRow = typeof notificationNotices.$inferInsert;
type EventRow = typeof notificationEvents.$inferInsert;

export function at(iso: string): Date {
  return new Date(iso);
}

export function maintenanceNoticeIdOf(index: number): string {
  return `01JC0N0TCE${String(index).padStart(16, '0')}`;
}

export function maintenanceEventIdOf(index: number): string {
  return `01JC0EVENT${String(index).padStart(16, '0')}`;
}

export async function insertSlot(
  slotKey: string,
  columns: Partial<SlotRow> = {},
): Promise<void> {
  await db.insert(notificationSlots).values({
    slotKey,
    kind: 'evening',
    dueAt: T0,
    settleUntil: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

export async function insertNotice(
  index: number,
  slotKey: string,
  settlement: Pick<NoticeRow, 'status'> & Partial<NoticeRow>,
): Promise<void> {
  await db.insert(notificationNotices).values({
    id: maintenanceNoticeIdOf(index),
    dedupeKey: `dedupe-${String(index)}`,
    slotKey,
    groupKey: `group-${String(index)}`,
    topic: 'match_result',
    recipientUserId: recipientIdOf(RECIPIENT),
    createdAt: T0,
    updatedAt: T0,
    ...settlement,
  });
}

function eventRowOf(index: number, columns: Partial<EventRow>): EventRow {
  return {
    id: maintenanceEventIdOf(index),
    type: 'match_result',
    dedupeKey: `event-${String(index)}`,
    publisher: 'match-engine',
    occurredAt: T0,
    lastDispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export async function insertEvent(
  index: number,
  columns: Partial<EventRow> = {},
): Promise<void> {
  await db.insert(notificationEvents).values(eventRowOf(index, columns));
}

export async function insertEvents(
  indexes: readonly number[],
  columns: Partial<EventRow> = {},
): Promise<void> {
  const rows = indexes.map((index) => eventRowOf(index, columns));
  for (let start = 0; start < rows.length; start += EVENT_ROWS_PER_INSERT) {
    await db
      .insert(notificationEvents)
      .values(rows.slice(start, start + EVENT_ROWS_PER_INSERT));
  }
}

export async function insertReadyMark(
  slotKey: string,
  participant: string,
): Promise<void> {
  await db.insert(notificationSlotReadyMarks).values({
    slotKey,
    participant,
    createdAt: T0,
  });
}

export async function readNoticeStates() {
  return db
    .select({
      id: notificationNotices.id,
      status: notificationNotices.status,
      skipReason: notificationNotices.skipReason,
      settledAt: notificationNotices.settledAt,
      updatedAt: notificationNotices.updatedAt,
    })
    .from(notificationNotices)
    .orderBy(asc(notificationNotices.id));
}

export async function readNoticeIds(): Promise<readonly string[]> {
  return (await readNoticeStates()).map(({ id }) => id);
}

export async function readEventStates() {
  return db
    .select({
      id: notificationEvents.id,
      status: notificationEvents.status,
      dispatchCount: notificationEvents.dispatchCount,
      lastDispatchedAt: notificationEvents.lastDispatchedAt,
      updatedAt: notificationEvents.updatedAt,
    })
    .from(notificationEvents)
    .orderBy(asc(notificationEvents.id));
}

export async function readEventIds(): Promise<readonly string[]> {
  return (await readEventStates()).map(({ id }) => id);
}

export async function readSlotKeys(): Promise<readonly string[]> {
  const rows = await db
    .select({ slotKey: notificationSlots.slotKey })
    .from(notificationSlots)
    .orderBy(asc(notificationSlots.slotKey));
  return rows.map(({ slotKey }) => slotKey);
}

export async function readReadyMarkSlotKeys(): Promise<readonly string[]> {
  const rows = await db
    .select({ slotKey: notificationSlotReadyMarks.slotKey })
    .from(notificationSlotReadyMarks)
    .orderBy(
      asc(notificationSlotReadyMarks.slotKey),
      asc(notificationSlotReadyMarks.participant),
    );
  return rows.map(({ slotKey }) => slotKey);
}
