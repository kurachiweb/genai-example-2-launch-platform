import { inject, injectable } from 'inversify';
import { z } from 'zod';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { MATCH_KINDS } from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type { NoticeDraft } from '../../../lib/core/notifications/notice-plan.ts';
import {
  MORNING_KICKOFF_WAIT_SECONDS,
  morningSlot,
  type NotificationSlot,
  parseSlotKey,
} from '../../../lib/core/notifications/notification-slots.ts';
import type {
  NotificationNoticeStore,
  NotificationPreferenceStore,
  StoredSlot,
} from '../../../lib/core/notifications/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type { FollowerDirectory } from '../../../lib/core/profile/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type {
  SlotCollector,
  SlotCollectStep,
} from '../../application/notifications/ports.ts';

export const FOLLOWERS_PER_STEP = 2000;

// フォロワーの少ない投稿者が多い日も1回の段の問い合わせの回数を抑えるため、フォロワーの一覧の読み取りの回数でも区切る
export const FOLLOWER_PAGES_PER_STEP = 50;

// フォロワーの一覧の1回の読み取りの上限(FollowerDirectoryの最大)
const FOLLOWERS_PER_PAGE = 500;

// 1回の記録の一括の書き込みの実行時間を抑えるため、通知の下書きを分けて記録する
const DRAFTS_PER_RECORD = 500;

const logger = getAppLogger(['event', 'notifications', 'collect']);

const COLLECTED: SlotCollectStep = Object.freeze({
  kind: 'progress',
  cursor: null,
  done: true,
});

const cursorSchema = z.object({
  owners: z.array(
    z.object({
      ownerUserId: z.string().min(1),
      items: z
        .array(
          z.object({
            matchId: z.string().min(1),
            productId: z.string().min(1),
          }),
        )
        .min(1),
    }),
  ),
  ownerIndex: z.int().min(0),
  followAfter: z.string().min(1).nullable(),
});

type MorningCursor = z.infer<typeof cursorSchema>;

type MorningOwner = MorningCursor['owners'][number];

interface LiveSide {
  readonly ownerUserId: string;
  readonly matchId: string;
  readonly productId: string;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function morningDateOf(slot: StoredSlot): BusinessDate {
  const parsed = parseSlotKey(slot.key);
  if (parsed?.kind !== 'morning') {
    throw new RangeError(`朝の枠ではありません: ${slot.key}`);
  }
  return parsed.date;
}

// 0:00の開始のジョブが失敗して、開始の日時を過ぎても開始の記録が無いまま終了の日時を迎えていないマッチ
function isPendingKickoff(record: MatchRecord, now: Date): boolean {
  return (
    record.phase === 'scheduled' &&
    record.startsAt.getTime() <= now.getTime() &&
    now.getTime() < record.endsAt.getTime()
  );
}

function liveSidesOf(records: readonly MatchRecord[]): readonly LiveSide[] {
  return records
    .filter((record) => record.phase === 'live')
    .flatMap((record) =>
      record.entries.flatMap(({ ownerUserId, productId }) =>
        ownerUserId === null || productId === null
          ? []
          : [{ ownerUserId, matchId: record.matchId, productId }],
      ),
    );
}

function ownersOf(sides: readonly LiveSide[]): readonly MorningOwner[] {
  const byOwner = Map.groupBy(sides, ({ ownerUserId }) => ownerUserId);
  return [...byOwner.keys()].toSorted().map((ownerUserId) => ({
    ownerUserId,
    items: (byOwner.get(ownerUserId) ?? []).map(({ matchId, productId }) => ({
      matchId,
      productId,
    })),
  }));
}

function parseCursor(cursor: string): MorningCursor {
  return cursorSchema.parse(JSON.parse(cursor));
}

@injectable()
export class MorningCollector implements SlotCollector {
  constructor(
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

  async step(slot: StoredSlot, now: Date): Promise<SlotCollectStep> {
    const date = morningDateOf(slot);
    if (slot.cursor === null) {
      return this.listOwners(slot.key, date, now);
    }
    return this.collectFollowers(
      morningSlot(date),
      parseCursor(slot.cursor),
      now,
    );
  }

  // 開始の段階で決着したマッチと、終了の日時を過ぎて集計中・確定したマッチは段階がliveでないため含めない
  private async listOwners(
    slotKey: string,
    date: BusinessDate,
    now: Date,
  ): Promise<SlotCollectStep> {
    const records = await this.matches.listForDate({
      date,
      kinds: MATCH_KINDS,
      now,
    });
    const pendingKickoffs = records.filter((record) =>
      isPendingKickoff(record, now),
    ).length;
    if (pendingKickoffs > 0) {
      logger.warn(
        '開始の日時を過ぎても開始していない当日のマッチがあるため、開催通知の収集を待ちます',
        { slot: slotKey, pendingKickoffs },
      );
      return {
        kind: 'wait',
        delaySeconds: MORNING_KICKOFF_WAIT_SECONDS,
        pendingKickoffs,
      };
    }
    const sides = liveSidesOf(records);
    if (sides.length === 0) {
      return COLLECTED;
    }
    const visible = await this.products.findSummaries(
      sides.map(({ productId }) => productId),
      'visible',
    );
    const owners = ownersOf(
      sides.filter(({ productId }) => visible.has(productId)),
    );
    if (owners.length === 0) {
      return COLLECTED;
    }
    const cursor: MorningCursor = {
      owners: [...owners],
      ownerIndex: 0,
      followAfter: null,
    };
    return { kind: 'progress', cursor: JSON.stringify(cursor), done: false };
  }

  private async collectFollowers(
    slot: NotificationSlot,
    cursor: MorningCursor,
    now: Date,
  ): Promise<SlotCollectStep> {
    const { owners } = cursor;
    let { ownerIndex, followAfter } = cursor;
    let followersLeft = FOLLOWERS_PER_STEP;
    let pagesLeft = FOLLOWER_PAGES_PER_STEP;
    let owner = owners[ownerIndex];
    while (owner !== undefined && followersLeft > 0 && pagesLeft > 0) {
      const page = await this.followers.listVisibleFollowerIds({
        after: followAfter ?? undefined,
        followeeId: owner.ownerUserId,
        limit: Math.min(FOLLOWERS_PER_PAGE, followersLeft),
      });
      pagesLeft -= 1;
      followersLeft -= page.followerIds.length;
      await this.recordNotices(slot, owner, page.followerIds, now);
      if (page.next === undefined) {
        ownerIndex += 1;
        followAfter = null;
        owner = owners[ownerIndex];
      } else {
        followAfter = page.next;
      }
    }
    const next: MorningCursor = { owners, ownerIndex, followAfter };
    return {
      kind: 'progress',
      cursor: JSON.stringify(next),
      done: owner === undefined,
    };
  }

  private async recordNotices(
    slot: NotificationSlot,
    owner: MorningOwner,
    followerIds: readonly string[],
    at: Date,
  ): Promise<void> {
    if (followerIds.length === 0) {
      return;
    }
    const eligible = await this.preferences.eligibleRecipients(
      followerIds,
      'followed_user_match',
    );
    const drafts: NoticeDraft[] = followerIds
      .filter((followerId) => eligible.has(followerId))
      .flatMap((recipientUserId) =>
        owner.items.map(({ matchId, productId }) => ({
          topic: 'followed_user_match',
          recipientUserId,
          slot,
          matchId,
          entryId: null,
          productId,
          eventId: null,
        })),
      );
    for (const part of chunk(drafts, DRAFTS_PER_RECORD)) {
      await this.notices.record(part, at);
    }
  }
}
