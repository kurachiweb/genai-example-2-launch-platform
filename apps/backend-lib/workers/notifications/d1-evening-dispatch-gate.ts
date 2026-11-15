import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationSlotReadyMarks } from '../../../db/schema/notifications/notification-slot-ready-marks.ts';
import { notificationSlots } from '../../../db/schema/notifications/notification-slots.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import {
  type EveningDispatchGate,
  type EveningDispatchReadiness,
  type EveningDispatchReadyInput,
  type EveningSlotOpener,
  parseEveningDispatchReadyInput,
} from '../../core/notifications/evening-dispatch.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../core/notifications/identifiers.ts';
import {
  eveningSlot,
  type NotificationSlot,
} from '../../core/notifications/notification-slots.ts';
import type {
  NotificationSlotStore,
  NotificationWorkRequester,
} from '../../core/notifications/ports.ts';
import type { BusinessDate } from '../../core/time/business-time.ts';
import { MAX_DELAY_SECONDS } from '../messaging/queue-publisher.ts';

const slots = notificationSlots;
const readyMarks = notificationSlotReadyMarks;

const MILLISECONDS_PER_SECOND = 1000;

// 送信の処理は期限の前に届いたメッセージを遅らせ直すため、遅延の上限で切り詰めても期限より前には送り出さない
function deadlineDelaySeconds(slot: NotificationSlot, at: Date): number {
  const seconds = Math.ceil(
    (slot.settleUntil.getTime() - at.getTime()) / MILLISECONDS_PER_SECOND,
  );
  return Math.min(Math.max(0, seconds), MAX_DELAY_SECONDS);
}

@injectable()
export class D1EveningDispatchGate
  implements EveningDispatchGate, EveningSlotOpener
{
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationSlotStore)
    private readonly slotStore: NotificationSlotStore,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationWorkRequester)
    private readonly requester: NotificationWorkRequester,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchParticipants)
    private readonly participants: readonly string[],
  ) {}

  async markReady(
    input: EveningDispatchReadyInput,
  ): Promise<EveningDispatchReadiness> {
    const { participant, date, at } = parseEveningDispatchReadyInput(
      input,
      this.participants,
    );
    const slot = await this.prepare(date, at);
    await this.db
      .insert(readyMarks)
      .values({
        id: this.ids.generate(),
        slotKey: slot.key,
        participant,
        createdAt: at,
      })
      .onConflictDoNothing({
        target: [readyMarks.slotKey, readyMarks.participant],
      });
    if (await this.requestDispatch(slot, at)) {
      return { kind: 'dispatch-requested' };
    }
    const stored = await this.slotStore.find(slot.key);
    if (
      stored === undefined ||
      stored.dispatchRequestedAt !== null ||
      stored.phase !== 'waiting'
    ) {
      return { kind: 'already-requested' };
    }
    const missing = await this.slotStore.missingParticipants(slot.key);
    return { kind: 'waiting', missing: missing ?? [] };
  }

  async open(
    date: BusinessDate,
    at: Date,
  ): Promise<{ readonly requested: boolean }> {
    const slot = await this.prepare(date, at);
    return { requested: await this.requestDispatch(slot, at) };
  }

  // 前提の一覧は最初に確定させた呼び出しだけが写すため、期限の送り出しもその呼び出しだけが依頼する
  private async prepare(
    date: BusinessDate,
    at: Date,
  ): Promise<NotificationSlot> {
    const slot = eveningSlot(date);
    await this.slotStore.ensure(slot, at);
    if (await this.slotStore.fixParticipants(slot.key, this.participants, at)) {
      await this.requester.flushSlot(slot.key, deadlineDelaySeconds(slot, at));
    }
    return slot;
  }

  // 前提の全てに準備の完了がそろった待機の枠だけを1回だけ依頼済みにし、記録できた呼び出しだけが送り出しを送る
  private async requestDispatch(
    slot: NotificationSlot,
    at: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(slots)
      .set({ dispatchRequestedAt: at, updatedAt: at })
      .where(
        and(
          eq(slots.slotKey, slot.key),
          isNull(slots.dispatchRequestedAt),
          eq(slots.phase, 'waiting'),
          isNotNull(slots.requiredParticipants),
          sql`not exists (select 1 from json_each(${slots.requiredParticipants}) as required where not exists (select 1 from ${readyMarks} where ${readyMarks.slotKey} = ${slots.slotKey} and ${readyMarks.participant} = required.value))`,
        ),
      )
      .returning({ key: slots.slotKey });
    if (rows.length === 0) {
      return false;
    }
    await this.requester.flushSlot(slot.key, 0);
    return true;
  }
}
