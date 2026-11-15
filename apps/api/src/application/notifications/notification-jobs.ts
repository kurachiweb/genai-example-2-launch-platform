import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { EveningSlotOpener } from '../../../lib/core/notifications/evening-dispatch.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import {
  EVENING_SLOT_TIME,
  eveningSlot,
  MORNING_SLOT_TIME,
  morningSlot,
} from '../../../lib/core/notifications/notification-slots.ts';
import type {
  NotificationIncidentReporter,
  NotificationSlotStore,
  NotificationWorkRequester,
} from '../../../lib/core/notifications/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { NOTIFICATIONS_TYPES } from './notifications-types.ts';
import type { NotificationMaintenanceStore } from './ports.ts';

const NOTIFICATION_JOB_ORDER = 1300;

const MAINTENANCE_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 4,
  minute: 21,
});

// 同じ23:45の起動でマッチのペアリング(order 1100)の後に動く
export const EVENING_DISPATCH_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'notifications.evening-dispatch',
    at: EVENING_SLOT_TIME,
    order: NOTIFICATION_JOB_ORDER,
    handler: NOTIFICATIONS_TYPES.EveningDispatchJob,
  });

// 同じ0:00の起動でマッチの開始(order 1100)の後に動く
export const MORNING_DISPATCH_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'notifications.morning-dispatch',
    at: MORNING_SLOT_TIME,
    order: NOTIFICATION_JOB_ORDER,
    handler: NOTIFICATIONS_TYPES.MorningDispatchJob,
  });

export const NOTIFICATION_MAINTENANCE_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'notifications.maintenance',
    at: MAINTENANCE_TIME,
    order: NOTIFICATION_JOB_ORDER,
    handler: NOTIFICATIONS_TYPES.NotificationMaintenanceJob,
  });

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });

export const NOTIFICATION_SLOT_OVERDUE_AFTER_MS = MILLISECONDS_PER_HOUR;

export const NOTIFICATION_SLOT_OVERDUE_LIMIT = 50;

export const NOTIFICATION_EVENT_STALE_AFTER_MS = 10 * MILLISECONDS_PER_MINUTE;

export const NOTIFICATION_EVENT_REDISPATCH_LIMIT = 100;

// 発行の時点で1回目と数えるため、これまでの依頼が2回以上なら今回の依頼は3回目以降になる
const STALLED_DISPATCH_COUNT = 2;

export const NOTICE_EXPIRE_AFTER_MS = 3 * MILLISECONDS_PER_DAY;

export const NOTIFICATION_RETENTION_MS = 30 * MILLISECONDS_PER_DAY;

// 起動の時間の予算とD1の負荷に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const NOTIFICATION_CLEANUP_BATCH_SIZE = 500;

export const NOTIFICATION_CLEANUP_MAX_BATCHES = 10;

const logger = getAppLogger(['api', 'application', 'notifications']);

// 業務時刻は固定のオフセットで夏時間が無いため、0:00の24時間前の時点の業務日付が前日になる
function previousBusinessDate(date: BusinessDate): BusinessDate {
  const startOfDay = fromBusinessDateTime(date, START_OF_DAY);
  return toBusinessDateTime(
    new Date(startOfDay.getTime() - MILLISECONDS_PER_DAY),
  ).date;
}

interface CleanupResult {
  readonly deleted: number;
  readonly limitReached: boolean;
}

async function deleteInBatches(
  deleteBatch: (limit: number) => Promise<number>,
): Promise<CleanupResult> {
  let deleted = 0;
  let batches = 0;
  let lastCount: number;
  do {
    lastCount = await deleteBatch(NOTIFICATION_CLEANUP_BATCH_SIZE);
    deleted += lastCount;
    batches += 1;
  } while (
    lastCount === NOTIFICATION_CLEANUP_BATCH_SIZE &&
    batches < NOTIFICATION_CLEANUP_MAX_BATCHES
  );
  return {
    deleted,
    limitReached: lastCount === NOTIFICATION_CLEANUP_BATCH_SIZE,
  };
}

@injectable()
export class EveningDispatchJob implements ScheduledJobHandler {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.EveningSlotOpener)
    private readonly opener: EveningSlotOpener,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async run({ business }: ScheduledJobContext): Promise<void> {
    const { requested } = await this.opener.open(
      business.date,
      this.clock.now(),
    );
    logger.info('夜の送信枠を開きました', {
      slot: eveningSlot(business.date).key,
      requested,
    });
  }
}

@injectable()
export class MorningDispatchJob implements ScheduledJobHandler {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationSlotStore)
    private readonly slots: NotificationSlotStore,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationWorkRequester)
    private readonly requester: NotificationWorkRequester,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async run({ business }: ScheduledJobContext): Promise<void> {
    const slot = morningSlot(business.date);
    await this.slots.ensure(slot, this.clock.now());
    await this.requester.flushSlot(slot.key, 0);
    logger.info('朝の送信枠の送り出しを依頼しました', { slot: slot.key });
  }
}

@injectable()
export class NotificationMaintenanceJob implements ScheduledJobHandler {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationSlotStore)
    private readonly slots: NotificationSlotStore,
    @inject(NOTIFICATIONS_TYPES.NotificationMaintenanceStore)
    private readonly maintenance: NotificationMaintenanceStore,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationWorkRequester)
    private readonly requester: NotificationWorkRequester,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationIncidentReporter)
    private readonly reporter: NotificationIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async run({ business }: ScheduledJobContext): Promise<void> {
    const now = this.clock.now();
    const slots = await this.recoverSlots(business.date, now);
    const abandoned = await this.deleteAbandonedEvents(now);
    const events = await this.redispatchStaleEvents(now);
    const expiredNotices = await this.maintenance.expirePending(
      new Date(now.getTime() - NOTICE_EXPIRE_AFTER_MS),
      now,
    );
    const cleanup = await this.deleteExpiredRecords(now);
    logger.info('通知の日次の保守を行いました', {
      ...slots,
      deletedPendingEvents: abandoned.deleted,
      ...events,
      expiredNotices,
      ...cleanup,
      cleanupLimitReached:
        cleanup.cleanupLimitReached || abandoned.limitReached,
    });
  }

  private async recoverSlots(
    date: BusinessDate,
    now: Date,
  ): Promise<{
    readonly requestedSlots: number;
    readonly overdueSlots: number;
  }> {
    const requested = new Set<string>();
    const requestFlush = async (key: string): Promise<void> => {
      if (requested.has(key)) {
        return;
      }
      await this.requester.flushSlot(key, 0);
      requested.add(key);
    };

    // 前日の23:45・当日の0:00のジョブが動かなかった場合も、ここで枠を作って送り出す
    for (const slot of [
      eveningSlot(previousBusinessDate(date)),
      morningSlot(date),
    ]) {
      const stored = await this.slots.ensure(slot, now);
      if (stored.phase !== 'done') {
        await requestFlush(slot.key);
      }
    }

    const overdueBefore = new Date(
      now.getTime() - NOTIFICATION_SLOT_OVERDUE_AFTER_MS,
    );
    const overdue = [
      ...(await this.slots.listOverdue(
        overdueBefore,
        NOTIFICATION_SLOT_OVERDUE_LIMIT,
      )),
      ...(await this.slots.listDoneWithPending(
        overdueBefore,
        NOTIFICATION_SLOT_OVERDUE_LIMIT,
      )),
    ];
    for (const { key } of overdue) {
      await requestFlush(key);
      this.reporter.report({ kind: 'slot-overdue', slotKey: key });
    }
    return { requestedSlots: requested.size, overdueSlots: overdue.length };
  }

  // 送り直しの前に消すため、消す通知イベントへ展開を依頼せず、依頼したメッセージが削除より先に展開して送ることもない
  private async deleteAbandonedEvents(now: Date): Promise<CleanupResult> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_MS);
    const result = await deleteInBatches((limit) =>
      this.maintenance.deletePendingEventsCreatedBefore(cutoff, limit),
    );
    if (result.deleted > 0) {
      logger.warning(
        '展開されないまま保持期間を過ぎた通知イベントを、通知を送らずに削除しました',
        { deleted: result.deleted },
      );
    }
    return result;
  }

  // 依頼の回数を進める前に依頼するため、依頼の途中で失敗しても翌日の起動が同じ通知イベントを拾う
  private async redispatchStaleEvents(now: Date): Promise<{
    readonly redispatchedEvents: number;
    readonly stalledEvents: number;
  }> {
    const stale = await this.maintenance.listStalePendingEvents(
      new Date(now.getTime() - NOTIFICATION_EVENT_STALE_AFTER_MS),
      NOTIFICATION_EVENT_REDISPATCH_LIMIT,
    );
    let stalledEvents = 0;
    for (const { eventId, dispatchCount } of stale) {
      await this.requester.expandEvent(eventId);
      if (dispatchCount >= STALLED_DISPATCH_COUNT) {
        stalledEvents += 1;
        this.reporter.report({ kind: 'event-stalled', eventId });
      }
    }
    if (stale.length > 0) {
      await this.maintenance.markEventsRedispatched(
        stale.map(({ eventId }) => eventId),
        now,
      );
    }
    return { redispatchedEvents: stale.length, stalledEvents };
  }

  private async deleteExpiredRecords(now: Date): Promise<{
    readonly deletedNotices: number;
    readonly deletedSlots: number;
    readonly deletedEvents: number;
    readonly cleanupLimitReached: boolean;
  }> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_MS);
    const notices = await deleteInBatches((limit) =>
      this.maintenance.deleteSettledBefore(cutoff, limit),
    );
    const slots = await deleteInBatches((limit) =>
      this.maintenance.deleteCompletedSlotsBefore(cutoff, limit),
    );
    const events = await deleteInBatches((limit) =>
      this.maintenance.deleteExpandedEventsBefore(cutoff, limit),
    );
    return {
      deletedNotices: notices.deleted,
      deletedSlots: slots.deleted,
      deletedEvents: events.deleted,
      cleanupLimitReached:
        notices.limitReached || slots.limitReached || events.limitReached,
    };
  }
}
