import { beforeEach, describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import {
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  categoryIdOf,
  insertCategory,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  answerLaunchSummaries,
  codesOf,
  detailsOf,
  fetchLaunchHistory,
  fetchProfileAwards,
  insertOwnedProduct,
  installProductGraphQLTest,
  issueProductUserSession,
  kickoffOf,
  suspendProductUser,
} from '../../../../../test/support/product-graphql-operations.ts';

installProductGraphQLTest();

const OWNER = 1;

const VIEWER = 2;

const OWNER_HANDLE = 'user1';

const PAGE_SIZE_MESSAGE = '表示する件数は1〜20件の整数で指定してください。';

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

// 1: 掲載済み(独自のカテゴリ・配信できるロゴ) / 2: 未掲載の予定 / 3: 非公開化中の掲載済み
async function insertOwnerProducts(): Promise<void> {
  await insertCategory(1);
  await insertFile(1, { ownerId: userIdOf(OWNER) });
  await insertOwnedProduct(
    1,
    OWNER,
    { launchDate: '2026-11-01', outcome: 'won' },
    { categoryId: categoryIdOf(1), logoFileId: fileIdOf(1) },
  );
  await insertOwnedProduct(2, OWNER, { launchDate: '2026-11-20' });
  await insertOwnedProduct(
    3,
    OWNER,
    { launchDate: '2026-11-03', outcome: 'won' },
    { hiddenAt: new Date('2026-11-04T00:00:00.000Z') },
  );
}

const LISTED_ITEM = {
  product: {
    handle: 'product1',
    name: 'プロダクト1',
    tagline: 'タグライン1',
    category: CUSTOM_CATEGORY,
    websiteUrl: 'https://product1.example/',
    logo: { id: fileIdOf(1), objectKey: objectKeyOf(1) },
    listed: true,
  },
  launches: [
    {
      id: launchIdOf(1),
      number: 1,
      launchDate: '2026-11-01',
      kickoffAt: kickoffOf('2026-11-01'),
      status: 'FINISHED',
      outcome: 'WON',
      summary: { label: 'ディレクトリ掲載', inMatch: false },
    },
  ],
  awards: [],
};

const UNLISTED_ITEM = {
  product: {
    handle: 'product2',
    name: 'プロダクト2',
    tagline: 'タグライン2',
    category: OTHER_CATEGORY,
    websiteUrl: 'https://product2.example/',
    logo: null,
    listed: false,
  },
  launches: [
    {
      id: launchIdOf(2),
      number: 1,
      launchDate: '2026-11-20',
      kickoffAt: kickoffOf('2026-11-20'),
      status: 'SCHEDULED',
      outcome: null,
      summary: { label: 'キックオフ予定', inMatch: false },
    },
  ],
  awards: [],
};

beforeEach(async () => {
  await insertUser(OWNER);
  await insertUser(VIEWER);
});

describe('launchHistory: 対象', () => {
  test('他人とログインしていない閲覧者には、非公開化中を除く掲載済みのプロダクトだけを返す', async () => {
    await insertOwnerProducts();
    const token = await issueProductUserSession(VIEWER);

    const signedIn = await fetchLaunchHistory(
      { userHandle: OWNER_HANDLE, first: 20 },
      { sessionToken: token },
    );
    const anonymous = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 20,
    });

    const expected = {
      viewerIsOwner: false,
      ownerSuspended: false,
      totalCount: 1,
      nodes: [LISTED_ITEM],
      pageInfo: { hasNextPage: false, endCursor: expect.any(String) as string },
    };
    expect(signedIn.errors).toBeUndefined();
    expect(signedIn.data?.launchHistory).toEqual(expected);
    expect(anonymous.errors).toBeUndefined();
    expect(anonymous.data?.launchHistory).toEqual(expected);
  });

  test('本人には非公開化中を除く未掲載を含む自分のプロダクトを最新のローンチ日の新しい順に返す', async () => {
    await insertOwnerProducts();
    const token = await issueProductUserSession(OWNER);

    const response = await fetchLaunchHistory(
      { userHandle: OWNER_HANDLE, first: 20 },
      { sessionToken: token },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.launchHistory).toEqual({
      viewerIsOwner: true,
      ownerSuspended: false,
      totalCount: 2,
      nodes: [UNLISTED_ITEM, LISTED_ITEM],
      pageInfo: { hasNextPage: false, endCursor: expect.any(String) as string },
    });
  });

  test('停止中の本人には停止中であることを添えて返し、他人にはnullを返す', async () => {
    await insertOwnerProducts();
    const ownerToken = await issueProductUserSession(OWNER);
    const viewerToken = await issueProductUserSession(VIEWER);
    await suspendProductUser(OWNER);

    const owner = await fetchLaunchHistory(
      { userHandle: OWNER_HANDLE, first: 20 },
      { sessionToken: ownerToken },
    );
    const other = await fetchLaunchHistory(
      { userHandle: OWNER_HANDLE, first: 20 },
      { sessionToken: viewerToken },
    );

    expect(owner.errors).toBeUndefined();
    expect(owner.data?.launchHistory).toEqual(
      expect.objectContaining({
        viewerIsOwner: true,
        ownerSuspended: true,
        totalCount: 2,
      }),
    );
    expect(other.errors).toBeUndefined();
    expect(other.data?.launchHistory).toBeNull();
  });

  test('存在しない利用者と形式に合わないハンドルにはnullを返す', async () => {
    const missing = await fetchLaunchHistory({
      userHandle: 'nobody',
      first: 20,
    });
    const malformed = await fetchLaunchHistory({
      userHandle: 'not a handle',
      first: 20,
    });

    expect(missing.errors).toBeUndefined();
    expect(missing.data?.launchHistory).toBeNull();
    expect(malformed.errors).toBeUndefined();
    expect(malformed.data?.launchHistory).toBeNull();
  });

  test('利用者側でない呼び出し元をforbiddenで拒否する', async () => {
    const response = await fetchLaunchHistory(
      { userHandle: OWNER_HANDLE, first: 20 },
      { caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data?.launchHistory).toBeNull();
  });
});

describe('launchHistory: 結果の要約と受賞', () => {
  test('供給元の要約と受賞をローンチとプロダクトに添え、受賞をYearを先頭に種類ごとにまとめる', async () => {
    await insertOwnerProducts();
    answerLaunchSummaries({
      launches: [
        {
          launchId: launchIdOf(1),
          label: 'Week 45 優勝',
          inMatch: false,
          rank: 1,
        },
      ],
      awards: [
        { productId: productIdOf(1), kind: 'week', label: '2026年 第45週' },
        { productId: productIdOf(1), kind: 'year', label: '2026年' },
      ],
    });

    const response = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 20,
    });

    const [item] = response.data?.launchHistory?.nodes ?? [];
    expect(response.errors).toBeUndefined();
    expect(item?.launches.map(({ summary }) => summary)).toEqual([
      { label: 'Week 45 優勝', inMatch: false },
    ]);
    expect(item?.awards).toEqual([
      { kind: 'YEAR', count: 1, labels: ['2026年'] },
      { kind: 'WEEK', count: 1, labels: ['2026年 第45週'] },
    ]);
  });

  test('供給元が失敗したら予選の結果から要約を作り、受賞を空にする', async () => {
    await insertOwnerProducts();
    answerLaunchSummaries(new Error('要約の供給元に接続できません'));

    const response = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 20,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.launchHistory?.nodes).toEqual([LISTED_ITEM]);
  });
});

describe('launchHistory: ページと引数', () => {
  test('件数ずつ返し、続きの位置から次のページを返す', async () => {
    await insertOwnedProduct(1, OWNER, {
      launchDate: '2026-11-01',
      outcome: 'won',
    });
    await insertOwnedProduct(2, OWNER, {
      launchDate: '2026-11-02',
      outcome: 'won',
    });
    await insertOwnedProduct(3, OWNER, {
      launchDate: '2026-11-03',
      outcome: 'won',
    });

    const first = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 2,
    });
    const firstPage = first.data?.launchHistory;
    const second = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 2,
      after: firstPage?.pageInfo.endCursor ?? null,
    });
    const secondPage = second.data?.launchHistory;

    expect(first.errors).toBeUndefined();
    expect(firstPage?.totalCount).toBe(3);
    expect(firstPage?.nodes.map(({ product }) => product.handle)).toEqual([
      'product3',
      'product2',
    ]);
    expect(firstPage?.pageInfo.hasNextPage).toBe(true);
    expect(second.errors).toBeUndefined();
    expect(secondPage?.totalCount).toBe(3);
    expect(secondPage?.nodes.map(({ product }) => product.handle)).toEqual([
      'product1',
    ]);
    expect(secondPage?.pageInfo.hasNextPage).toBe(false);
  });

  test('明示したnullの位置は未指定と同じく最初のページを返す', async () => {
    await insertOwnedProduct(1, OWNER, {
      launchDate: '2026-11-01',
      outcome: 'won',
    });

    const response = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 1,
      after: null,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.launchHistory?.nodes).toHaveLength(1);
  });

  test.each([0, 21])('件数%iをvalidation_errorで拒否する', async (first) => {
    const response = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first,
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'first', message: PAGE_SIZE_MESSAGE }),
    ]);
  });

  test('壊れた位置をinvalid_cursorで拒否する', async () => {
    const response = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 20,
      after: 'broken',
    });

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });

  test('257文字以上の位置をvalidation_errorで拒否する', async () => {
    const response = await fetchLaunchHistory({
      userHandle: OWNER_HANDLE,
      first: 20,
      after: 'a'.repeat(257),
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'after' }),
    ]);
  });
});

describe('profileAwards', () => {
  const AWARD_ANSWER = {
    launches: [],
    awards: [
      { productId: productIdOf(1), kind: 'week', label: '2026年 第45週' },
      { productId: productIdOf(2), kind: 'week', label: '2026年 第47週' },
      { productId: productIdOf(1), kind: 'year', label: '2026年' },
      { productId: productIdOf(3), kind: 'year', label: '2025年' },
    ],
  } as const;

  test('他人とログインしていない閲覧者には、掲載済みのプロダクトの受賞を名称付きのラベルでYearを先頭に種類ごとにまとめて返す', async () => {
    await insertOwnerProducts();
    answerLaunchSummaries(AWARD_ANSWER);
    const token = await issueProductUserSession(VIEWER);

    const signedIn = await fetchProfileAwards(OWNER_HANDLE, {
      sessionToken: token,
    });
    const anonymous = await fetchProfileAwards(OWNER_HANDLE);

    const expected = [
      { kind: 'YEAR', count: 1, labels: ['プロダクト1 2026年'] },
      { kind: 'WEEK', count: 1, labels: ['プロダクト1 2026年 第45週'] },
    ];
    expect(signedIn.errors).toBeUndefined();
    expect(signedIn.data?.profileAwards).toEqual(expected);
    expect(anonymous.errors).toBeUndefined();
    expect(anonymous.data?.profileAwards).toEqual(expected);
  });

  test('本人には非公開化中を除く未掲載を含む自分のプロダクトの受賞をまとめて返す', async () => {
    await insertOwnerProducts();
    answerLaunchSummaries(AWARD_ANSWER);
    const token = await issueProductUserSession(OWNER);

    const response = await fetchProfileAwards(OWNER_HANDLE, {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.profileAwards).toEqual([
      { kind: 'YEAR', count: 1, labels: ['プロダクト1 2026年'] },
      {
        kind: 'WEEK',
        count: 2,
        labels: ['プロダクト1 2026年 第45週', 'プロダクト2 2026年 第47週'],
      },
    ]);
  });

  test('受賞が無いときと供給元が失敗したときは空の配列を返す', async () => {
    await insertOwnerProducts();

    const empty = await fetchProfileAwards(OWNER_HANDLE);
    answerLaunchSummaries(new Error('要約の供給元に接続できません'));
    const failed = await fetchProfileAwards(OWNER_HANDLE);

    expect(empty.errors).toBeUndefined();
    expect(empty.data?.profileAwards).toEqual([]);
    expect(failed.errors).toBeUndefined();
    expect(failed.data?.profileAwards).toEqual([]);
  });

  test('停止中の利用者は本人にだけ返し、他人と存在しない利用者にはnullを返す', async () => {
    await insertOwnerProducts();
    answerLaunchSummaries(AWARD_ANSWER);
    const ownerToken = await issueProductUserSession(OWNER);
    const viewerToken = await issueProductUserSession(VIEWER);
    await suspendProductUser(OWNER);

    const owner = await fetchProfileAwards(OWNER_HANDLE, {
      sessionToken: ownerToken,
    });
    const other = await fetchProfileAwards(OWNER_HANDLE, {
      sessionToken: viewerToken,
    });
    const missing = await fetchProfileAwards('nobody');

    expect(owner.errors).toBeUndefined();
    expect(owner.data?.profileAwards).toHaveLength(2);
    expect(other.errors).toBeUndefined();
    expect(other.data?.profileAwards).toBeNull();
    expect(missing.errors).toBeUndefined();
    expect(missing.data?.profileAwards).toBeNull();
  });

  test.each([
    ['空', '', 'ハンドルを入力してください。'],
    ['26文字', 'a'.repeat(26), 'ハンドルは25文字以内で入力してください。'],
    [
      '使えない文字を含む',
      'not a handle',
      'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
    ],
  ])(
    '%sのハンドルをvalidation_errorで拒否する',
    async (_label, userHandle, message) => {
      const response = await fetchProfileAwards(userHandle);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field: 'userHandle', message }),
      ]);
    },
  );

  test('利用者側でない呼び出し元をforbiddenで拒否する', async () => {
    const response = await fetchProfileAwards(OWNER_HANDLE, {
      caller: 'admin',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data?.profileAwards).toBeNull();
  });
});
