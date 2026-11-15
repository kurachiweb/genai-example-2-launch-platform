import { and, asc, eq, inArray, lt, notExists, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationEvents as events } from '../../../db/schema/notifications/notification-events.ts';
import { notificationNotices as notices } from '../../../db/schema/notifications/notification-notices.ts';
import { notificationSlotReadyMarks as readyMarks } from '../../../db/schema/notifications/notification-slot-ready-marks.ts';
import { notificationSlots as slots } from '../../../db/schema/notifications/notification-slots.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  NotificationMaintenanceStore,
  StalePendingEvent,
} from '../../application/notifications/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外の条件と更新値に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1NotificationMaintenanceStore implements NotificationMaintenanceStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async expirePending(dueBefore: Date, at: Date): Promise<number> {
    const overdueSlotKeys = this.db
      .select({ slotKey: slots.slotKey })
      .from(slots)
      .where(lt(slots.dueAt, dueBefore));
    const result = await this.db
      .update(notices)
      .set({
        status: 'skipped',
        skipReason: 'expired',
        settledAt: at,
        updatedAt: at,
      })
      .where(
        and(
          eq(notices.status, 'pending'),
          inArray(notices.slotKey, overdueSlotKeys),
        ),
      );
    return result.meta.changes;
  }

  async listStalePendingEvents(
    dispatchedBefore: Date,
    limit: number,
  ): Promise<readonly StalePendingEvent[]> {
    return this.db
      .select({ eventId: events.id, dispatchCount: events.dispatchCount })
      .from(events)
      .where(
        and(
          eq(events.status, 'pending'),
          lt(events.lastDispatchedAt, dispatchedBefore),
        ),
      )
      .orderBy(asc(events.lastDispatchedAt), asc(events.id))
      .limit(limit);
  }

  async markEventsRedispatched(
    eventIds: readonly string[],
    at: Date,
  ): Promise<void> {
    const statements = chunk([...new Set(eventIds)], IDS_PER_STATEMENT).map(
      (page) =>
        this.db
          .update(events)
          .set({
            dispatchCount: sql`${events.dispatchCount} + 1`,
            lastDispatchedAt: at,
            updatedAt: at,
          })
          .where(and(inArray(events.id, page), eq(events.status, 'pending'))),
    );
    const [first, ...rest] = statements;
    if (first === undefined) {
      return;
    }
    await this.db.batch([first, ...rest]);
  }

  async deleteSettledBefore(cutoff: Date, limit: number): Promise<number> {
    const targets = this.db
      .select({ id: notices.id })
      .from(notices)
      .where(
        and(
          inArray(notices.status, ['sent', 'skipped']),
          lt(notices.settledAt, cutoff),
        ),
      )
      .orderBy(asc(notices.settledAt), asc(notices.id))
      .limit(limit);
    const result = await this.db
      .delete(notices)
      .where(inArray(notices.id, targets));
    return result.meta.changes;
  }

  // 準備の完了の記録と枠の削除は同じ一括の書き込みの中で同じ条件の対象を選ぶため、どちらの文も同じ枠を指す
  async deleteCompletedSlotsBefore(
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    const targetSlotKeys = () =>
      this.db
        .select({ slotKey: slots.slotKey })
        .from(slots)
        .where(
          and(
            eq(slots.phase, 'done'),
            lt(slots.completedAt, cutoff),
            notExists(
              this.db
                .select({ one: sql`1` })
                .from(notices)
                .where(
                  and(
                    eq(notices.slotKey, slots.slotKey),
                    eq(notices.status, 'pending'),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(slots.completedAt), asc(slots.slotKey))
        .limit(limit);
    const [, deleted] = await this.db.batch([
      this.db
        .delete(readyMarks)
        .where(inArray(readyMarks.slotKey, targetSlotKeys())),
      this.db
        .delete(slots)
        .where(inArray(slots.slotKey, targetSlotKeys()))
        .returning({ slotKey: slots.slotKey }),
    ]);
    return deleted.length;
  }

  async deleteExpandedEventsBefore(
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    const targets = this.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.status, 'expanded'), lt(events.expandedAt, cutoff)))
      .orderBy(asc(events.expandedAt), asc(events.id))
      .limit(limit);
    const result = await this.db
      .delete(events)
      .where(inArray(events.id, targets));
    return result.meta.changes;
  }

  async deletePendingEventsCreatedBefore(
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    const targets = this.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.status, 'pending'), lt(events.createdAt, cutoff)))
      .orderBy(asc(events.createdAt), asc(events.id))
      .limit(limit);
    const result = await this.db
      .delete(events)
      .where(inArray(events.id, targets));
    return result.meta.changes;
  }
}
