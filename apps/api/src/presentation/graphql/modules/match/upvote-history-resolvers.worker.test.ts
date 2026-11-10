import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';

import { products } from '../../../../../db/schema/product/products.ts';

import { PRODUCT_LOGO_PURPOSE } from '../../../../../common-lib/product/product-input-rules.ts';
import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import {
  DECIDED_AT,
  ENDS_AT,
  STARTS_AT,
} from '../../../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertMatches,
  insertUpvotes,
  MATCH_DATE,
  matchIdOf,
  type MatchFixture,
  type UpvoteFixture,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  categoryIdOf,
  db,
  insertCategory,
  insertLaunch,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import { D1UserProfileDirectory } from '../../../../../lib/workers/profile/d1-user-profile-directory.ts';
import {
  codesOf,
  detailsOf,
  fetchUpvoteHistory,
  installMatchGraphQLTest,
  issueMatchUserSession,
} from '../../../../../test/support/match-graphql-operations.ts';
import {
  OTHER_VOTER,
  OWNER_A,
  OWNER_B,
  secondsAfterStart,
  seedUpvoteParticipants,
  SUSPENDED,
  twoSidedMatch,
  VOTER,
  WITHDRAWN,
} from '../../../../infrastructure/match/testing/upvote-store-fixtures.ts';

installMatchGraphQLTest();

const VOTER_HANDLE = 'user3';

const PREVIOUS_DATE = '2026-11-19';

const PAGE_SIZE_MESSAGE = '表示する件数は1〜20件の整数で指定してください。';

const INVALID_CURSOR_MESSAGE = 'ページの位置の指定が正しくありません。';

// 続きの位置は実施日とマッチIDだけを表し、Upvoteの日時もIDも含まない
const cursorOf = (date: string, matchId: string): string =>
  new TextEncoder()
    .encode(`${date}:${matchId}`)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

const CUSTOM_CATEGORY = {
  id: categoryIdOf(1),
  name: 'カテゴリ1',
  handle: 'category1',
  systemDefault: false,
};

const OTHER_CATEGORY = {
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
  handle: PRODUCT_CATEGORY_OTHER_HANDLE,
  systemDefault: true,
};

// 前日に確定したWeekの準決勝。投稿者Aのプロダクト1の側と、投稿者Bのプロダクト3の側
function settledWeekMatch(index: number): MatchFixture {
  const dayBefore = (date: Date) => new Date(date.getTime() - 86_400_000);
  return twoSidedMatch(index, {
    kind: 'week',
    round: 2,
    stage: 'semifinal',
    matchDate: PREVIOUS_DATE,
    startsAt: dayBefore(STARTS_AT),
    endsAt: dayBefore(ENDS_AT),
    startedAt: dayBefore(STARTS_AT),
    decidedAt: dayBefore(DECIDED_AT),
    decision: 'votes',
  });
}

// 利用者userのマッチmatchの側slot(1は投稿者A、2は投稿者B)へのUpvote
function upvoteOf(
  index: number,
  match: number,
  slot: 1 | 2,
  user: number,
  date: string = MATCH_DATE,
): UpvoteFixture {
  return {
    index,
    match,
    entry: match * 10 + slot,
    user,
    upvotedAt: secondsAfterStart(index),
    columns: { matchDate: date },
  };
}

// プロダクト1は独自のカテゴリ・配信できるロゴ・予選の勝利で掲載済み、プロダクト3は未掲載
async function seedHistory(): Promise<void> {
  await seedUpvoteParticipants();
  await insertCategory(1);
  await insertFile(1, {
    purpose: PRODUCT_LOGO_PURPOSE,
    ownerId: userIdOf(OWNER_A),
  });
  await insertLaunch(2, 1, { launchDate: '2026-11-01', outcome: 'won' });
  await db
    .update(products)
    .set({ categoryId: categoryIdOf(1), logoFileId: fileIdOf(1) })
    .where(eq(products.id, productIdOf(1)));
  await insertMatches([
    twoSidedMatch(1, { startedAt: STARTS_AT }),
    twoSidedMatch(2, { startedAt: STARTS_AT }),
    settledWeekMatch(3),
  ]);
}

const LIVE_ITEM = {
  id: matchIdOf(1),
  matchId: matchIdOf(1),
  kind: 'QUALIFIER',
  round: null,
  stage: null,
  date: MATCH_DATE,
  live: true,
  product: {
    handle: 'product1',
    name: 'プロダクト1',
    tagline: 'タグライン1',
    category: CUSTOM_CATEGORY,
    websiteUrl: 'https://product1.example/',
    logo: { id: fileIdOf(1), objectKey: objectKeyOf(1) },
    listed: true,
  },
  owner: { handle: 'user1', nickname: '利用者1', avatar: null },
};

const SETTLED_ITEM = {
  id: matchIdOf(3),
  matchId: matchIdOf(3),
  kind: 'WEEK',
  round: 2,
  stage: 'SEMIFINAL',
  date: PREVIOUS_DATE,
  live: false,
  product: {
    handle: 'product3',
    name: 'プロダクト3',
    tagline: 'タグライン3',
    category: OTHER_CATEGORY,
    websiteUrl: 'https://product3.example/',
    logo: null,
    listed: false,
  },
  owner: { handle: 'user2', nickname: '利用者2', avatar: null },
};

describe('upvoteHistory: 項目', () => {
  test('有効なUpvoteを実施日の新しい順に、マッチIDを項目のIDにして種別・段階・実施日・マッチ中の印・プロダクト・投稿者とともに返す', async () => {
    await seedHistory();
    await insertUpvotes([
      upvoteOf(1, 1, 1, VOTER),
      upvoteOf(2, 3, 2, VOTER, PREVIOUS_DATE),
      upvoteOf(3, 2, 2, OTHER_VOTER),
      { ...upvoteOf(4, 2, 1, VOTER), columns: { deletedAt: T0 } },
    ]);

    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 20,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.upvoteHistory).toEqual({
      totalCount: 2,
      dateTotals: [
        { date: MATCH_DATE, count: 1 },
        { date: PREVIOUS_DATE, count: 1 },
      ],
      nodes: [LIVE_ITEM, SETTLED_ITEM],
      pageInfo: {
        hasNextPage: false,
        endCursor: cursorOf(PREVIOUS_DATE, matchIdOf(3)),
      },
    });
  });

  test('投稿者を表示できなければownerだけをnullにする', async () => {
    await seedHistory();
    await insertUpvotes([upvoteOf(1, 1, 1, VOTER)]);
    const original = D1UserProfileDirectory.prototype.findSummaries.bind(
      new D1UserProfileDirectory(db),
    );
    vi.spyOn(
      D1UserProfileDirectory.prototype,
      'findSummaries',
    ).mockImplementation((ids, scope) =>
      scope === 'visible' ? Promise.resolve(new Map()) : original(ids, scope),
    );

    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 20,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.upvoteHistory?.nodes).toEqual([
      { ...LIVE_ITEM, owner: null },
    ]);
  });

  test('日付ごとの件数はページ内の項目の実施日について、読み込んでいない項目を含むその日の総数を返す', async () => {
    await seedHistory();
    await insertUpvotes([
      upvoteOf(1, 1, 1, VOTER),
      upvoteOf(2, 2, 1, VOTER),
      upvoteOf(3, 3, 2, VOTER, PREVIOUS_DATE),
    ]);

    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 1,
    });

    expect(response.data?.upvoteHistory?.totalCount).toBe(3);
    expect(response.data?.upvoteHistory?.dateTotals).toEqual([
      { date: MATCH_DATE, count: 2 },
    ]);
  });
});

describe('upvoteHistory: 利用者', () => {
  test('存在しない利用者・退会済みの利用者・形式に合わないハンドルにはnullを返す', async () => {
    await seedHistory();

    const handles = ['nobody', `user${String(WITHDRAWN)}`, 'Not a handle!'];
    const responses = await Promise.all(
      handles.map((userHandle) =>
        fetchUpvoteHistory({ userHandle, first: 20 }),
      ),
    );

    for (const response of responses) {
      expect(response.errors).toBeUndefined();
      expect(response.data?.upvoteHistory).toBeNull();
    }
  });

  test('停止中の利用者は本人にだけ返し、他人とログインしていない閲覧者にはnullを返す', async () => {
    await seedHistory();
    await insertUpvotes([upvoteOf(1, 1, 1, SUSPENDED)]);
    const variables = { userHandle: `user${String(SUSPENDED)}`, first: 20 };

    const own = await fetchUpvoteHistory(variables, {
      sessionToken: await issueMatchUserSession(SUSPENDED),
    });
    const other = await fetchUpvoteHistory(variables, {
      sessionToken: await issueMatchUserSession(VOTER),
    });
    const anonymous = await fetchUpvoteHistory(variables);

    expect(own.errors).toBeUndefined();
    expect(own.data?.upvoteHistory?.nodes.map((node) => node.id)).toEqual([
      matchIdOf(1),
    ]);
    expect(other.data?.upvoteHistory).toBeNull();
    expect(anonymous.data?.upvoteHistory).toBeNull();
  });

  test('利用者側でない呼び出し元をforbiddenで拒否する', async () => {
    const response = await fetchUpvoteHistory(
      { userHandle: VOTER_HANDLE, first: 20 },
      { caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data?.upvoteHistory).toBeNull();
  });
});

describe('upvoteHistory: ページと引数', () => {
  test('件数ずつ返し、続きの位置から次のページを返す', async () => {
    await seedHistory();
    await insertUpvotes([
      upvoteOf(1, 1, 1, VOTER),
      upvoteOf(2, 2, 2, VOTER),
      upvoteOf(3, 3, 2, VOTER, PREVIOUS_DATE),
    ]);

    const firstPage = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 2,
    });
    const secondPage = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 2,
      after: firstPage.data?.upvoteHistory?.pageInfo.endCursor ?? null,
    });

    expect(firstPage.data?.upvoteHistory?.nodes.map((node) => node.id)).toEqual(
      [matchIdOf(2), matchIdOf(1)],
    );
    expect(firstPage.data?.upvoteHistory?.pageInfo.hasNextPage).toBe(true);
    expect(
      secondPage.data?.upvoteHistory?.nodes.map((node) => node.id),
    ).toEqual([matchIdOf(3)]);
    expect(secondPage.data?.upvoteHistory?.pageInfo.hasNextPage).toBe(false);
    expect(secondPage.data?.upvoteHistory?.dateTotals).toEqual([
      { date: PREVIOUS_DATE, count: 1 },
    ]);
  });

  test('Upvoteが無ければ空のページを返す', async () => {
    await seedHistory();

    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 20,
    });

    expect(response.data?.upvoteHistory).toEqual({
      totalCount: 0,
      dateTotals: [],
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('明示したnullの位置は未指定と同じく最初のページを返す', async () => {
    await seedHistory();
    await insertUpvotes([upvoteOf(1, 1, 1, VOTER)]);

    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 1,
      after: null,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.upvoteHistory?.nodes).toHaveLength(1);
  });

  test.each([0, 21])('件数%iをvalidation_errorで拒否する', async (first) => {
    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first,
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'first', message: PAGE_SIZE_MESSAGE }),
    ]);
  });

  test('壊れた位置をinvalid_cursorで拒否する', async () => {
    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 20,
      after: 'broken',
    });

    expect(codesOf(response)).toEqual(['invalid_cursor']);
    expect(response.errors?.[0]?.message).toBe(INVALID_CURSOR_MESSAGE);
  });

  test('257文字以上の位置をvalidation_errorで拒否する', async () => {
    const response = await fetchUpvoteHistory({
      userHandle: VOTER_HANDLE,
      first: 20,
      after: 'a'.repeat(257),
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'after' }),
    ]);
  });

  test('件数の検証は位置より先に、位置の検証はハンドルの形式より先に行う', async () => {
    const outOfRange = await fetchUpvoteHistory({
      userHandle: 'Not a handle!',
      first: 0,
      after: 'broken',
    });
    const brokenCursor = await fetchUpvoteHistory({
      userHandle: 'Not a handle!',
      first: 20,
      after: 'broken',
    });

    expect(codesOf(outOfRange)).toEqual(['validation_error']);
    expect(codesOf(brokenCursor)).toEqual(['invalid_cursor']);
  });
});

describe('upvoteHistory: 本人以外の閲覧者', () => {
  test('閲覧者に関わらず、表示される利用者のUpvoteを返す', async () => {
    await seedHistory();
    await insertUpvotes([upvoteOf(1, 1, 1, VOTER)]);

    const response = await fetchUpvoteHistory(
      { userHandle: VOTER_HANDLE, first: 20 },
      { sessionToken: await issueMatchUserSession(OWNER_B) },
    );

    expect(response.data?.upvoteHistory?.nodes).toEqual([LIVE_ITEM]);
  });
});
