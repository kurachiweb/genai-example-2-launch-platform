import type { Logger } from '@logtape/logtape';
import { getTableColumns, inArray } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import { notificationEvents } from '../../../db/schema/notifications/notification-events.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { MatchDirectory, MatchRecord } from '../../core/match/ports.ts';
import {
  type NotificationEvent,
  notificationEventDedupeKey,
  type NotificationEventPublisher,
  NotificationPublishError,
  type NotificationPublishErrorReason,
  type NotificationPublishRequest,
  type NotificationPublishResult,
  parseNotificationPublishRequest,
} from '../../core/notifications/notification-event-contract.ts';
import type {
  NotificationNoticeStore,
  NotificationPreferenceStore,
  NotificationWorkRequester,
} from '../../core/notifications/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  expandMatchEvents,
  type MatchNotificationEvent,
  type PendingMatchEvent,
} from './d1-notification-event-expander.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const MAX_BOUND_PARAMETERS = 100;

// 任意の列も含めて1行がすべての列のバインド変数を使う場合でも上限に収まる行数
export const EVENT_ROWS_PER_INSERT = Math.floor(
  MAX_BOUND_PARAMETERS /
    Object.keys(getTableColumns(notificationEvents)).length,
);

type EventRow = typeof notificationEvents.$inferInsert;

export interface D1NotificationEventPublisherDependencies {
  readonly db: Database;
  readonly ids: IdGenerator;
  readonly matches: MatchDirectory;
  readonly preferences: NotificationPreferenceStore;
  readonly notices: NotificationNoticeStore;
  readonly requester: NotificationWorkRequester;
  readonly appName: LoggingOptions['appName'];
}

interface RecordedEvent {
  readonly id: string;
  readonly type: NotificationEvent['type'];
  readonly status: 'pending' | 'expanded';
  readonly matchId: string | null;
}

interface InsertedEvent {
  readonly eventId: string;
  readonly event: NotificationEvent;
}

interface NewEvent {
  readonly index: number;
  readonly dedupeKey: string;
  readonly event: NotificationEvent;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

// 1回の発行の中で同じ通知イベントが重なる場合は、最初の要素だけを記録の対象にする
function newEventsOf(
  events: readonly NotificationEvent[],
  recorded: ReadonlyMap<string, RecordedEvent>,
): readonly NewEvent[] {
  const seen = new Set(recorded.keys());
  return events.flatMap((event, index) => {
    const dedupeKey = notificationEventDedupeKey(event);
    if (seen.has(dedupeKey)) {
      return [];
    }
    seen.add(dedupeKey);
    return [{ index, dedupeKey, event }];
  });
}

function unexpandedMatchEventsOf(
  recorded: ReadonlyMap<string, RecordedEvent>,
): readonly PendingMatchEvent[] {
  return [...recorded.values()].flatMap(
    ({ id, type, status, matchId }): PendingMatchEvent[] =>
      status === 'pending' && type !== 'award' && matchId !== null
        ? [{ eventId: id, event: { type, matchId } }]
        : [],
  );
}

function isMatchEvent(
  event: NotificationEvent,
): event is MatchNotificationEvent {
  return event.type !== 'award';
}

function violationOf(
  event: MatchNotificationEvent,
  record: MatchRecord | undefined,
): NotificationPublishErrorReason | undefined {
  if (record === undefined) {
    return 'match-not-found';
  }
  if (event.type === 'match_result') {
    return record.decidedAt === null ? 'match-not-decided' : undefined;
  }
  return record.phase === 'scheduled' ? undefined : 'match-not-previewable';
}

function eventColumnsOf(event: NotificationEvent) {
  if (event.type === 'award') {
    return {
      matchId: null,
      award: event.award,
      period: event.period,
      productId: event.productId,
    };
  }
  return {
    matchId: event.matchId,
    award: null,
    period: null,
    productId: null,
  };
}

export class D1NotificationEventPublisher implements NotificationEventPublisher {
  private readonly logger: Logger;

  constructor(
    private readonly dependencies: D1NotificationEventPublisherDependencies,
  ) {
    this.logger = getAppLogger([
      dependencies.appName,
      'application',
      'notifications',
    ]);
  }

  // 記録済みの通知イベントは発行し直しても拒否せずに重複として数え、再試行される呼び出し元の処理を止めない。記録済みでも未展開のマッチの通知イベントは、その夜の送り出しに間に合うよう展開し直す
  async publish(
    request: NotificationPublishRequest,
  ): Promise<NotificationPublishResult> {
    const { publisher, events, at } = parseNotificationPublishRequest(request);
    const recorded = await this.recordedEventsOf(
      events.map(notificationEventDedupeKey),
    );
    const newEvents = newEventsOf(events, recorded);
    const unexpanded = unexpandedMatchEventsOf(recorded);
    const records = await this.assertPublishable(newEvents, unexpanded, at);
    const inserted = await this.insert(newEvents, publisher, at);
    const insertedMatchEvents = inserted.flatMap(
      ({ eventId, event }): PendingMatchEvent[] =>
        isMatchEvent(event) ? [{ eventId, event }] : [],
    );
    const lateSlotKeys = await expandMatchEvents(this.dependencies, {
      events: [...insertedMatchEvents, ...unexpanded],
      records,
      at,
    });
    await this.requestFollowUps(lateSlotKeys, inserted);
    return {
      recorded: inserted.length,
      duplicates: events.length - inserted.length,
    };
  }

  private async requestFollowUps(
    lateSlotKeys: readonly string[],
    inserted: readonly InsertedEvent[],
  ): Promise<void> {
    for (const slotKey of lateSlotKeys) {
      await this.requestSafely(
        () => this.dependencies.requester.flushSlot(slotKey, 0),
        '遅れた通知の送信枠の送り出しを依頼できず、保守の送り直しに委ねました',
        { slot: slotKey },
      );
    }
    for (const { eventId, event } of inserted) {
      if (event.type === 'award') {
        await this.requestSafely(
          () => this.dependencies.requester.expandEvent(eventId),
          '受賞の通知イベントの展開を依頼できず、保守の送り直しに委ねました',
          { eventId },
        );
      }
    }
  }

  private async recordedEventsOf(
    dedupeKeys: readonly string[],
  ): Promise<ReadonlyMap<string, RecordedEvent>> {
    const pages = await Promise.all(
      chunk([...new Set(dedupeKeys)], IDS_PER_STATEMENT).map((page) =>
        this.dependencies.db
          .select({
            dedupeKey: notificationEvents.dedupeKey,
            id: notificationEvents.id,
            type: notificationEvents.type,
            status: notificationEvents.status,
            matchId: notificationEvents.matchId,
          })
          .from(notificationEvents)
          .where(inArray(notificationEvents.dedupeKey, page)),
      ),
    );
    return new Map(
      pages.flat().map(({ dedupeKey, ...event }) => [dedupeKey, event]),
    );
  }

  // 記録する前に新しい通知イベントの全件を確かめ、1件でも違反があれば何も記録しない。展開し直す通知イベントの開始済み・未確定のマッチは通知の下書きが除く
  private async assertPublishable(
    newEvents: readonly NewEvent[],
    unexpanded: readonly PendingMatchEvent[],
    at: Date,
  ): Promise<ReadonlyMap<string, MatchRecord>> {
    const matchIds = [
      ...newEvents.flatMap(({ event }) =>
        isMatchEvent(event) ? [event.matchId] : [],
      ),
      ...unexpanded.map(({ event }) => event.matchId),
    ];
    if (matchIds.length === 0) {
      return new Map();
    }
    const records = await this.dependencies.matches.findMatches(matchIds, at);
    for (const { index, event } of newEvents) {
      if (!isMatchEvent(event)) {
        continue;
      }
      const reason = violationOf(event, records.get(event.matchId));
      if (reason !== undefined) {
        throw new NotificationPublishError(reason, index);
      }
    }
    return records;
  }

  private async insert(
    newEvents: readonly NewEvent[],
    publisher: string,
    at: Date,
  ): Promise<readonly InsertedEvent[]> {
    const rows: EventRow[] = newEvents.map(({ dedupeKey, event }) => ({
      id: this.dependencies.ids.generate(),
      type: event.type,
      dedupeKey,
      publisher,
      ...eventColumnsOf(event),
      status: 'pending',
      cursor: null,
      occurredAt: at,
      expandedAt: null,
      dispatchCount: 1,
      lastDispatchedAt: at,
      createdAt: at,
      updatedAt: at,
    }));
    const [first, ...rest] = chunk(rows, EVENT_ROWS_PER_INSERT).map((page) =>
      this.dependencies.db
        .insert(notificationEvents)
        .values(page)
        .onConflictDoNothing({ target: notificationEvents.dedupeKey })
        .returning({
          id: notificationEvents.id,
          dedupeKey: notificationEvents.dedupeKey,
        }),
    );
    if (first === undefined) {
      return [];
    }
    const insertedIds = new Map(
      (await this.dependencies.db.batch([first, ...rest]))
        .flat()
        .map((row) => [row.dedupeKey, row.id]),
    );
    return newEvents.flatMap(({ dedupeKey, event }) => {
      const eventId = insertedIds.get(dedupeKey);
      return eventId === undefined ? [] : [{ eventId, event }];
    });
  }

  // 送れなかった依頼は記録が残るため保守が送り直す。発行の呼び出し元の処理を止めない
  private async requestSafely(
    send: () => Promise<void>,
    message: string,
    attributes: Readonly<Record<string, string>>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(message, { ...attributes, error });
    }
  }
}
