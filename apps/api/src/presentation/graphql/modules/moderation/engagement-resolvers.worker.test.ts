import { describe, expect, test } from 'vitest';

import {
  after,
  commentIdOf,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRatings,
  insertUser,
  launchIdOf,
  productIdOf,
  ratingIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { readModerationRows } from '../../../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import {
  type AdminCommentFields,
  type AdminRatingFields,
  asModerator,
  asViewer,
  codesOf,
  detailsOf,
  fetchAdminComments,
  fetchAdminRatings,
  installModerationContentGraphQLTest,
  MODERATION_TEST_NOW,
  moderateTarget,
  type TargetModeration,
} from '../../../../../test/support/moderation-content-graphql-operations.ts';

installModerationContentGraphQLTest();

const AUTHOR = 1;
const OWNER = 2;
const RATER = 3;
const PRODUCT = 1;
const MISSING = 99;

const REASON = '誹謗中傷を含むため';
const NOW = MODERATION_TEST_NOW.toISOString();

// 利用者1(投稿者)・2(プロダクトの投稿者)・3(評価者)、利用者2のプロダクト1と第1回・第2回のローンチ、
// コメント1(表示中)・2(非公開化中)・3(匿名化済み)、評価1(有効)・2(無効化中)を作る
async function seedEngagement(): Promise<void> {
  await insertUser(AUTHOR);
  await insertUser(OWNER);
  await insertUser(RATER);
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(1, PRODUCT, {
    launchDate: '2026-11-13',
    outcome: 'lost',
    decidedAt: after(1_000),
  });
  await insertLaunch(2, PRODUCT, { launchDate: '2026-11-20' });
  await insertComments([
    {
      index: 1,
      product: PRODUCT,
      launch: 1,
      author: AUTHOR,
      columns: { createdAt: after(1_000) },
    },
    {
      index: 2,
      product: PRODUCT,
      launch: 2,
      author: AUTHOR,
      columns: { createdAt: after(2_000), hiddenAt: after(5_000) },
    },
    {
      index: 3,
      product: PRODUCT,
      launch: 2,
      author: null,
      columns: {
        createdAt: after(3_000),
        body: '',
        anonymizedAt: after(4_000),
      },
    },
  ]);
  await insertRatings([
    {
      index: 1,
      product: PRODUCT,
      user: AUTHOR,
      score: 4,
      columns: { updatedAt: after(1_000) },
    },
    {
      index: 2,
      product: PRODUCT,
      user: RATER,
      score: 2,
      columns: { updatedAt: after(2_000), invalidatedAt: after(2_000) },
    },
  ]);
}

const AUTHOR_SUMMARY = Object.freeze({
  id: userIdOf(AUTHOR),
  handle: 'user1',
  nickname: '利用者1',
  suspended: false,
});

const COMMENT_BASE = Object.freeze({
  productName: 'プロダクト1',
  productId: productIdOf(PRODUCT),
  latestHide: null,
});

const COMMENTS: Readonly<Record<string, AdminCommentFields>> = Object.freeze({
  shown: {
    ...COMMENT_BASE,
    id: commentIdOf(1),
    excerpt: 'コメント1',
    author: AUTHOR_SUMMARY,
    launchId: launchIdOf(1),
    launchNumber: 1,
    createdAt: after(1_000).toISOString(),
    state: 'SHOWN',
  },
  hidden: {
    ...COMMENT_BASE,
    id: commentIdOf(2),
    excerpt: 'コメント2',
    author: AUTHOR_SUMMARY,
    launchId: launchIdOf(2),
    launchNumber: 2,
    createdAt: after(2_000).toISOString(),
    state: 'HIDDEN',
  },
  anonymized: {
    ...COMMENT_BASE,
    id: commentIdOf(3),
    excerpt: '',
    author: null,
    launchId: launchIdOf(2),
    launchNumber: 2,
    createdAt: after(3_000).toISOString(),
    state: 'ANONYMIZED',
  },
});

const RATING_BASE = Object.freeze({
  productName: 'プロダクト1',
  productId: productIdOf(PRODUCT),
  createdAt: T0.toISOString(),
  latestInvalidation: null,
});

const RATINGS: Readonly<Record<string, AdminRatingFields>> = Object.freeze({
  valid: {
    ...RATING_BASE,
    id: ratingIdOf(1),
    rater: AUTHOR_SUMMARY,
    score: 4,
    updatedAt: after(1_000).toISOString(),
    state: 'VALID',
  },
  invalidated: {
    ...RATING_BASE,
    id: ratingIdOf(2),
    rater: {
      id: userIdOf(RATER),
      handle: 'user3',
      nickname: '利用者3',
      suspended: false,
    },
    score: 2,
    updatedAt: after(2_000).toISOString(),
    state: 'INVALIDATED',
  },
});

describe('adminComments', () => {
  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    const response = await fetchAdminComments({ first: 50 });

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchAdminComments(
      { first: 50 },
      { caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('閲覧のみの管理者に、コメントを投稿の新しい順に抜粋・投稿者・プロダクトとローンチの回・状態とともに返す', async () => {
    await seedEngagement();

    const response = await fetchAdminComments({ first: 50 }, asViewer());

    expect(response.data?.adminComments).toEqual({
      nodes: [COMMENTS.anonymized, COMMENTS.hidden, COMMENTS.shown],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test.each([
    ['投稿者のハンドル', { authorHandle: 'user1' }, ['hidden', 'shown']],
    [
      'プロダクトのハンドル',
      { productHandle: 'product1' },
      ['anonymized', 'hidden', 'shown'],
    ],
    ['該当の無いハンドル', { productHandle: 'nothing' }, []],
    ['状態', { state: 'HIDDEN' }, ['hidden']],
    [
      '投稿日時の期間',
      {
        postedFrom: after(1_500).toISOString(),
        postedBefore: after(2_500).toISOString(),
      },
      ['hidden'],
    ],
  ])('%sで絞り込める', async (_label, filter, expected) => {
    await seedEngagement();

    const response = await fetchAdminComments(
      { filter, first: 50 },
      asViewer(),
    );

    expect(response.data?.adminComments?.nodes).toEqual(
      expected.map((key) => COMMENTS[key]),
    );
  });

  test('前のページの続きの位置から次のページを返す', async () => {
    await seedEngagement();

    const first = await fetchAdminComments({ first: 2 }, asViewer());
    const next = await fetchAdminComments(
      { first: 2, after: first.data?.adminComments?.pageInfo.endCursor },
      asViewer(),
    );

    expect(first.data?.adminComments?.pageInfo.hasNextPage).toBe(true);
    expect(next.data?.adminComments?.nodes).toEqual([COMMENTS.shown]);
  });

  test('期間の開始が終了より後ならvalidation_errorで拒否する', async () => {
    const response = await fetchAdminComments(
      {
        filter: {
          postedFrom: after(2_000).toISOString(),
          postedBefore: after(1_000).toISOString(),
        },
        first: 50,
      },
      asViewer(),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response).map(({ field }) => field)).toEqual([
      'filter.postedBefore',
    ]);
  });

  test('不正な続きの位置は上流のinvalid_cursorと文言のまま返す', async () => {
    const response = await fetchAdminComments(
      { first: 50, after: 'not-a-cursor' },
      asViewer(),
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
    expect(response.errors?.[0]?.message).toBe(
      'ページの位置の指定が正しくありません。',
    );
  });
});

describe('adminRatings', () => {
  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    const response = await fetchAdminRatings({ first: 50 });

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('閲覧のみの管理者に、評価を更新の新しい順に評価者・プロダクト・状態とともに返す', async () => {
    await seedEngagement();

    const response = await fetchAdminRatings({ first: 50 }, asViewer());

    expect(response.data?.adminRatings).toEqual({
      nodes: [RATINGS.invalidated, RATINGS.valid],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test.each([
    ['評価者のハンドル', { raterHandle: 'user1' }, ['valid']],
    [
      'プロダクトのハンドル',
      { productHandle: 'product1' },
      ['invalidated', 'valid'],
    ],
    ['状態', { state: 'VALID' }, ['valid']],
  ])('%sで絞り込める', async (_label, filter, expected) => {
    await seedEngagement();

    const response = await fetchAdminRatings({ filter, first: 50 }, asViewer());

    expect(response.data?.adminRatings?.nodes).toEqual(
      expected.map((key) => RATINGS[key]),
    );
  });

  test('不正な続きの位置はinvalid_cursorで拒否する', async () => {
    const response = await fetchAdminRatings(
      { first: 50, after: 'not-a-cursor' },
      asViewer(),
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});

describe('コメントと評価の措置', () => {
  test.each([
    ['hideComment', commentIdOf(1)],
    ['invalidateRating', ratingIdOf(1)],
  ] as const)(
    '閲覧のみの管理者の%sはforbiddenで拒否し、記録を残さない',
    async (operation, id) => {
      await seedEngagement();

      const response = await moderateTarget(
        operation,
        { id, reason: REASON },
        asViewer(),
      );

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(await readModerationRows()).toEqual([]);
    },
  );

  test('モデレーターがコメントを非公開化すると最新の理由が一覧に出て、繰り返しは変化なしを返す', async () => {
    await seedEngagement();

    const first = await moderateTarget(
      'hideComment',
      { id: commentIdOf(1), reason: REASON },
      asModerator(),
    );
    const second = await moderateTarget(
      'hideComment',
      { id: commentIdOf(1), reason: REASON },
      asModerator(),
    );
    const listed = await fetchAdminComments(
      { filter: { state: 'HIDDEN' }, first: 50 },
      asViewer(),
    );

    expect(first.data?.hideComment).toEqual({ changed: true });
    expect(second.data?.hideComment).toEqual({ changed: false });
    expect(listed.data?.adminComments?.nodes).toEqual([
      COMMENTS.hidden,
      {
        ...COMMENTS.shown,
        state: 'HIDDEN',
        latestHide: { reason: REASON, occurredAt: NOW },
      },
    ]);
  });

  test('モデレーターが評価を無効化すると最新の理由が一覧に出る', async () => {
    await seedEngagement();

    const response = await moderateTarget(
      'invalidateRating',
      { id: ratingIdOf(1), reason: REASON },
      asModerator(),
    );
    const listed = await fetchAdminRatings(
      { filter: { raterHandle: 'user1' }, first: 50 },
      asViewer(),
    );

    expect(response.data?.invalidateRating).toEqual({ changed: true });
    expect(listed.data?.adminRatings?.nodes).toEqual([
      {
        ...RATINGS.valid,
        updatedAt: NOW,
        state: 'INVALIDATED',
        latestInvalidation: { reason: REASON, occurredAt: NOW },
      },
    ]);
  });

  test.each([
    ['unhideComment', commentIdOf(2)],
    ['revalidateRating', ratingIdOf(2)],
  ] as const)('モデレーターの%sは状態を戻す', async (operation, id) => {
    await seedEngagement();

    const response = await moderateTarget(
      operation,
      { id, reason: '誤った措置のため' },
      asModerator(),
    );

    expect(response.data?.[operation]).toEqual({ changed: true });
  });

  test.each<readonly [TargetModeration, string]>([
    ['hideComment', commentIdOf(1)],
    ['unhideComment', commentIdOf(2)],
    ['invalidateRating', ratingIdOf(1)],
    ['revalidateRating', ratingIdOf(2)],
  ])('%sは理由が無ければvalidation_errorで拒否する', async (operation, id) => {
    await seedEngagement();

    const response = await moderateTarget(
      operation,
      { id, reason: '' },
      asModerator(),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'reason',
        code: 'required',
        message: '理由を入力してください。',
      },
    ]);
  });

  test.each<readonly [TargetModeration, string, string]>([
    ['hideComment', 'comment_not_found', commentIdOf(MISSING)],
    ['unhideComment', 'comment_not_found', commentIdOf(MISSING)],
    ['invalidateRating', 'rating_not_found', ratingIdOf(MISSING)],
    ['revalidateRating', 'rating_not_found', ratingIdOf(MISSING)],
  ])('存在しない対象の%sは%sで拒否する', async (operation, code, id) => {
    await seedEngagement();

    const response = await moderateTarget(
      operation,
      { id, reason: REASON },
      asModerator(),
    );

    expect(codesOf(response)).toEqual([code]);
  });

  test.each<readonly [TargetModeration, string]>([
    ['hideComment', 'コメントが見つかりません。削除された可能性があります。'],
    ['invalidateRating', '評価が見つかりません。'],
  ])(
    '%sの形式の違うIDは存在しない対象と同じ文言のvalidation_errorで拒否する',
    async (operation, message) => {
      const response = await moderateTarget(
        operation,
        { id: 'not-a-ulid', reason: REASON },
        asModerator(),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        { field: 'id', code: 'invalid_format', message },
      ]);
    },
  );
});
