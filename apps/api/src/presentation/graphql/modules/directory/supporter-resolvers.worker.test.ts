import { beforeEach, describe, expect, test } from 'vitest';

import {
  insertQualifiers,
  qualifierLaunchOf,
} from '../../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  entryIdOf,
  insertUpvotes,
  matchIdOf,
  type UpvoteFixture,
  upvoteIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  insertProduct,
  insertUser,
  insertUsers,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  fetchMatchSupporters,
  installDirectoryGraphQLTest,
} from '../../../../../test/support/directory-graphql-operations.ts';
import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/product-graphql-operations.ts';
import { MATCH_ERRORS } from '../../../../application/match/match-errors.ts';
import { encodeCursor } from '../../pagination.ts';

installDirectoryGraphQLTest();

const OWNER = 1;
const RIVAL = 2;
const SUSPENDED = 50;
const WITHDRAWN = 51;
const OPPONENT_SUPPORTER = 52;
const CANCELED_SUPPORTER = 53;

const SUPPORTERS = Array.from({ length: 21 }, (_, offset) => 10 + offset);

const LISTED = 1;
const UNLISTED = 2;

const DECIDED_MATCH = 1;
const LIVE_MATCH = 2;

const MATCH_DATE = '2026-11-05';
const UPVOTE_BASE = Date.parse('2026-11-05T03:00:00.000Z');

const OWN_ENTRY = entryIdOf(qualifierLaunchOf(DECIDED_MATCH));
const OPPONENT_ENTRY = entryIdOf(qualifierLaunchOf(DECIDED_MATCH, 1));

const UPVOTE_ID = upvoteIdOf(1);

const FIRST_OUT_OF_RANGE_MESSAGE =
  '表示する件数は1〜20件の整数で指定してください。';

// 利用者の番号の順とUpvoteの日時の順が一致しないよう、7分刻みを21で割った余りの分だけずらす
const minuteOffsetOf = (position: number): number => (position * 7) % 21;

const upvoteOf = (
  index: number,
  user: number,
  minute: number,
  entry: number = qualifierLaunchOf(DECIDED_MATCH),
  columns: UpvoteFixture['columns'] = {},
): UpvoteFixture => ({
  index,
  match: DECIDED_MATCH,
  entry,
  user,
  upvotedAt: new Date(UPVOTE_BASE + minute * 60_000),
  columns: { matchDate: MATCH_DATE, ...columns },
});

// 掲載中のプロダクト1は11/05の予選でプロダクト2に勝った。プロダクト1の側に可視の21人と、停止中・退会済み・取り消しの利用者が先にUpvoteしている
async function seedSupporters(): Promise<void> {
  await insertUser(OWNER);
  await insertUser(RIVAL);
  await insertUsers(SUPPORTERS);
  await insertUser(SUSPENDED, { status: 'suspended', suspendedAt: T0 });
  await insertUser(WITHDRAWN, { deletedAt: T0 });
  await insertUser(OPPONENT_SUPPORTER);
  await insertUser(CANCELED_SUPPORTER);
  await insertProduct(LISTED, OWNER);
  await insertProduct(UNLISTED, RIVAL);
  await insertQualifiers([
    {
      match: DECIDED_MATCH,
      date: MATCH_DATE,
      sides: [
        { product: LISTED, owner: OWNER, result: 'won', upvotes: 21 },
        { product: UNLISTED, owner: RIVAL, result: 'lost', upvotes: 1 },
      ],
    },
    {
      match: LIVE_MATCH,
      date: '2026-11-10',
      sides: [
        { product: LISTED, owner: OWNER, result: null },
        { product: UNLISTED, owner: RIVAL, result: null },
      ],
    },
  ]);
  await insertUpvotes([
    ...SUPPORTERS.map((user, position) =>
      upvoteOf(position + 1, user, 30 + minuteOffsetOf(position)),
    ),
    upvoteOf(31, SUSPENDED, 1),
    upvoteOf(32, WITHDRAWN, 2),
    upvoteOf(33, CANCELED_SUPPORTER, 3, undefined, { deletedAt: T0 }),
    upvoteOf(34, OPPONENT_SUPPORTER, 4, qualifierLaunchOf(DECIDED_MATCH, 1)),
  ]);
}

const expectedHandles = SUPPORTERS.map((user, position) => ({
  handle: `user${String(user)}`,
  minute: minuteOffsetOf(position),
}))
  .toSorted((first, second) => first.minute - second.minute)
  .map(({ handle }) => handle);

const supportersOf = (
  variables: Partial<Parameters<typeof fetchMatchSupporters>[0]> = {},
) =>
  fetchMatchSupporters({
    productHandle: 'product1',
    matchId: matchIdOf(DECIDED_MATCH),
    entryId: OWN_ENTRY,
    first: 20,
    ...variables,
  });

describe('matchSupporters: 一覧', () => {
  beforeEach(seedSupporters);

  test('退会・停止・取り消しと相手の側を除き、Upvoteの日時の早い順に20件ずつ返し、21件目で続きのカーソルを返す', async () => {
    const first = await supportersOf();

    expect(first.errors).toBeUndefined();
    expect(
      first.data?.matchSupporters?.nodes.map(({ handle }) => handle),
    ).toEqual(expectedHandles.slice(0, 20));
    expect(first.data?.matchSupporters?.nodes[0]).toEqual({
      handle: expectedHandles[0],
      nickname: expectedHandles[0]?.replace('user', '利用者'),
      avatar: null,
    });
    expect(first.data?.matchSupporters?.pageInfo.hasNextPage).toBe(true);
    const endCursor = first.data?.matchSupporters?.pageInfo.endCursor;
    expect(endCursor).toEqual(expect.any(String));

    const second = await supportersOf({ after: endCursor });

    expect(second.errors).toBeUndefined();
    expect(second.data?.matchSupporters?.nodes).toEqual([
      {
        handle: expectedHandles[20],
        nickname: expectedHandles[20]?.replace('user', '利用者'),
        avatar: null,
      },
    ]);
    expect(second.data?.matchSupporters?.pageInfo.hasNextPage).toBe(false);
    const secondCursor = second.data?.matchSupporters?.pageInfo.endCursor;
    expect(secondCursor).toEqual(expect.any(String));
    expect(secondCursor).not.toBe(endCursor);
  });

  test('ちょうど件数分で終わるページは続きが無い', async () => {
    const response = await supportersOf({ first: 1 });
    const next = await supportersOf({
      first: 20,
      after: response.data?.matchSupporters?.pageInfo.endCursor,
    });

    expect(next.errors).toBeUndefined();
    expect(next.data?.matchSupporters?.nodes).toHaveLength(20);
    expect(next.data?.matchSupporters?.pageInfo.hasNextPage).toBe(false);
  });

  test.each([
    [
      '表示できないプロダクト',
      { productHandle: 'product2', entryId: OPPONENT_ENTRY },
    ],
    ['他のプロダクトの側', { entryId: OPPONENT_ENTRY }],
    [
      '結果が確定していないマッチ',
      {
        matchId: matchIdOf(LIVE_MATCH),
        entryId: entryIdOf(qualifierLaunchOf(LIVE_MATCH)),
      },
    ],
  ])('%sはnullを返す', async (_name, variables) => {
    const response = await supportersOf(variables);

    expect(response.errors).toBeUndefined();
    expect(response.data?.matchSupporters).toBeNull();
  });
});

describe('matchSupporters: 引数の検証', () => {
  beforeEach(seedSupporters);

  test.each([0, 21])('firstが%iならvalidation_errorにする', async (first) => {
    const response = await supportersOf({ first });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'first',
        message: FIRST_OUT_OF_RANGE_MESSAGE,
      }),
    ]);
    expect(response.data?.matchSupporters).toBeNull();
  });

  test.each(['matchId', 'entryId'])(
    '形式の違う%sはマッチが見つからない文言のvalidation_errorにする',
    async (field) => {
      const response = await supportersOf({ [field]: 'not-a-ulid' });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          field,
          message: MATCH_ERRORS.match_not_found.message,
        }),
      ]);
    },
  );

  test.each([
    ['base64urlでない', 'not a cursor!'],
    ['空の', ''],
    ['位置の形でない', encodeCursor({ x: 1 })],
    ['時刻が文字列の', encodeCursor({ upvotedAt: '1', upvoteId: UPVOTE_ID })],
    ['時刻が負の', encodeCursor({ upvotedAt: -1, upvoteId: UPVOTE_ID })],
    ['IDがULIDでない', encodeCursor({ upvotedAt: 1, upvoteId: 'abc' })],
  ])('%sカーソルはinvalid_cursorにする', async (_name, after) => {
    const response = await supportersOf({ after });

    expect(codesOf(response)).toEqual(['invalid_cursor']);
    expect(response.data?.matchSupporters).toBeNull();
  });

  test('上限の256文字を超えるカーソルはafterの欄のvalidation_errorにする', async () => {
    const response = await supportersOf({ after: 'a'.repeat(257) });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'after' }),
    ]);
  });

  test('利用者側でない呼び出し元をforbiddenで拒否する', async () => {
    const response = await fetchMatchSupporters(
      {
        productHandle: 'product1',
        matchId: matchIdOf(DECIDED_MATCH),
        entryId: OWN_ENTRY,
        first: 20,
      },
      { caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data).toEqual({ matchSupporters: null });
  });
});
