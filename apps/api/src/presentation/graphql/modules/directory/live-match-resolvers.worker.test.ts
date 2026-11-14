import { beforeEach, describe, expect, test } from 'vitest';

import {
  insertQualifiers,
  qualifierLaunchOf,
} from '../../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  entryIdOf,
  insertUpvotes,
  matchIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  DIRECTORY_TEST_NOW,
  fetchProductLiveMatch,
  installDirectoryGraphQLTest,
  issueDirectoryUserSession,
} from '../../../../../test/support/directory-graphql-operations.ts';
import { codesOf } from '../../../../../test/support/product-graphql-operations.ts';

installDirectoryGraphQLTest();

const OWNER = 1;
const RIVAL = 2;
const VIEWER = 3;

const LIVE_PRODUCT = 1;
const LIVE_OPPONENT = 2;
const TALLYING_PRODUCT = 3;
const AWAITING_PAIRING_PRODUCT = 4;
const UNLISTED_PRODUCT = 5;
const IDLE_PRODUCT = 6;

const LIVE_MATCH = 1;
const TALLYING_MATCH = 2;

const TODAY = '2026-11-10';

const BEFORE_NOW = new Date(DIRECTORY_TEST_NOW.getTime() - 3_600_000);

const pastBye = (match: number, product: number, owner: number, date: string) =>
  ({
    match,
    date,
    decision: 'bye',
    sides: [{ product, owner, result: 'bye' }],
  }) as const;

// 掲載中のプロダクト1はマッチ中、3は前日の予選が集計中、4は当日のローンチの予選マッチが未作成、6は開催中のマッチが無い。5は未掲載
async function seedLiveMatches(): Promise<void> {
  await insertUser(OWNER);
  await insertUser(RIVAL);
  await insertUser(VIEWER, { emailVerifiedAt: T0 });
  await insertProduct(LIVE_PRODUCT, OWNER, { name: 'Rocketship' });
  await insertProduct(LIVE_OPPONENT, RIVAL, { name: 'Rival' });
  await insertProduct(TALLYING_PRODUCT, RIVAL);
  await insertProduct(AWAITING_PAIRING_PRODUCT, OWNER);
  await insertProduct(UNLISTED_PRODUCT, RIVAL);
  await insertProduct(IDLE_PRODUCT, OWNER);
  await insertQualifiers([
    pastBye(9, LIVE_PRODUCT, OWNER, '2026-11-05'),
    pastBye(8, TALLYING_PRODUCT, RIVAL, '2026-11-04'),
    pastBye(7, AWAITING_PAIRING_PRODUCT, OWNER, '2026-11-03'),
    pastBye(6, IDLE_PRODUCT, OWNER, '2026-11-02'),
    {
      match: LIVE_MATCH,
      date: TODAY,
      sides: [
        { product: LIVE_PRODUCT, owner: OWNER, result: null, upvotes: 1 },
        { product: LIVE_OPPONENT, owner: RIVAL, result: null },
      ],
    },
    {
      match: TALLYING_MATCH,
      date: '2026-11-09',
      sides: [
        { product: TALLYING_PRODUCT, owner: RIVAL, result: null },
        { product: UNLISTED_PRODUCT, owner: RIVAL, result: null },
      ],
    },
  ]);
  await insertLaunch(70, AWAITING_PAIRING_PRODUCT, { launchDate: TODAY });
  await insertUpvotes([
    {
      index: 1,
      match: LIVE_MATCH,
      entry: qualifierLaunchOf(LIVE_MATCH),
      user: VIEWER,
      upvotedAt: BEFORE_NOW,
      columns: { matchDate: TODAY },
    },
  ]);
}

describe('productLiveMatch', () => {
  beforeEach(seedLiveMatches);

  test('マッチ中のマッチを閲覧者のUpvoteを含むMatchで、照会の時点の時刻とともに返す', async () => {
    const token = await issueDirectoryUserSession(VIEWER);

    const response = await fetchProductLiveMatch('product1', {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.productLiveMatch).toMatchObject({
      serverTime: DIRECTORY_TEST_NOW.toISOString(),
      awaitingChange: false,
      match: {
        id: matchIdOf(LIVE_MATCH),
        kind: 'QUALIFIER',
        date: TODAY,
        phase: 'LIVE',
        decision: null,
        viewerUpvotedEntryId: entryIdOf(qualifierLaunchOf(LIVE_MATCH)),
        entries: [
          {
            id: entryIdOf(qualifierLaunchOf(LIVE_MATCH)),
            product: { handle: 'product1', name: 'Rocketship' },
            upvoteCount: 1,
            result: null,
          },
          {
            id: entryIdOf(qualifierLaunchOf(LIVE_MATCH, 1)),
            product: { handle: 'product2', name: 'Rival' },
            result: null,
          },
        ],
      },
    });
  });

  test('未ログインの閲覧者にはUpvoteの無いMatchを返す', async () => {
    const response = await fetchProductLiveMatch('product1');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productLiveMatch?.match).toMatchObject({
      id: matchIdOf(LIVE_MATCH),
      viewerUpvotedEntryId: null,
      viewerRestriction: 'GUEST',
    });
  });

  test('集計中のマッチを返し、変化を待つ状態にする', async () => {
    const response = await fetchProductLiveMatch('product3');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productLiveMatch).toMatchObject({
      awaitingChange: true,
      match: { id: matchIdOf(TALLYING_MATCH), phase: 'TALLYING' },
    });
  });

  test('当日のローンチの予選マッチが未作成なら、マッチ無しで変化を待つ状態にする', async () => {
    const response = await fetchProductLiveMatch('product4');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productLiveMatch).toEqual({
      serverTime: DIRECTORY_TEST_NOW.toISOString(),
      match: null,
      awaitingChange: true,
    });
  });

  test('開催中のマッチが無ければ、マッチ無しで変化を待たない', async () => {
    const response = await fetchProductLiveMatch('product6');

    expect(response.errors).toBeUndefined();
    expect(response.data?.productLiveMatch).toEqual({
      serverTime: DIRECTORY_TEST_NOW.toISOString(),
      match: null,
      awaitingChange: false,
    });
  });

  test.each([
    ['未掲載の他者のプロダクト', 'product5'],
    ['存在しないハンドル', 'missing-product'],
    ['形式に合わないハンドル', '-invalid-'],
    ['旧ハンドル', 'old-rocketship'],
  ])('%sはnullを返す', async (_name, handle) => {
    await insertProductPreviousHandle(1, LIVE_PRODUCT, 'old-rocketship');

    const response = await fetchProductLiveMatch(handle);

    expect(response.errors).toBeUndefined();
    expect(response.data?.productLiveMatch).toBeNull();
  });

  test('利用者側でない呼び出し元をforbiddenで拒否する', async () => {
    const response = await fetchProductLiveMatch('product1', {
      caller: 'admin',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data).toEqual({ productLiveMatch: null });
  });
});
