import { and, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationEvents } from '../../../db/schema/notifications/notification-events.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
import type { MatchDirectory, MatchRecord } from '../../core/match/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../core/notifications/identifiers.ts';
import {
  type MatchNoticeSource,
  type MatchNoticeTopic,
  matchNoticeDrafts,
  type NoticeDraft,
} from '../../core/notifications/notice-plan.ts';
import type { NotificationEvent } from '../../core/notifications/notification-event-contract.ts';
import {
  awardSlot,
  type NotificationSlot,
} from '../../core/notifications/notification-slots.ts';
import type {
  NotificationEventExpander,
  NotificationEventExpansion,
  NotificationNoticeStore,
  NotificationPreferenceStore,
  StoredNotificationEvent,
} from '../../core/notifications/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../core/profile/identifiers.ts';
import type { FollowerDirectory } from '../../core/profile/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外の条件と更新値に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

// 1回の記録の一括の書き込みの実行時間を抑えるため、通知の下書きを分けて記録する
const DRAFTS_PER_RECORD = 500;

// フォロワーの一覧の1回の読み取りの上限(FollowerDirectoryの最大)
const FOLLOWERS_PER_PAGE = 500;

const MATCH_NOTICE_TOPICS: readonly MatchNoticeTopic[] = Object.freeze([
  'match_preview',
  'match_result',
]);

const NOTHING_TO_SEND: NotificationEventExpansion = Object.freeze({
  kind: 'done',
  lateSlotKeys: Object.freeze([]),
  flushSlotKey: null,
});

type AwardNotificationEvent = Extract<
  NotificationEvent,
  { readonly type: 'award' }
>;

export type MatchNotificationEvent = Extract<
  NotificationEvent,
  { readonly type: MatchNoticeTopic }
>;

export interface PendingMatchEvent {
  readonly eventId: string;
  readonly event: MatchNotificationEvent;
}

export interface MatchEventExpansionDependencies {
  readonly db: Database;
  readonly preferences: NotificationPreferenceStore;
  readonly notices: NotificationNoticeStore;
}

type EventRow = typeof notificationEvents.$inferSelect;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

export function noticeSourceOf(record: MatchRecord): MatchNoticeSource {
  return {
    matchId: record.matchId,
    matchDate: record.matchDate,
    phase: record.phase,
    decided: record.decidedAt !== null,
    entries: record.entries.map(({ entryId, productId, ownerUserId }) => ({
      entryId,
      productId,
      ownerUserId,
    })),
  };
}

async function draftsOf(
  preferences: NotificationPreferenceStore,
  topic: MatchNoticeTopic,
  events: readonly PendingMatchEvent[],
  records: ReadonlyMap<string, MatchRecord>,
): Promise<readonly NoticeDraft[]> {
  const sources = events
    .filter(({ event }) => event.type === topic)
    .flatMap(({ event }) => {
      const record = records.get(event.matchId);
      return record === undefined ? [] : [noticeSourceOf(record)];
    });
  const owners = sources.flatMap((source) =>
    source.entries.flatMap(({ ownerUserId }) =>
      ownerUserId === null ? [] : [ownerUserId],
    ),
  );
  if (owners.length === 0) {
    return [];
  }
  const eligible = await preferences.eligibleRecipients(owners, topic);
  return matchNoticeDrafts({ topic, matches: sources, eligible });
}

// マッチの通知イベントの宛先は各側の投稿者だけのため、展開を1回の処理で終え、通知の記録の後に展開済みにする
export async function expandMatchEvents(
  dependencies: MatchEventExpansionDependencies,
  input: {
    readonly events: readonly PendingMatchEvent[];
    readonly records: ReadonlyMap<string, MatchRecord>;
    readonly at: Date;
  },
): Promise<readonly string[]> {
  const { db, preferences, notices } = dependencies;
  const { events, records, at } = input;
  if (events.length === 0) {
    return [];
  }
  const drafts = (
    await Promise.all(
      MATCH_NOTICE_TOPICS.map((topic) =>
        draftsOf(preferences, topic, events, records),
      ),
    )
  ).flat();
  const lateSlotKeys = new Set<string>();
  for (const part of chunk(drafts, DRAFTS_PER_RECORD)) {
    const recorded = await notices.record(part, at);
    for (const key of recorded.lateSlotKeys) {
      lateSlotKeys.add(key);
    }
  }
  for (const page of chunk(
    events.map(({ eventId }) => eventId),
    IDS_PER_STATEMENT,
  )) {
    await db
      .update(notificationEvents)
      .set({ status: 'expanded', expandedAt: at, updatedAt: at })
      .where(
        and(
          inArray(notificationEvents.id, page),
          eq(notificationEvents.status, 'pending'),
        ),
      );
  }
  return [...lateSlotKeys];
}

function matchIdOf(row: EventRow): string {
  if (row.matchId === null) {
    throw new Error(`マッチの通知イベントにマッチのIDがありません: ${row.id}`);
  }
  return row.matchId;
}

function storedEventOf(row: EventRow): StoredNotificationEvent {
  const common = {
    eventId: row.id,
    status: row.status,
    cursor: row.cursor,
    occurredAt: row.occurredAt,
  };
  if (row.type !== 'award') {
    return { ...common, event: { type: row.type, matchId: matchIdOf(row) } };
  }
  if (row.award === null || row.period === null || row.productId === null) {
    throw new Error(
      `受賞の通知イベントに賞・期間・プロダクトのIDがありません: ${row.id}`,
    );
  }
  return {
    ...common,
    event: {
      type: 'award',
      award: row.award,
      period: row.period,
      productId: row.productId,
    },
  };
}

@injectable()
export class D1NotificationEventExpander implements NotificationEventExpander {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(PROFILE_PLATFORM_TYPES.FollowerDirectory)
    private readonly followers: FollowerDirectory,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore)
    private readonly preferences: NotificationPreferenceStore,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationNoticeStore)
    private readonly notices: NotificationNoticeStore,
  ) {}

  // 保守の削除で消えた通知イベントと展開済みのマッチの通知イベントは、送り直しのメッセージが届いても何もしない
  async expand(
    eventId: string,
    now: Date,
    budget: number,
  ): Promise<NotificationEventExpansion> {
    const stored = await this.find(eventId);
    if (stored === undefined) {
      return NOTHING_TO_SEND;
    }
    const { event } = stored;
    if (event.type === 'award') {
      return this.expandAward(stored, event, now, budget);
    }
    if (stored.status === 'expanded') {
      return NOTHING_TO_SEND;
    }
    const records = await this.matches.findMatches([event.matchId], now);
    const lateSlotKeys = await expandMatchEvents(
      { db: this.db, preferences: this.preferences, notices: this.notices },
      { events: [{ eventId, event }], records, at: now },
    );
    return { kind: 'done', lateSlotKeys, flushSlotKey: null };
  }

  // 再試行で展開済みの通知イベントを見つけても、記録済みの通知を送り出せるよう受賞の枠を返す
  private async expandAward(
    stored: StoredNotificationEvent,
    event: AwardNotificationEvent,
    now: Date,
    budget: number,
  ): Promise<NotificationEventExpansion> {
    if (!Number.isInteger(budget) || budget < 1) {
      throw new RangeError(
        `1回の処理の上限は1以上の整数で指定してください: ${String(budget)}`,
      );
    }
    const slot = awardSlot(stored.eventId, now);
    const expanded: NotificationEventExpansion = {
      kind: 'done',
      lateSlotKeys: [],
      flushSlotKey: slot.key,
    };
    if (stored.status === 'expanded') {
      return expanded;
    }
    const product = (
      await this.products.findSummaries([event.productId], 'visible')
    ).get(event.productId);
    if (product === undefined) {
      await this.markExpanded(stored.eventId, now);
      return expanded;
    }
    const lateSlotKeys = await this.expandFollowers({
      eventId: stored.eventId,
      productId: event.productId,
      followeeId: product.ownerUserId,
      slot,
      cursor: stored.cursor,
      budget,
      now,
    });
    return lateSlotKeys === undefined
      ? { kind: 'continue' }
      : { ...expanded, lateSlotKeys };
  }

  // 上限まで読んでも続きがあれば、カーソルを保存してundefinedを返す
  private async expandFollowers(input: {
    readonly eventId: string;
    readonly productId: string;
    readonly followeeId: string;
    readonly slot: NotificationSlot;
    readonly cursor: string | null;
    readonly budget: number;
    readonly now: Date;
  }): Promise<readonly string[] | undefined> {
    const { eventId, productId, followeeId, slot, now } = input;
    const lateSlotKeys = new Set<string>();
    let cursor = input.cursor ?? undefined;
    let remaining = input.budget;
    while (remaining > 0) {
      const page = await this.followers.listVisibleFollowerIds({
        after: cursor,
        followeeId,
        limit: Math.min(FOLLOWERS_PER_PAGE, remaining),
      });
      remaining -= page.followerIds.length;
      const recorded = await this.recordAwardNotices(
        { eventId, productId, slot },
        page.followerIds,
        now,
      );
      for (const key of recorded) {
        lateSlotKeys.add(key);
      }
      if (page.next === undefined) {
        await this.markExpanded(eventId, now);
        return [...lateSlotKeys];
      }
      cursor = page.next;
      await this.saveCursor(eventId, cursor, now);
    }
    return undefined;
  }

  private async recordAwardNotices(
    source: {
      readonly eventId: string;
      readonly productId: string;
      readonly slot: NotificationSlot;
    },
    followerIds: readonly string[],
    at: Date,
  ): Promise<readonly string[]> {
    const { eventId, productId, slot } = source;
    if (followerIds.length === 0) {
      return [];
    }
    const eligible = await this.preferences.eligibleRecipients(
      followerIds,
      'followed_user_award',
    );
    const drafts: NoticeDraft[] = followerIds
      .filter((followerId) => eligible.has(followerId))
      .map((recipientUserId) => ({
        topic: 'followed_user_award',
        recipientUserId,
        slot,
        matchId: null,
        entryId: null,
        productId,
        eventId,
      }));
    const lateSlotKeys: string[] = [];
    for (const part of chunk(drafts, DRAFTS_PER_RECORD)) {
      const recorded = await this.notices.record(part, at);
      lateSlotKeys.push(...recorded.lateSlotKeys);
    }
    return lateSlotKeys;
  }

  private async saveCursor(
    eventId: string,
    cursor: string,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(notificationEvents)
      .set({ cursor, updatedAt: at })
      .where(
        and(
          eq(notificationEvents.id, eventId),
          eq(notificationEvents.status, 'pending'),
        ),
      );
  }

  private async markExpanded(eventId: string, at: Date): Promise<void> {
    await this.db
      .update(notificationEvents)
      .set({ status: 'expanded', expandedAt: at, updatedAt: at })
      .where(
        and(
          eq(notificationEvents.id, eventId),
          eq(notificationEvents.status, 'pending'),
        ),
      );
  }

  private async find(
    eventId: string,
  ): Promise<StoredNotificationEvent | undefined> {
    const [row] = await this.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, eventId));
    return row === undefined ? undefined : storedEventOf(row);
  }
}
