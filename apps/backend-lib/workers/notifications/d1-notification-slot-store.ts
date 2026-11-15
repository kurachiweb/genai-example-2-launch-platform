import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationNotices } from '../../../db/schema/notifications/notification-notices.ts';
import { notificationSlotReadyMarks } from '../../../db/schema/notifications/notification-slot-ready-marks.ts';
import { notificationSlots } from '../../../db/schema/notifications/notification-slots.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { NotificationSlot } from '../../core/notifications/notification-slots.ts';
import type {
  NotificationSlotStore,
  SlotProgress,
  StoredSlot,
} from '../../core/notifications/ports.ts';

const slots = notificationSlots;
const notices = notificationNotices;
const readyMarks = notificationSlotReadyMarks;

const MILLISECONDS_PER_SECOND = 1000;

const STORED_SLOT_COLUMNS = {
  key: slots.slotKey,
  kind: slots.kind,
  dueAt: slots.dueAt,
  settleUntil: slots.settleUntil,
  phase: slots.phase,
  cursor: slots.cursor,
  requiredParticipants: slots.requiredParticipants,
  dispatchRequestedAt: slots.dispatchRequestedAt,
};

@injectable()
export class D1NotificationSlotStore implements NotificationSlotStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  // 朝と受賞の枠は前提を待たずに送り出すため、作成の時点で依頼済みとする
  async ensure(slot: NotificationSlot, at: Date): Promise<StoredSlot> {
    await this.db
      .insert(slots)
      .values({
        id: this.ids.generate(),
        slotKey: slot.key,
        kind: slot.kind,
        dueAt: slot.dueAt,
        settleUntil: slot.settleUntil,
        dispatchRequestedAt: slot.kind === 'evening' ? null : at,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing({ target: slots.slotKey });
    const stored = await this.find(slot.key);
    if (stored === undefined) {
      throw new Error(`送信枠を作れませんでした: ${slot.key}`);
    }
    return stored;
  }

  async find(key: string): Promise<StoredSlot | undefined> {
    const [row] = await this.db
      .select(STORED_SLOT_COLUMNS)
      .from(slots)
      .where(eq(slots.slotKey, key));
    return row;
  }

  async acquireLease(
    key: string,
    holder: string,
    now: Date,
    seconds: number,
  ): Promise<boolean> {
    const rows = await this.db
      .update(slots)
      .set({
        leaseHolder: holder,
        leaseUntil: new Date(now.getTime() + seconds * MILLISECONDS_PER_SECOND),
        updatedAt: now,
      })
      .where(
        and(
          eq(slots.slotKey, key),
          or(
            isNull(slots.leaseUntil),
            lte(slots.leaseUntil, now),
            eq(slots.leaseHolder, holder),
          ),
        ),
      )
      .returning({ key: slots.slotKey });
    return rows.length > 0;
  }

  async releaseLease(key: string, holder: string): Promise<void> {
    await this.db
      .update(slots)
      .set({ leaseHolder: null, leaseUntil: null })
      .where(and(eq(slots.slotKey, key), eq(slots.leaseHolder, holder)));
  }

  // 保持者でない呼び出しは段の結果を残せないため、成功として扱わせずに再試行させる
  async advance(
    key: string,
    holder: string,
    change: SlotProgress,
    at: Date,
  ): Promise<void> {
    const rows = await this.db
      .update(slots)
      .set({
        phase: change.phase,
        cursor: change.cursor,
        updatedAt: at,
        ...(change.phase === 'waiting'
          ? {}
          : { startedAt: sql`coalesce(${slots.startedAt}, ${at.getTime()})` }),
        ...(change.phase === 'done' ? { completedAt: at } : {}),
      })
      .where(and(eq(slots.slotKey, key), eq(slots.leaseHolder, holder)))
      .returning({ key: slots.slotKey });
    if (rows.length === 0) {
      throw new Error(`送信枠のリースを持たないため段を進められません: ${key}`);
    }
  }

  async listOverdue(
    before: Date,
    limit: number,
  ): Promise<readonly StoredSlot[]> {
    return this.db
      .select(STORED_SLOT_COLUMNS)
      .from(slots)
      .where(
        and(
          inArray(slots.phase, ['waiting', 'collecting', 'sending']),
          lt(slots.settleUntil, before),
        ),
      )
      .orderBy(asc(slots.settleUntil), asc(slots.slotKey))
      .limit(limit);
  }

  async missingParticipants(key: string): Promise<readonly string[] | null> {
    const required = (await this.find(key))?.requiredParticipants ?? null;
    if (required === null) {
      return null;
    }
    const marks = await this.db
      .select({ participant: readyMarks.participant })
      .from(readyMarks)
      .where(eq(readyMarks.slotKey, key));
    const ready = new Set(marks.map((mark) => mark.participant));
    return required.filter((participant) => !ready.has(participant));
  }

  async markDispatchRequested(key: string, at: Date): Promise<void> {
    await this.db
      .update(slots)
      .set({ dispatchRequestedAt: at, updatedAt: at })
      .where(and(eq(slots.slotKey, key), isNull(slots.dispatchRequestedAt)));
  }

  async fixParticipants(
    key: string,
    participants: readonly string[],
    at: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(slots)
      .set({ requiredParticipants: [...participants], updatedAt: at })
      .where(and(eq(slots.slotKey, key), isNull(slots.requiredParticipants)))
      .returning({ key: slots.slotKey });
    return rows.length > 0;
  }

  async listDoneWithPending(
    before: Date,
    limit: number,
  ): Promise<readonly StoredSlot[]> {
    return this.db
      .select(STORED_SLOT_COLUMNS)
      .from(slots)
      .where(
        and(
          eq(slots.phase, 'done'),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(notices)
              .where(
                and(
                  eq(notices.slotKey, slots.slotKey),
                  eq(notices.status, 'pending'),
                  lt(notices.createdAt, before),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(slots.completedAt), asc(slots.slotKey))
      .limit(limit);
  }
}
