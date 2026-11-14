import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { matches } from '../../../db/schema/match/matches.ts';
import type { MatchDirectory } from '../../../lib/core/match/ports.ts';
import { MORNING_KICKOFF_WAIT_SECONDS } from '../../../lib/core/notifications/notification-slots.ts';
import {
  eveningSlot,
  morningSlot,
} from '../../../lib/core/notifications/notification-slots.ts';
import type { StoredSlot } from '../../../lib/core/notifications/ports.ts';
import type { FollowerDirectory } from '../../../lib/core/profile/ports.ts';
import { createSequentialIds } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { D1MatchDirectory } from '../../../lib/workers/match/d1-match-directory.ts';
import {
  DECIDED_AT,
  DURING_MATCH,
  STARTS_AT,
} from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import { D1NotificationNoticeStore } from '../../../lib/workers/notifications/d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from '../../../lib/workers/notifications/d1-notification-preference-store.ts';
import { D1NotificationSlotStore } from '../../../lib/workers/notifications/d1-notification-slot-store.ts';
import {
  clearFollows,
  followIdOf,
  insertFollowers,
  MATCH_DAY,
  seedMatchOwners,
} from '../../../lib/workers/notifications/testing/notification-event-fixtures.ts';
import {
  db,
  insertPreference,
  insertPreferences,
  insertUser,
  insertUsers,
  readNoticeRows,
  T0,
  userIdOf,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { D1ProductDirectory } from '../../../lib/workers/product/d1-product-directory.ts';
import {
  insertProduct,
  insertProducts,
  productIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1FollowDirectory } from '../../../lib/workers/profile/d1-follow-directory.ts';
import type {
  SlotCollector,
  SlotCollectStep,
} from '../../application/notifications/ports.ts';
import {
  FOLLOWER_PAGES_PER_STEP,
  FOLLOWERS_PER_STEP,
  MorningCollector,
} from './morning-collector.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const SLOT = morningSlot(MATCH_DAY);
const FOLLOWER_PAGE_SIZE = 500;

// 利用者1の2つ目のプロダクト、表示できないプロダクトを持つ利用者5、マッチ中の利用者6
const SECOND_PRODUCT_OF_OWNER_1 = 7;
const HIDDEN_OWNER = 5;
const LIVE_OWNER = 6;

interface FollowerPageRequest {
  readonly after: string | undefined;
  readonly followeeId: string;
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
      requests.push({ ...input });
      return directory.listVisibleFollowerIds(input);
    },
  };
}

const slots = new D1NotificationSlotStore(db, createSequentialIds(8000));

let followers = createRecordingFollowers();
let matchDirectory: MatchDirectory = new D1MatchDirectory(db);

function createCollector(): SlotCollector {
  return new MorningCollector(
    matchDirectory,
    new D1ProductDirectory(db),
    followers,
    new D1NotificationPreferenceStore(db),
    new D1NotificationNoticeStore(db, createSequentialIds(5000), slots),
  );
}

let collector = createCollector();

const LIVE = { startedAt: STARTS_AT } as const;

// 側ごとに[プロダクトの番号, 投稿者の番号]を指定する
function matchOf(
  index: number,
  sides: readonly (readonly [number, number])[],
  columns: MatchFixture['columns'] = {},
): MatchFixture {
  return {
    index,
    columns,
    entries: sides.map(([product, owner], position) => ({
      index: index * 10 + position + 1,
      launch: null,
      product,
      owner,
    })),
  };
}

async function storedSlot(cursor: string | null = null): Promise<StoredSlot> {
  return { ...(await slots.ensure(SLOT, T0)), cursor };
}

function cursorOf(step: SlotCollectStep): string {
  if (step.kind !== 'progress' || step.cursor === null) {
    throw new Error('カーソルを持つ進行の結果ではありません');
  }
  return step.cursor;
}

function progressOf(step: SlotCollectStep): { readonly done: boolean } {
  cursorOf(step);
  return { done: step.kind === 'progress' && step.done };
}

function cursorValueOf(step: SlotCollectStep): unknown {
  return JSON.parse(cursorOf(step));
}

function ownerIdsOf(step: SlotCollectStep): readonly string[] {
  const { owners } = cursorValueOf(step) as {
    readonly owners: readonly { readonly ownerUserId: string }[];
  };
  return owners.map(({ ownerUserId }) => ownerUserId);
}

async function seedMatchFollowers(
  followeeIndex: number,
  followerIndexes: readonly number[],
): Promise<void> {
  await insertUsers(followerIndexes, { emailVerifiedAt: T0 });
  await insertPreferences(followerIndexes, 'followed_user_match', true);
  await insertFollowers(followeeIndex, followerIndexes);
}

function rangeOf(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, offset) => first + offset);
}

async function readNoticeSummaries() {
  return (await readNoticeRows()).map((row) => [
    row.recipientUserId,
    row.matchId,
    row.productId,
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearFollows();
  await seedMatchOwners();
  await insertProduct(SECOND_PRODUCT_OF_OWNER_1, 1);
  await insertUser(HIDDEN_OWNER, { emailVerifiedAt: T0 });
  await insertProduct(HIDDEN_OWNER, HIDDEN_OWNER, { hiddenAt: T0 });
  await insertUser(LIVE_OWNER, { emailVerifiedAt: T0 });
  await insertProduct(LIVE_OWNER, LIVE_OWNER);
  followers = createRecordingFollowers();
  matchDirectory = new D1MatchDirectory(db);
  collector = createCollector();
});

describe('MorningCollector.stepの1回目の段', () => {
  test('マッチ中の予選とトーナメントの表示できるプロダクトの投稿者の一覧を、投稿者のIDの昇順にカーソルへ載せ、フォロワーを読まずに続きを返す', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        LIVE,
      ),
      matchOf(
        2,
        [
          [3, 3],
          [SECOND_PRODUCT_OF_OWNER_1, 1],
        ],
        {
          ...LIVE,
          kind: 'week',
          round: 1,
        },
      ),
      matchOf(3, [[4, 4]], {
        startedAt: STARTS_AT,
        decidedAt: STARTS_AT,
        decision: 'bye',
      }),
      matchOf(
        4,
        [
          [HIDDEN_OWNER, HIDDEN_OWNER],
          [LIVE_OWNER, LIVE_OWNER],
        ],
        {
          ...LIVE,
          kind: 'year',
          round: 1,
        },
      ),
    ]);

    const step = await collector.step(await storedSlot(), DURING_MATCH);

    expect(progressOf(step)).toStrictEqual({ done: false });
    expect(cursorValueOf(step)).toStrictEqual({
      owners: [
        {
          ownerUserId: userIdOf(1),
          items: [
            { matchId: matchIdOf(1), productId: productIdOf(1) },
            {
              matchId: matchIdOf(2),
              productId: productIdOf(SECOND_PRODUCT_OF_OWNER_1),
            },
          ],
        },
        {
          ownerUserId: userIdOf(2),
          items: [{ matchId: matchIdOf(1), productId: productIdOf(2) }],
        },
        {
          ownerUserId: userIdOf(3),
          items: [{ matchId: matchIdOf(2), productId: productIdOf(3) }],
        },
        {
          ownerUserId: userIdOf(LIVE_OWNER),
          items: [
            { matchId: matchIdOf(4), productId: productIdOf(LIVE_OWNER) },
          ],
        },
      ],
      ownerIndex: 0,
      followAfter: null,
    });
    expect(followers.requests).toEqual([]);
    expect(await readNoticeRows()).toEqual([]);
  });

  test('開始時点で決着したマッチと集計中・確定したマッチの投稿者は一覧に載せず、マッチ中のマッチが無ければ完了する', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        {
          startedAt: STARTS_AT,
          decidedAt: STARTS_AT,
          decision: 'walkover',
        },
      ),
      matchOf(
        2,
        [
          [3, 3],
          [4, 4],
        ],
        {
          startedAt: STARTS_AT,
          decidedAt: DECIDED_AT,
          decision: 'votes',
        },
      ),
    ]);

    const step = await collector.step(await storedSlot(), DURING_MATCH);

    expect(step).toStrictEqual({ kind: 'progress', cursor: null, done: true });
    expect(await readNoticeRows()).toEqual([]);
  });

  test('開始の日時を過ぎても未開始の当日のマッチが残る間は、一覧を作らずに待ちの秒数と未開始の件数を返す', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        LIVE,
      ),
      matchOf(
        2,
        [
          [3, 3],
          [4, 4],
        ],
        { kind: 'week', round: 1 },
      ),
      matchOf(3, [[LIVE_OWNER, LIVE_OWNER]]),
    ]);

    const step = await collector.step(await storedSlot(), DURING_MATCH);

    expect(step).toStrictEqual({
      kind: 'wait',
      delaySeconds: MORNING_KICKOFF_WAIT_SECONDS,
      pendingKickoffs: 2,
    });
    expect(MORNING_KICKOFF_WAIT_SECONDS).toBe(300);
    expect(followers.requests).toEqual([]);
  });

  test('未開始だったマッチが開始された後は、そのマッチを含めて一覧を作る', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        LIVE,
      ),
      matchOf(
        2,
        [
          [3, 3],
          [4, 4],
        ],
        { kind: 'week', round: 1 },
      ),
    ]);
    await collector.step(await storedSlot(), DURING_MATCH);
    await db
      .update(matches)
      .set({ startedAt: DURING_MATCH })
      .where(eq(matches.id, matchIdOf(2)));

    const step = await collector.step(
      await storedSlot(),
      new Date(DURING_MATCH.getTime() + MORNING_KICKOFF_WAIT_SECONDS * 1000),
    );

    expect(ownerIdsOf(step)).toEqual([
      userIdOf(1),
      userIdOf(2),
      userIdOf(3),
      userIdOf(4),
    ]);
  });

  test('未開始のマッチの終了の日時を過ぎた後と、開始の日時の前のマッチは待たずに、開始したマッチだけで一覧を作る', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        LIVE,
      ),
      matchOf(
        2,
        [
          [3, 3],
          [4, 4],
        ],
        {
          kind: 'week',
          round: 1,
          endsAt: new Date(STARTS_AT.getTime() + 1_800_000),
        },
      ),
      matchOf(3, [[LIVE_OWNER, LIVE_OWNER]], {
        startsAt: new Date(DURING_MATCH.getTime() + 60_000),
      }),
    ]);

    const step = await collector.step(await storedSlot(), DURING_MATCH);

    expect(ownerIdsOf(step)).toEqual([userIdOf(1), userIdOf(2)]);
  });

  test('マッチの照会に処理の時点の時刻と、予選とトーナメントの種別を渡す', async () => {
    const directory = new D1MatchDirectory(db);
    const listForDate = vi.spyOn(directory, 'listForDate');
    matchDirectory = directory;
    collector = createCollector();

    await collector.step(await storedSlot(), DURING_MATCH);

    expect(listForDate.mock.calls.map(([input]) => input)).toEqual([
      {
        date: MATCH_DAY,
        kinds: ['qualifier', 'week', 'year'],
        now: DURING_MATCH,
      },
    ]);
  });

  test('朝の枠でない枠は収集せずに例外を投げる', async () => {
    const slot = await slots.ensure(eveningSlot(MATCH_DAY), T0);

    await expect(collector.step(slot, DURING_MATCH)).rejects.toThrow(
      RangeError,
    );
  });
});

describe('MorningCollector.stepの2回目以降の段', () => {
  test('投稿者ごとのフォロワーのうち受信する設定の送信の対象者に、投稿者の全ての対象の開催通知を朝の枠へ記録して完了する', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        LIVE,
      ),
      matchOf(
        2,
        [
          [3, 3],
          [SECOND_PRODUCT_OF_OWNER_1, 1],
        ],
        {
          ...LIVE,
          kind: 'week',
          round: 1,
        },
      ),
    ]);
    await seedMatchFollowers(1, [101]);
    await seedMatchFollowers(3, [102]);
    await insertUsers([103], { emailVerifiedAt: T0 });
    await insertPreference(103, 'followed_user_match', false);
    await insertUser(104);
    await insertPreference(104, 'followed_user_match', true);
    await insertFollowers(2, [103, 104]);
    const first = await collector.step(await storedSlot(), DURING_MATCH);

    const step = await collector.step(
      await storedSlot(cursorOf(first)),
      DURING_MATCH,
    );

    expect(progressOf(step)).toStrictEqual({ done: true });
    expect(await readNoticeSummaries()).toEqual([
      [userIdOf(101), matchIdOf(1), productIdOf(1)],
      [userIdOf(101), matchIdOf(2), productIdOf(SECOND_PRODUCT_OF_OWNER_1)],
      [userIdOf(102), matchIdOf(2), productIdOf(3)],
    ]);
    expect(await readNoticeRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: 'followed_user_match',
          slotKey: SLOT.key,
          groupKey: `${SLOT.key}:${userIdOf(101)}`,
          entryId: null,
          eventId: null,
          status: 'pending',
          createdAt: DURING_MATCH,
        }),
      ]),
    );
  });

  test('1回の段は2,000件のフォロワーで区切り、続きのカーソルから次の投稿者へ進む', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        LIVE,
      ),
    ]);
    await seedMatchFollowers(1, rangeOf(1001, 2001));
    await seedMatchFollowers(2, [5001]);
    const first = await collector.step(await storedSlot(), DURING_MATCH);

    const second = await collector.step(
      await storedSlot(cursorOf(first)),
      DURING_MATCH,
    );

    expect(FOLLOWERS_PER_STEP).toBe(2000);
    expect(progressOf(second)).toStrictEqual({ done: false });
    expect(cursorValueOf(second)).toEqual(
      expect.objectContaining({ ownerIndex: 0, followAfter: followIdOf(3000) }),
    );
    expect(followers.requests).toEqual([
      { after: undefined, followeeId: userIdOf(1), limit: FOLLOWER_PAGE_SIZE },
      {
        after: followIdOf(1500),
        followeeId: userIdOf(1),
        limit: FOLLOWER_PAGE_SIZE,
      },
      {
        after: followIdOf(2000),
        followeeId: userIdOf(1),
        limit: FOLLOWER_PAGE_SIZE,
      },
      {
        after: followIdOf(2500),
        followeeId: userIdOf(1),
        limit: FOLLOWER_PAGE_SIZE,
      },
    ]);
    expect(await readNoticeRows()).toHaveLength(2000);

    const third = await collector.step(
      await storedSlot(cursorOf(second)),
      DURING_MATCH,
    );

    expect(progressOf(third)).toStrictEqual({ done: true });
    expect(followers.requests.slice(4)).toEqual([
      {
        after: followIdOf(3000),
        followeeId: userIdOf(1),
        limit: FOLLOWER_PAGE_SIZE,
      },
      { after: undefined, followeeId: userIdOf(2), limit: FOLLOWER_PAGE_SIZE },
    ]);
    const notices = await readNoticeRows();
    expect(notices).toHaveLength(2002);
    expect(new Set(notices.map((row) => row.recipientUserId)).size).toBe(2002);
  });

  test('フォロワーの少ない投稿者が多くても、1回の段で読むフォロワーの一覧の回数を区切る', async () => {
    const owners = rangeOf(201, FOLLOWER_PAGES_PER_STEP + 2);
    await insertUsers(owners, { emailVerifiedAt: T0 });
    for (const owner of owners) {
      await insertProducts([owner], owner);
    }
    await insertMatches(
      rangeOf(0, owners.length / 2).map((pair) => {
        const [left, right] = [201 + pair * 2, 202 + pair * 2];
        return matchOf(
          100 + pair,
          [
            [left, left],
            [right, right],
          ],
          LIVE,
        );
      }),
    );
    const first = await collector.step(await storedSlot(), DURING_MATCH);

    const second = await collector.step(
      await storedSlot(cursorOf(first)),
      DURING_MATCH,
    );

    expect(progressOf(second)).toStrictEqual({ done: false });
    expect(followers.requests).toHaveLength(FOLLOWER_PAGES_PER_STEP);
    expect(cursorValueOf(second)).toEqual(
      expect.objectContaining({
        ownerIndex: FOLLOWER_PAGES_PER_STEP,
        followAfter: null,
      }),
    );

    const third = await collector.step(
      await storedSlot(cursorOf(second)),
      DURING_MATCH,
    );

    expect(third).toEqual(expect.objectContaining({ done: true }));
    expect(followers.requests).toHaveLength(owners.length);
  });

  test('同じカーソルの段を再実行しても、通知は増えない', async () => {
    await insertMatches([
      matchOf(
        1,
        [
          [1, 1],
          [2, 2],
        ],
        LIVE,
      ),
    ]);
    await seedMatchFollowers(1, [101, 102]);
    const first = await collector.step(await storedSlot(), DURING_MATCH);
    const slot = await storedSlot(cursorOf(first));
    await collector.step(slot, DURING_MATCH);
    const recorded = await readNoticeRows();

    const step = await collector.step(slot, DURING_MATCH);

    expect(step).toEqual(expect.objectContaining({ done: true }));
    expect(await readNoticeRows()).toEqual(recorded);
  });

  test('形式に合わないカーソルは例外を投げる', async () => {
    await expect(
      collector.step(await storedSlot('{"owners":1}'), DURING_MATCH),
    ).rejects.toThrow();
  });
});
