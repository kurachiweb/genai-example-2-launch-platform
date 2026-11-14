import { beforeEach, describe, expect, test } from 'vitest';

import { notificationEvents } from '../../../db/schema/notifications/notification-events.ts';
import {
  awardSlot,
  resultSlotFor,
} from '../../core/notifications/notification-slots.ts';
import type { NotificationEventExpander } from '../../core/notifications/ports.ts';
import type { FollowerDirectory } from '../../core/profile/ports.ts';
import { createSequentialIds } from '../identity/testing/identity-store-fixtures.ts';
import { D1MatchDirectory } from '../match/d1-match-directory.ts';
import { AFTER_DECISION } from '../match/testing/directory-fixtures.ts';
import { insertMatches, matchIdOf } from '../match/testing/match-fixtures.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import { insertProduct } from '../product/testing/product-fixtures.ts';
import { D1FollowDirectory } from '../profile/d1-follow-directory.ts';
import { D1NotificationEventExpander } from './d1-notification-event-expander.ts';
import { D1NotificationNoticeStore } from './d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from './d1-notification-preference-store.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import {
  awardProductIdOf,
  clearFollows,
  followIdOf,
  insertEventRow,
  insertFollowers,
  MATCH_DAY,
  seedAwardFollowers,
  seedMatchOwners,
  tournamentMatch,
} from './testing/notification-event-fixtures.ts';
import {
  after,
  db,
  insertPreference,
  insertUser,
  readEventRows,
  readNoticeRows,
  readSlotRow,
  T0,
  userIdOf,
} from './testing/notification-store-fixtures.ts';

const EVENT_ID = `01JC0EVNT${'1'.padStart(17, '0')}`;
const MISSING_EVENT_ID = `01JC0EVNT${'9'.padStart(17, '0')}`;
const BUDGET = 2000;
const LEASE_SECONDS = 120;

const AWARD_OWNER = 1;
const AWARD_PRODUCT = 11;
const FOLLOWER_PAGE_SIZE = 500;
const AT = after(60_000);

const slots = new D1NotificationSlotStore(db, createSequentialIds(9000));

interface FollowerPageRequest {
  readonly after: string | undefined;
  readonly limit: number;
}

// 読み取りの区切りを確かめるため、ローカルD1のフォロワーの一覧に渡した引数を記録する
function createRecordingFollowers(): FollowerDirectory & {
  readonly requests: FollowerPageRequest[];
} {
  const directory = new D1FollowDirectory(db);
  const requests: FollowerPageRequest[] = [];
  return {
    requests,
    listVisibleFollowerIds: (input) => {
      requests.push({ after: input.after, limit: input.limit });
      return directory.listVisibleFollowerIds(input);
    },
  };
}

let followers = createRecordingFollowers();

function createExpander(): NotificationEventExpander {
  return new D1NotificationEventExpander(
    db,
    new D1MatchDirectory(db),
    new D1ProductDirectory(db),
    followers,
    new D1NotificationPreferenceStore(db),
    new D1NotificationNoticeStore(
      db,
      createSequentialIds(5000),
      new D1NotificationSlotStore(db, createSequentialIds(8000)),
    ),
  );
}

let expander = createExpander();

async function insertResultEvent(
  match: number,
  columns: Partial<typeof notificationEvents.$inferInsert> = {},
): Promise<void> {
  await insertEventRow({
    id: EVENT_ID,
    type: 'match_result',
    dedupeKey: `match_result:${matchIdOf(match)}`,
    publisher: 'tournament-week',
    matchId: matchIdOf(match),
    occurredAt: T0,
    lastDispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

const DONE = { kind: 'done', lateSlotKeys: [], flushSlotKey: null } as const;

async function insertAwardEvent(
  columns: Partial<typeof notificationEvents.$inferInsert> = {},
): Promise<void> {
  await insertEventRow({
    id: EVENT_ID,
    type: 'award',
    dedupeKey: `award:product_of_the_week:2026-W47:${awardProductIdOf(AWARD_PRODUCT)}`,
    publisher: 'tournament-week',
    award: 'product_of_the_week',
    period: '2026-W47',
    productId: awardProductIdOf(AWARD_PRODUCT),
    occurredAt: T0,
    lastDispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

function rangeOf(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, offset) => first + offset);
}

const AWARD_SLOT_KEY = awardSlot(EVENT_ID, T0).key;

beforeEach(async () => {
  await clearFollows();
  await seedMatchOwners();
  followers = createRecordingFollowers();
  expander = createExpander();
});

describe('マッチの通知イベントの展開', () => {
  test('未展開の結果を受信する設定の投稿者の通知へ展開し、展開済みにする', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 3])]);
    await insertResultEvent(1);

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(
      (await readNoticeRows()).map((row) => [
        row.topic,
        row.recipientUserId,
        row.slotKey,
      ]),
    ).toEqual([['match_result', userIdOf(1), resultSlotFor(MATCH_DAY).key]]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({
        status: 'expanded',
        expandedAt: AFTER_DECISION,
        updatedAt: AFTER_DECISION,
      }),
    ]);
  });

  test('送り出し中の枠に入った通知は、遅れた枠として返す', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    await insertResultEvent(1);
    const slot = resultSlotFor(MATCH_DAY);
    await slots.ensure(slot, T0);
    await slots.acquireLease(slot.key, 'test', T0, LEASE_SECONDS);
    await slots.advance(
      slot.key,
      'test',
      { phase: 'sending', cursor: null },
      T0,
    );

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual({ ...DONE, lateSlotKeys: [slot.key] });
  });

  test('展開済みの通知イベントは何もせずに完了する', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    await insertResultEvent(1, { status: 'expanded', expandedAt: T0 });

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(await readNoticeRows()).toEqual([]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ expandedAt: T0 }),
    ]);
  });

  test('無い通知イベントは何もせずに完了する', async () => {
    const outcome = await expander.expand(
      MISSING_EVENT_ID,
      AFTER_DECISION,
      BUDGET,
    );

    expect(outcome).toEqual(DONE);
  });

  test('マッチが消えた通知イベントは通知を作らずに展開済みにする', async () => {
    await insertResultEvent(1);

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(await readNoticeRows()).toEqual([]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ status: 'expanded' }),
    ]);
  });

  test('開始した後に展開する予告は通知を作らない', async () => {
    await insertMatches([tournamentMatch(1, 'live', [1, 3])]);
    await insertResultEvent(1, {
      type: 'match_preview',
      dedupeKey: `match_preview:${matchIdOf(1)}`,
    });

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(await readNoticeRows()).toEqual([]);
  });
});

describe('受賞の通知イベントの展開', () => {
  beforeEach(async () => {
    await insertProduct(AWARD_PRODUCT, AWARD_OWNER, {
      id: awardProductIdOf(AWARD_PRODUCT),
    });
  });

  test('受信する設定の送信の対象者のフォロワーの通知を受賞の枠へ記録し、展開済みにして受賞の枠を返す', async () => {
    await seedAwardFollowers(AWARD_OWNER, [101]);
    await insertUser(102, { emailVerifiedAt: T0 });
    await insertPreference(102, 'followed_user_award', false);
    await insertUser(103);
    await insertPreference(103, 'followed_user_award', true);
    await insertUser(104, {
      emailVerifiedAt: T0,
      status: 'suspended',
      suspendedAt: T0,
    });
    await insertPreference(104, 'followed_user_award', true);
    await insertFollowers(AWARD_OWNER, [102, 103, 104]);
    await seedAwardFollowers(2, [105]);
    await insertAwardEvent();

    const outcome = await expander.expand(EVENT_ID, AT, BUDGET);

    expect(outcome).toEqual({ ...DONE, flushSlotKey: AWARD_SLOT_KEY });
    expect(await readNoticeRows()).toEqual([
      expect.objectContaining({
        topic: 'followed_user_award',
        recipientUserId: userIdOf(101),
        slotKey: AWARD_SLOT_KEY,
        groupKey: `${AWARD_SLOT_KEY}:${userIdOf(101)}`,
        matchId: null,
        entryId: null,
        productId: awardProductIdOf(AWARD_PRODUCT),
        eventId: EVENT_ID,
        status: 'pending',
      }),
    ]);
    expect(await readSlotRow(AWARD_SLOT_KEY)).toEqual(
      expect.objectContaining({ kind: 'award', dispatchRequestedAt: AT }),
    );
    expect(await readEventRows()).toEqual([
      expect.objectContaining({
        status: 'expanded',
        expandedAt: AT,
        updatedAt: AT,
      }),
    ]);
  });

  test('フォロワーを500件ずつ読み、1回の処理の上限で区切ってカーソルを保存し、続きを返す', async () => {
    await seedAwardFollowers(AWARD_OWNER, rangeOf(1001, 2001));
    await insertAwardEvent();

    const first = await expander.expand(EVENT_ID, AT, BUDGET);

    expect(first).toEqual({ kind: 'continue' });
    expect(followers.requests).toEqual([
      { after: undefined, limit: FOLLOWER_PAGE_SIZE },
      { after: followIdOf(1500), limit: FOLLOWER_PAGE_SIZE },
      { after: followIdOf(2000), limit: FOLLOWER_PAGE_SIZE },
      { after: followIdOf(2500), limit: FOLLOWER_PAGE_SIZE },
    ]);
    expect(await readNoticeRows()).toHaveLength(2000);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({
        status: 'pending',
        cursor: followIdOf(3000),
        expandedAt: null,
        updatedAt: AT,
      }),
    ]);

    const second = await expander.expand(EVENT_ID, after(120_000), BUDGET);

    expect(second).toEqual({ ...DONE, flushSlotKey: AWARD_SLOT_KEY });
    expect(followers.requests.at(-1)).toEqual({
      after: followIdOf(3000),
      limit: FOLLOWER_PAGE_SIZE,
    });
    const notices = await readNoticeRows();
    expect(notices).toHaveLength(2001);
    expect(new Set(notices.map((row) => row.recipientUserId)).size).toBe(2001);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({
        status: 'expanded',
        expandedAt: after(120_000),
      }),
    ]);
  });

  test('残りの上限が500件より少なければ、残りの件数だけ読む', async () => {
    await seedAwardFollowers(AWARD_OWNER, rangeOf(101, 5));
    await insertAwardEvent();

    const first = await expander.expand(EVENT_ID, AT, 3);
    const second = await expander.expand(EVENT_ID, AT, 3);

    expect([first, second]).toEqual([
      { kind: 'continue' },
      { ...DONE, flushSlotKey: AWARD_SLOT_KEY },
    ]);
    expect(followers.requests).toEqual([
      { after: undefined, limit: 3 },
      { after: followIdOf(103), limit: 3 },
    ]);
    expect(await readNoticeRows()).toHaveLength(5);
  });

  test('送り出し中の受賞の枠に入った通知は、遅れた枠としても返す', async () => {
    await seedAwardFollowers(AWARD_OWNER, [101]);
    await insertAwardEvent();
    const slot = awardSlot(EVENT_ID, T0);
    await slots.ensure(slot, T0);
    await slots.acquireLease(slot.key, 'test', T0, LEASE_SECONDS);
    await slots.advance(
      slot.key,
      'test',
      { phase: 'sending', cursor: null },
      T0,
    );

    const outcome = await expander.expand(EVENT_ID, AT, BUDGET);

    expect(outcome).toEqual({
      kind: 'done',
      lateSlotKeys: [AWARD_SLOT_KEY],
      flushSlotKey: AWARD_SLOT_KEY,
    });
  });

  test('表示できないプロダクトの受賞は、フォロワーを読まずに0件で展開済みにする', async () => {
    await seedAwardFollowers(AWARD_OWNER, [101]);
    await insertAwardEvent({
      productId: awardProductIdOf(99),
      dedupeKey: `award:product_of_the_week:2026-W47:${awardProductIdOf(99)}`,
    });

    const outcome = await expander.expand(EVENT_ID, AT, BUDGET);

    expect(outcome).toEqual({ ...DONE, flushSlotKey: AWARD_SLOT_KEY });
    expect(followers.requests).toEqual([]);
    expect(await readNoticeRows()).toEqual([]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ status: 'expanded', expandedAt: AT }),
    ]);
  });

  test('投稿者が停止中のプロダクトの受賞は0件で展開済みにする', async () => {
    await insertUser(5, { status: 'suspended', suspendedAt: T0 });
    await insertProduct(12, 5, { id: awardProductIdOf(12) });
    await seedAwardFollowers(5, [101]);
    await insertAwardEvent({
      productId: awardProductIdOf(12),
      dedupeKey: `award:product_of_the_week:2026-W47:${awardProductIdOf(12)}`,
    });

    const outcome = await expander.expand(EVENT_ID, AT, BUDGET);

    expect(outcome).toEqual({ ...DONE, flushSlotKey: AWARD_SLOT_KEY });
    expect(followers.requests).toEqual([]);
    expect(await readNoticeRows()).toEqual([]);
  });

  test('展開の途中から再実行しても、通知は増えない', async () => {
    await seedAwardFollowers(AWARD_OWNER, rangeOf(101, 5));
    await insertAwardEvent();
    await expander.expand(EVENT_ID, AT, BUDGET);
    const recorded = await readNoticeRows();
    await db
      .update(notificationEvents)
      .set({ status: 'pending', expandedAt: null, cursor: followIdOf(102) });

    const outcome = await expander.expand(EVENT_ID, after(120_000), BUDGET);

    expect(outcome).toEqual({ ...DONE, flushSlotKey: AWARD_SLOT_KEY });
    expect(await readNoticeRows()).toEqual(recorded);
  });

  test('展開済みの受賞は、通知を作らずに受賞の枠を返す', async () => {
    await seedAwardFollowers(AWARD_OWNER, [101]);
    await insertAwardEvent({ status: 'expanded', expandedAt: T0 });

    const outcome = await expander.expand(EVENT_ID, AT, BUDGET);

    expect(outcome).toEqual({ ...DONE, flushSlotKey: AWARD_SLOT_KEY });
    expect(followers.requests).toEqual([]);
    expect(await readNoticeRows()).toEqual([]);
  });

  test('1回の処理の上限が正の整数でなければ、展開せずに例外を投げる', async () => {
    await seedAwardFollowers(AWARD_OWNER, [101]);
    await insertAwardEvent();

    await expect(expander.expand(EVENT_ID, AT, 0)).rejects.toThrow(RangeError);
    await expect(expander.expand(EVENT_ID, AT, 1.5)).rejects.toThrow(
      RangeError,
    );
    expect(await readNoticeRows()).toEqual([]);
  });
});
