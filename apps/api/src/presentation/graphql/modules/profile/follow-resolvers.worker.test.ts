import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { userFollows } from '../../../../../db/schema/follow/user-follows.ts';
import { users } from '../../../../../db/schema/identity/users.ts';
import {
  after,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
  fetchMyFollowers,
  fetchMyFollowing,
  followUser,
  installProfileGraphQLTest,
  issueUserSession,
  suspendUser,
  unfollowUser,
} from '../../../../../test/support/profile-graphql-operations.ts';
import { encodeCursor } from '../../pagination.ts';

const ALICE = 1;
const BOB = 2;
const CAROL = 3;

const FOLLOW_BOT_TOKEN = botTokenFor('follow');

const FIRST_OUT_OF_RANGE_MESSAGE =
  '表示する件数は1〜20件の整数で指定してください。';

const INVALID_CURSOR_MESSAGE = 'ページの位置の指定が正しくありません。';

installProfileGraphQLTest();

const followIdOf = (index: number): string =>
  `01JC0FLW${String(index).padStart(18, '0')}`;

async function insertAlice(
  columns: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  await insertUser(ALICE, {
    handle: 'alice',
    nickname: 'アリス',
    emailVerifiedAt: T0,
    ...columns,
  });
  return issueUserSession(ALICE);
}

async function insertBob(
  columns: Partial<typeof users.$inferInsert> = {},
): Promise<void> {
  await insertUser(BOB, { handle: 'Bob', nickname: 'ボブ', ...columns });
}

interface FollowSeed {
  readonly follower: number;
  readonly followee: number;
  readonly createdAt?: Date;
  readonly deletedAt?: Date;
}

const FOLLOWS_PER_INSERT = 10;

async function insertFollows(seeds: readonly FollowSeed[]): Promise<void> {
  const rows = seeds.map((seed, index) => ({
    id: followIdOf(index + 1),
    followerId: userIdOf(seed.follower),
    followeeId: userIdOf(seed.followee),
    createdAt: seed.createdAt ?? T0,
    updatedAt: seed.createdAt ?? T0,
    ...(seed.deletedAt !== undefined && { deletedAt: seed.deletedAt }),
  }));
  for (let start = 0; start < rows.length; start += FOLLOWS_PER_INSERT) {
    await db
      .insert(userFollows)
      .values(rows.slice(start, start + FOLLOWS_PER_INSERT));
  }
}

async function readFollows() {
  return db.select().from(userFollows);
}

async function unsuspendUser(userIndex: number): Promise<void> {
  await db
    .update(users)
    .set({ status: 'active', suspendedAt: null })
    .where(eq(users.id, userIdOf(userIndex)));
}

describe('呼び出し元の確認', () => {
  test.each([
    ['followUser', () => followUser('bob', { caller: 'admin' })],
    ['unfollowUser', () => unfollowUser('bob', { caller: 'admin' })],
    ['myFollowing', () => fetchMyFollowing({ first: 20 }, { caller: 'admin' })],
    ['myFollowers', () => fetchMyFollowers({ first: 20 }, { caller: 'admin' })],
  ])(
    '管理者側の呼び出し元からの%sは、bot判定の前にforbiddenで拒否する',
    async (_name, call) => {
      const calls = stubExternalServices();
      await insertAlice();
      await insertBob();

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await readFollows()).toEqual([]);
    },
  );
});

describe('followUser', () => {
  test('フォローを記録し、相手の現在のハンドルとフォロワー数を返す', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();
    await insertBob();

    const response = await followUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.followUser).toEqual({
      handle: 'Bob',
      following: true,
      followerCount: 1,
    });
    expect(calls.siteverifyTokens).toEqual([FOLLOW_BOT_TOKEN]);
    const rows = await readFollows();
    expect(rows.map((row) => [row.followerId, row.followeeId])).toEqual([
      [userIdOf(ALICE), userIdOf(BOB)],
    ]);
  });

  test('すでにフォロー済みでも成功し、行を増やさない', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertBob();
    const options = { sessionToken: token, botToken: FOLLOW_BOT_TOKEN };

    const first = await followUser('bob', options);
    const second = await followUser('bob', options);

    expect(first.data?.followUser).toEqual(second.data?.followUser);
    expect(second.data?.followUser).toEqual({
      handle: 'Bob',
      following: true,
      followerCount: 1,
    });
    expect(await readFollows()).toHaveLength(1);
  });

  test('フォロワー数は停止中のフォロワーを除いて数える', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertBob();
    await insertUser(CAROL, {
      handle: 'carol',
      status: 'suspended',
      suspendedAt: after(1),
    });
    await insertFollows([{ follower: CAROL, followee: BOB }]);

    const response = await followUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(response.data?.followUser?.followerCount).toBe(1);
  });

  test('ログインしていなければ、bot判定を使わずunauthenticatedで拒否する', async () => {
    const calls = stubExternalServices();
    await insertAlice();
    await insertBob();

    const response = await followUser('bob', { botToken: FOLLOW_BOT_TOKEN });

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readFollows()).toEqual([]);
  });

  test('メールアドレスが未確認なら、bot判定を使わずemail_not_verifiedで拒否する', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice({ emailVerifiedAt: null });
    await insertBob();

    const response = await followUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['email_not_verified']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readFollows()).toEqual([]);
  });

  test('停止中の利用者は、bot判定を使わずaccount_unavailableで拒否する', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();
    await insertBob();
    await suspendUser(ALICE);

    const response = await followUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readFollows()).toEqual([]);
  });

  test.each([
    ['トークンが無い', undefined, 'bot_verification_failed'],
    ['判定に失敗する', BOT_REJECTED_TOKEN, 'bot_verification_failed'],
    [
      '別の操作名の判定の結果である',
      botTokenFor('profile_update'),
      'bot_verification_failed',
    ],
    [
      '判定サービスに到達できない',
      BOT_UNREACHABLE_TOKEN,
      'bot_verification_unavailable',
    ],
  ])('bot判定の%s場合は記録せずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertBob();

    const response = await followUser(
      'bob',
      botToken === undefined
        ? { sessionToken: token }
        : { sessionToken: token, botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect(await readFollows()).toEqual([]);
  });

  test('自分自身はcannot_follow_selfで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await followUser('ALICE', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['cannot_follow_self']);
    expect(response.errors?.[0]?.message).toBe(
      '自分自身はフォローできません。',
    );
    expect(await readFollows()).toEqual([]);
  });

  test.each([
    ['存在しないコード', async () => Promise.resolve(), 'nobody'],
    [
      '停止中の利用者',
      async () => {
        await insertBob({ status: 'suspended', suspendedAt: after(1) });
      },
      'bob',
    ],
    [
      '退会済みの利用者',
      async () => {
        await insertBob({ deletedAt: after(1) });
      },
      'bob',
    ],
  ])(
    '%sはfollow_target_unavailableで拒否する',
    async (_name, prepare, handle) => {
      stubExternalServices();
      const token = await insertAlice();
      await prepare();

      const response = await followUser(handle, {
        sessionToken: token,
        botToken: FOLLOW_BOT_TOKEN,
      });

      expect(codesOf(response)).toEqual(['follow_target_unavailable']);
      expect(response.errors?.[0]?.message).toBe(
        'このユーザーはフォローできません。',
      );
      expect(await readFollows()).toEqual([]);
    },
  );
});

describe('unfollowUser', () => {
  test('フォローを外し、相手のフォロワー数を返す', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();
    await insertBob();
    await insertUser(CAROL, { handle: 'carol' });
    await insertFollows([
      { follower: ALICE, followee: BOB },
      { follower: CAROL, followee: BOB },
    ]);

    const response = await unfollowUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.unfollowUser).toEqual({
      handle: 'Bob',
      following: false,
      followerCount: 1,
    });
    expect(calls.siteverifyTokens).toEqual([FOLLOW_BOT_TOKEN]);
    expect((await readFollows()).map((row) => row.followerId)).toEqual([
      userIdOf(CAROL),
    ]);
  });

  test('フォローしていなくても成功する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertBob();

    const response = await unfollowUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.unfollowUser).toEqual({
      handle: 'Bob',
      following: false,
      followerCount: 0,
    });
  });

  test('停止中の相手のフォローも外せる', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertBob({ status: 'suspended', suspendedAt: after(1) });
    await insertFollows([{ follower: ALICE, followee: BOB }]);

    const response = await unfollowUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.unfollowUser?.following).toBe(false);
    expect(await readFollows()).toEqual([]);
  });

  test('メールアドレスが未確認の利用者も解除できる', async () => {
    stubExternalServices();
    const token = await insertAlice({ emailVerifiedAt: null });
    await insertBob();
    await insertFollows([{ follower: ALICE, followee: BOB }]);

    const response = await unfollowUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(await readFollows()).toEqual([]);
  });

  test('ログインしていなければ、bot判定を使わずunauthenticatedで拒否する', async () => {
    const calls = stubExternalServices();
    await insertAlice();
    await insertBob();
    await insertFollows([{ follower: ALICE, followee: BOB }]);

    const response = await unfollowUser('bob', { botToken: FOLLOW_BOT_TOKEN });

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readFollows()).toHaveLength(1);
  });

  test('停止中の利用者は、bot判定を使わずaccount_unavailableで拒否する', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();
    await insertBob();
    await insertFollows([{ follower: ALICE, followee: BOB }]);
    await suspendUser(ALICE);

    const response = await unfollowUser('bob', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await readFollows()).toHaveLength(1);
  });

  test.each([
    ['トークンが無い', undefined, 'bot_verification_failed'],
    ['判定に失敗する', BOT_REJECTED_TOKEN, 'bot_verification_failed'],
    [
      '別の操作名の判定の結果である',
      botTokenFor('profile_update'),
      'bot_verification_failed',
    ],
    [
      '判定サービスに到達できない',
      BOT_UNREACHABLE_TOKEN,
      'bot_verification_unavailable',
    ],
  ])('bot判定の%s場合は外さずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertBob();
    await insertFollows([{ follower: ALICE, followee: BOB }]);

    const response = await unfollowUser(
      'bob',
      botToken === undefined
        ? { sessionToken: token }
        : { sessionToken: token, botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect(await readFollows()).toHaveLength(1);
  });

  test('存在しないコードはfollow_target_unavailableで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await unfollowUser('nobody', {
      sessionToken: token,
      botToken: FOLLOW_BOT_TOKEN,
    });

    expect(codesOf(response)).toEqual(['follow_target_unavailable']);
  });
});

describe.each([
  {
    name: 'myFollowing',
    fetch: fetchMyFollowing,
  },
  {
    name: 'myFollowers',
    fetch: fetchMyFollowers,
  },
])('$name', ({ name, fetch }) => {
  const isFollowing = name === 'myFollowing';

  const seed = (listedIndex: number, createdAt: Date): FollowSeed =>
    isFollowing
      ? { follower: ALICE, followee: listedIndex, createdAt }
      : { follower: listedIndex, followee: ALICE, createdAt };

  const resultOf = (response: Awaited<ReturnType<typeof fetch>>) => {
    const data = response.data as Record<string, unknown> | null | undefined;
    return data?.[name] as
      | {
          nodes: readonly {
            user: { handle: string; nickname: string };
            followedAt: string;
          }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        }
      | null
      | undefined;
  };

  test('ログインしていなければunauthenticatedで拒否する', async () => {
    await insertAlice();

    const response = await fetch({ first: 20 });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('不正なカーソルを渡した未ログインの呼び出しも、カーソルの復号より先にunauthenticatedで拒否する', async () => {
    await insertAlice();

    const response = await fetch({ first: 20, after: 'not a cursor!' });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('新しい順に、相手の表示とフォローした日時を返す', async () => {
    const token = await insertAlice();
    await insertUser(BOB, { handle: 'Bob', nickname: 'ボブ' });
    await insertUser(CAROL, { handle: 'carol', nickname: 'キャロル' });
    await insertFollows([seed(BOB, after(1000)), seed(CAROL, after(2000))]);

    const response = await fetch({ first: 20 }, { sessionToken: token });

    expect(response.errors).toBeUndefined();
    expect(resultOf(response)).toEqual({
      nodes: [
        {
          user: { handle: 'carol', nickname: 'キャロル', avatar: null },
          followedAt: '2026-11-01T00:00:02.000Z',
        },
        {
          user: { handle: 'Bob', nickname: 'ボブ', avatar: null },
          followedAt: '2026-11-01T00:00:01.000Z',
        },
      ],
      pageInfo: {
        hasNextPage: false,
        endCursor: encodeCursor({
          t: after(1000).getTime(),
          id: followIdOf(1),
        }),
      },
    });
  });

  test('0件なら空の一覧とendCursorのnullを返す', async () => {
    const token = await insertAlice();

    const response = await fetch({ first: 20 }, { sessionToken: token });

    expect(resultOf(response)).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('他の利用者の行や論理削除済みの行は含めない', async () => {
    const token = await insertAlice();
    await insertUsers([BOB, CAROL, 4], {});
    await insertFollows([
      seed(BOB, after(1000)),
      { ...seed(CAROL, after(2000)), deletedAt: after(3000) },
      isFollowing
        ? { follower: BOB, followee: 4, createdAt: after(4000) }
        : { follower: 4, followee: BOB, createdAt: after(4000) },
    ]);

    const response = await fetch({ first: 20 }, { sessionToken: token });

    expect(resultOf(response)?.nodes.map((node) => node.user.handle)).toEqual([
      'user2',
    ]);
  });

  test('停止中の利用者がログインしていても一覧を表示する', async () => {
    const token = await insertAlice();
    await insertBob();
    await insertFollows([seed(BOB, after(1000))]);
    await suspendUser(ALICE);

    const response = await fetch({ first: 20 }, { sessionToken: token });

    expect(response.errors).toBeUndefined();
    expect(resultOf(response)?.nodes).toHaveLength(1);
  });

  test('停止中の相手は一覧から消え、停止の解除で戻る', async () => {
    const token = await insertAlice();
    await insertBob();
    await insertUser(CAROL, { handle: 'carol' });
    await insertFollows([seed(BOB, after(1000)), seed(CAROL, after(2000))]);
    await suspendUser(BOB);

    const suspended = await fetch({ first: 20 }, { sessionToken: token });
    await unsuspendUser(BOB);
    const restored = await fetch({ first: 20 }, { sessionToken: token });

    expect(resultOf(suspended)?.nodes.map((node) => node.user.handle)).toEqual([
      'carol',
    ]);
    expect(resultOf(restored)?.nodes.map((node) => node.user.handle)).toEqual([
      'carol',
      'Bob',
    ]);
  });

  test.each([1, 20])('firstが%iなら受け付ける', async (first) => {
    const token = await insertAlice();

    const response = await fetch({ first }, { sessionToken: token });

    expect(response.errors).toBeUndefined();
  });

  test.each([0, 21, -1, 100])(
    'firstが%iならvalidation_errorで拒否する',
    async (first) => {
      const token = await insertAlice();

      const response = await fetch({ first }, { sessionToken: token });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          field: 'first',
          message: FIRST_OUT_OF_RANGE_MESSAGE,
        }),
      ]);
    },
  );

  describe('カーソル', () => {
    const FOLLOW_COUNT = 25;

    async function seedMany(): Promise<string> {
      const token = await insertAlice();
      const indexes = Array.from(
        { length: FOLLOW_COUNT },
        (_value, index) => index + 2,
      );
      await insertUsers(indexes, {});
      await insertFollows(
        indexes.map((index) => seed(index, after(index * 1000))),
      );
      return token;
    }

    test('21件目があるとhasNextPageとendCursorが付き、endCursorをafterに渡すと続きが読める', async () => {
      const token = await seedMany();

      const firstPage = resultOf(
        await fetch({ first: 20 }, { sessionToken: token }),
      );
      const secondPage = resultOf(
        await fetch(
          { first: 20, after: firstPage?.pageInfo.endCursor },
          { sessionToken: token },
        ),
      );

      expect(firstPage?.nodes).toHaveLength(20);
      expect(firstPage?.pageInfo.hasNextPage).toBe(true);
      expect(firstPage?.nodes[0]?.user.handle).toBe('user26');
      expect(firstPage?.nodes.at(-1)?.user.handle).toBe('user7');
      expect(secondPage?.nodes.map((node) => node.user.handle)).toEqual([
        'user6',
        'user5',
        'user4',
        'user3',
        'user2',
      ]);
      expect(secondPage?.pageInfo.hasNextPage).toBe(false);
      expect(secondPage?.pageInfo.endCursor).toEqual(expect.any(String));
    });

    test('ちょうどfirst件なら続きは無い', async () => {
      const token = await insertAlice();
      await insertBob();
      await insertFollows([seed(BOB, after(1000))]);

      const page = resultOf(await fetch({ first: 1 }, { sessionToken: token }));

      expect(page?.pageInfo.hasNextPage).toBe(false);
    });

    test('位置を表すカーソルを自分で組み立てても続きが読める', async () => {
      const token = await seedMany();
      const cursor = encodeCursor({
        t: after(5000).getTime(),
        id: followIdOf(4),
      });

      const page = resultOf(
        await fetch({ first: 20, after: cursor }, { sessionToken: token }),
      );

      expect(page?.nodes.map((node) => node.user.handle)).toEqual([
        'user4',
        'user3',
        'user2',
      ]);
    });

    test('上限の256文字を超えるカーソルはafterの欄のvalidation_errorで拒否する', async () => {
      const token = await insertAlice();

      const response = await fetch(
        { first: 20, after: 'a'.repeat(257) },
        { sessionToken: token },
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          field: 'after',
          message: INVALID_CURSOR_MESSAGE,
        }),
      ]);
    });

    test('上限の256文字のカーソルは長さでは拒否せず、形式の誤りとしてinvalid_cursorで拒否する', async () => {
      const token = await insertAlice();

      const response = await fetch(
        { first: 20, after: 'a'.repeat(256) },
        { sessionToken: token },
      );

      expect(codesOf(response)).toEqual(['invalid_cursor']);
    });

    test('afterがnullなら先頭から読む', async () => {
      const token = await seedMany();

      const page = resultOf(
        await fetch({ first: 1, after: null }, { sessionToken: token }),
      );

      expect(page?.nodes[0]?.user.handle).toBe('user26');
    });

    test.each([
      ['base64urlでない', 'not a cursor!'],
      ['空の', ''],
      ['JSONでない', btoa('not-json').replaceAll('=', '')],
      ['位置の形でない', encodeCursor({ x: 1 })],
      ['時刻が負の', encodeCursor({ t: -1, id: '01JC0FLW000000000000000001' })],
      [
        '時刻が小数の',
        encodeCursor({ t: 1.5, id: '01JC0FLW000000000000000001' }),
      ],
      [
        '時刻が文字列の',
        encodeCursor({ t: '1', id: '01JC0FLW000000000000000001' }),
      ],
      ['IDがULIDでない', encodeCursor({ t: 1, id: 'abc' })],
      [
        'IDが小文字の',
        encodeCursor({ t: 1, id: '01jc0flw000000000000000001' }),
      ],
    ])('%sカーソルはinvalid_cursorで拒否する', async (_name, cursor) => {
      const token = await insertAlice();

      const response = await fetch(
        { first: 20, after: cursor },
        { sessionToken: token },
      );

      expect(codesOf(response)).toEqual(['invalid_cursor']);
      expect(response.errors?.[0]?.message).toBe(INVALID_CURSOR_MESSAGE);
    });
  });
});
