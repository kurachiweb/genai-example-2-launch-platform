import { beforeEach, describe, expect, test } from 'vitest';

import { COMMENT_PAGE_SIZE } from '../../../../../common-lib/engagement/engagement-rules.ts';
import {
  after,
  commentIdOf,
  insertComment,
  insertComments,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
} from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { ENGAGEMENT_ERRORS } from '../../../../application/engagement/engagement-errors.ts';
import {
  fetchLaunchCommentCounts,
  fetchLaunchComments,
  hideEngagementAuthorSummaries,
  installEngagementGraphQLTest,
  issueEngagementUserSession,
  type LaunchCommentFields,
} from '../../../../../test/support/engagement-graphql-operations.ts';
import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/product-graphql-operations.ts';

installEngagementGraphQLTest();

const OWNER = 1;
const COMMENTER = 2;
const VIEWER = 3;
const SUSPENDED = 4;

const LISTED = 1;
const UNLISTED = 2;
const OTHER = 3;

const WON_LAUNCH = 1;
const CURRENT_LAUNCH = 2;
const QUIET_LAUNCH = 3;
const CANCELED_LAUNCH = 4;
const UNLISTED_LAUNCH = 5;
const OTHER_LAUNCH = 6;

const TOP = 1;
const OWNER_REPLY = 2;
const DEEP_REPLY = 3;
const REMOVED_TOP = 4;
const SUSPENDED_TOP = 5;

const TARGET_NOT_FOUND_MESSAGE =
  ENGAGEMENT_ERRORS.comment_target_not_found.message;

// プロダクト1は掲載中(勝利したローンチ1を持つ)で、当日のローンチ2・コメントの無い敗北したローンチ3・取消のローンチ4を持つ。
// プロダクト2は利用者1の未掲載のプロダクト、プロダクト3は別の利用者の掲載中でないプロダクト
async function seedProducts(): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertUser(VIEWER, { emailVerifiedAt: T0 });
  await insertUser(SUSPENDED, {
    emailVerifiedAt: T0,
    status: 'suspended',
    suspendedAt: T0,
  });
  await insertProduct(LISTED, OWNER);
  await insertLaunch(WON_LAUNCH, LISTED, {
    launchDate: '2026-11-05',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(CURRENT_LAUNCH, LISTED, { launchDate: '2026-11-10' });
  await insertLaunch(QUIET_LAUNCH, LISTED, {
    launchDate: '2026-11-08',
    outcome: 'lost',
    decidedAt: T0,
  });
  await insertLaunch(CANCELED_LAUNCH, LISTED, {
    launchDate: '2026-11-09',
    cancelledAt: T0,
  });
  await insertProduct(UNLISTED, OWNER);
  await insertLaunch(UNLISTED_LAUNCH, UNLISTED, { launchDate: '2026-11-10' });
  await insertProduct(OTHER, VIEWER);
  await insertLaunch(OTHER_LAUNCH, OTHER, { launchDate: '2026-11-10' });
}

// 当日のローンチ2に、表示できるトップレベル1と投稿者本人の返信2・第3階層の返信3、利用者1が削除した編集済みのトップレベル4、停止中の利用者のトップレベル5を置く
async function seedThread(): Promise<void> {
  await insertComments([
    {
      index: TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: COMMENTER,
      columns: {
        body: '**最高**のプロダクト',
        createdAt: after(1_000),
        editedAt: after(5_000),
      },
    },
    {
      index: OWNER_REPLY,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: OWNER,
      parent: { index: TOP, root: TOP },
      depth: 2,
      columns: { body: 'ありがとうございます', createdAt: after(2_000) },
    },
    {
      index: DEEP_REPLY,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: COMMENTER,
      parent: { index: OWNER_REPLY, root: TOP },
      depth: 3,
      columns: { body: 'どういたしまして', createdAt: after(3_000) },
    },
    {
      index: REMOVED_TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: OWNER,
      columns: {
        createdAt: after(4_000),
        editedAt: after(4_500),
        deletedAt: after(4_800),
      },
    },
    {
      index: SUSPENDED_TOP,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: SUSPENDED,
      columns: { createdAt: after(6_000) },
    },
  ]);
}

const REMOVED_FIELDS = {
  state: 'REMOVED',
  author: null,
  body: null,
  createdAt: null,
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: false,
} as const;

const removedComment = (index: number): LaunchCommentFields => ({
  id: commentIdOf(index),
  parentId: null,
  depth: 1,
  ...REMOVED_FIELDS,
});

const currentLaunchArgs = {
  productId: productIdOf(LISTED),
  launchId: launchIdOf(CURRENT_LAUNCH),
};

beforeEach(async () => {
  await seedProducts();
});

describe('launchComments・launchCommentCounts: 呼び出し元と引数', () => {
  test('呼び出し元が利用者側でなければforbiddenで拒否する', async () => {
    const comments = await fetchLaunchComments(currentLaunchArgs, {
      caller: 'admin',
    });
    const counts = await fetchLaunchCommentCounts(productIdOf(LISTED), {
      caller: 'admin',
    });

    expect(codesOf(comments)).toEqual(['forbidden']);
    expect(comments.data?.launchComments).toBeNull();
    expect(codesOf(counts)).toEqual(['forbidden']);
    expect(counts.data?.launchCommentCounts).toBeNull();
  });

  test('ULIDでないプロダクトとローンチのIDを、投稿先が見つからない文言のvalidation_errorにする', async () => {
    const comments = await fetchLaunchComments({
      productId: 'product-1',
      launchId: launchIdOf(CURRENT_LAUNCH).toLowerCase(),
    });
    const counts = await fetchLaunchCommentCounts('product-1');

    expect(codesOf(comments)).toEqual(['validation_error']);
    expect(detailsOf(comments)).toEqual([
      {
        field: 'productId',
        code: 'invalid_format',
        message: TARGET_NOT_FOUND_MESSAGE,
      },
      {
        field: 'launchId',
        code: 'invalid_format',
        message: TARGET_NOT_FOUND_MESSAGE,
      },
    ]);
    expect(codesOf(counts)).toEqual(['validation_error']);
    expect(detailsOf(counts)).toEqual([
      {
        field: 'productId',
        code: 'invalid_format',
        message: TARGET_NOT_FOUND_MESSAGE,
      },
    ]);
  });

  test('復号できないカーソルをinvalid_cursorにし、長すぎるカーソルを同じ文言のvalidation_errorにする', async () => {
    const malformed = await fetchLaunchComments({
      ...currentLaunchArgs,
      after: 'not-a-cursor',
    });
    const tooLong = await fetchLaunchComments({
      ...currentLaunchArgs,
      after: 'a'.repeat(257),
    });

    expect(codesOf(malformed)).toEqual(['invalid_cursor']);
    expect(codesOf(tooLong)).toEqual(['validation_error']);
    expect(detailsOf(tooLong)).toEqual([
      {
        field: 'after',
        code: 'too_big',
        message: 'ページの位置の指定が正しくありません。',
      },
    ]);
  });

  test('カーソルの明示したnullは未指定と同じく最初のページを返す', async () => {
    await seedThread();

    const response = await fetchLaunchComments({
      ...currentLaunchArgs,
      after: null,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.launchComments?.nodes).toHaveLength(3);
  });
});

describe('launchComments: スレッドの項目', () => {
  beforeEach(async () => {
    await seedThread();
  });

  test('トップレベルを新しい順に、返信を階層を保った平たい一覧で、投稿者と本文と印を添えて返す', async () => {
    const response = await fetchLaunchComments(currentLaunchArgs, {
      sessionToken: await issueEngagementUserSession(COMMENTER),
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.launchComments).toEqual({
      nodes: [
        { comment: removedComment(SUSPENDED_TOP), replies: [] },
        { comment: removedComment(REMOVED_TOP), replies: [] },
        {
          comment: {
            id: commentIdOf(TOP),
            parentId: null,
            depth: 1,
            state: 'SHOWN',
            author: { handle: 'user2', nickname: '利用者2', avatar: null },
            body: '**最高**のプロダクト',
            createdAt: after(1_000).toISOString(),
            edited: true,
            byProductOwner: false,
            viewerIsAuthor: true,
          },
          replies: [
            {
              id: commentIdOf(OWNER_REPLY),
              parentId: commentIdOf(TOP),
              depth: 2,
              state: 'SHOWN',
              author: { handle: 'user1', nickname: '利用者1', avatar: null },
              body: 'ありがとうございます',
              createdAt: after(2_000).toISOString(),
              edited: false,
              byProductOwner: true,
              viewerIsAuthor: false,
            },
            {
              id: commentIdOf(DEEP_REPLY),
              parentId: commentIdOf(OWNER_REPLY),
              depth: 3,
              state: 'SHOWN',
              author: { handle: 'user2', nickname: '利用者2', avatar: null },
              body: 'どういたしまして',
              createdAt: after(3_000).toISOString(),
              edited: false,
              byProductOwner: false,
              viewerIsAuthor: true,
            },
          ],
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: expect.any(String) as string },
    });
  });

  test('置き換え表示は、閲覧者が投稿者本人でプロダクトの投稿者でも、投稿者・本文・日時をnull、編集の印とバッジとあなたの判定を偽で返す', async () => {
    const response = await fetchLaunchComments(currentLaunchArgs, {
      sessionToken: await issueEngagementUserSession(OWNER),
    });

    const removed = response.data?.launchComments?.nodes.find(
      ({ comment }) => comment.id === commentIdOf(REMOVED_TOP),
    );
    expect(removed?.comment).toEqual(removedComment(REMOVED_TOP));
  });

  test('未ログインの閲覧者には、どのコメントもあなたの判定を偽で返す', async () => {
    const response = await fetchLaunchComments(currentLaunchArgs);

    const flags = response.data?.launchComments?.nodes.flatMap(
      ({ comment, replies }) =>
        [comment, ...replies].map(({ viewerIsAuthor }) => viewerIsAuthor),
    );
    expect(flags).toEqual([false, false, false, false, false]);
  });

  test('照会の後に投稿者を表示できなくなった表示できるコメントは、投稿者だけをnullのまま返す', async () => {
    hideEngagementAuthorSummaries([OWNER]);

    const response = await fetchLaunchComments(currentLaunchArgs);

    const thread = response.data?.launchComments?.nodes.find(
      ({ comment }) => comment.id === commentIdOf(TOP),
    );
    expect(response.errors).toBeUndefined();
    expect(thread?.replies[0]).toMatchObject({
      id: commentIdOf(OWNER_REPLY),
      state: 'SHOWN',
      author: null,
      body: 'ありがとうございます',
      byProductOwner: true,
    });
    expect(thread?.comment.author).toEqual({
      handle: 'user2',
      nickname: '利用者2',
      avatar: null,
    });
  });
});

describe('launchComments: ページ分け', () => {
  test(`トップレベルを${String(COMMENT_PAGE_SIZE)}件ずつ返し、終わりのカーソルで続きを重複・欠落なく返す`, async () => {
    const total = COMMENT_PAGE_SIZE + 2;
    await insertComments(
      Array.from({ length: total }, (_, offset) => ({
        index: 100 + offset,
        product: LISTED,
        launch: CURRENT_LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(offset * 1_000) },
      })),
    );

    const first = await fetchLaunchComments(currentLaunchArgs);
    const endCursor = first.data?.launchComments?.pageInfo.endCursor;
    await insertComment({
      index: 200,
      product: LISTED,
      launch: CURRENT_LAUNCH,
      author: COMMENTER,
      columns: { createdAt: after(total * 1_000) },
    });
    const second = await fetchLaunchComments({
      ...currentLaunchArgs,
      after: endCursor,
    });

    const idsOf = (response: typeof first) =>
      response.data?.launchComments?.nodes.map(({ comment }) => comment.id);
    expect(idsOf(first)).toEqual(
      Array.from({ length: COMMENT_PAGE_SIZE }, (_, offset) =>
        commentIdOf(100 + total - 1 - offset),
      ),
    );
    expect(first.data?.launchComments?.pageInfo.hasNextPage).toBe(true);
    expect(idsOf(second)).toEqual([commentIdOf(101), commentIdOf(100)]);
    expect(second.data?.launchComments?.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: expect.any(String) as string,
    });
  });

  test('コメントの無いローンチは空のページを返す', async () => {
    const response = await fetchLaunchComments({
      productId: productIdOf(LISTED),
      launchId: launchIdOf(QUIET_LAUNCH),
    });

    expect(response.data?.launchComments).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });
});

describe('launchComments・launchCommentCounts: 閲覧できない照会', () => {
  test('未掲載の他者のプロダクトは両方の照会をnullにし、投稿者本人には返す', async () => {
    const unlisted = {
      productId: productIdOf(UNLISTED),
      launchId: launchIdOf(UNLISTED_LAUNCH),
    };
    const viewer = { sessionToken: await issueEngagementUserSession(VIEWER) };
    const owner = { sessionToken: await issueEngagementUserSession(OWNER) };

    const viewerComments = await fetchLaunchComments(unlisted, viewer);
    const viewerCounts = await fetchLaunchCommentCounts(
      productIdOf(UNLISTED),
      viewer,
    );
    const ownerComments = await fetchLaunchComments(unlisted, owner);
    const ownerCounts = await fetchLaunchCommentCounts(
      productIdOf(UNLISTED),
      owner,
    );

    expect(viewerComments.errors).toBeUndefined();
    expect(viewerComments.data?.launchComments).toBeNull();
    expect(viewerCounts.errors).toBeUndefined();
    expect(viewerCounts.data?.launchCommentCounts).toBeNull();
    expect(ownerComments.data?.launchComments?.nodes).toEqual([]);
    expect(ownerCounts.data?.launchCommentCounts).toEqual([
      { launchId: launchIdOf(UNLISTED_LAUNCH), count: 0 },
    ]);
  });

  test('別のプロダクト・取消・存在しないローンチと、存在しないプロダクトはnullを返す', async () => {
    const otherLaunch = await fetchLaunchComments({
      productId: productIdOf(LISTED),
      launchId: launchIdOf(OTHER_LAUNCH),
    });
    const canceled = await fetchLaunchComments({
      productId: productIdOf(LISTED),
      launchId: launchIdOf(CANCELED_LAUNCH),
    });
    const missingLaunch = await fetchLaunchComments({
      productId: productIdOf(LISTED),
      launchId: launchIdOf(99),
    });
    const missingCounts = await fetchLaunchCommentCounts(productIdOf(99));

    expect(otherLaunch.data?.launchComments).toBeNull();
    expect(canceled.data?.launchComments).toBeNull();
    expect(missingLaunch.data?.launchComments).toBeNull();
    expect(missingCounts.errors).toBeUndefined();
    expect(missingCounts.data?.launchCommentCounts).toBeNull();
  });
});

describe('launchCommentCounts: ローンチごとの件数', () => {
  test('取消を除く全てのローンチの表示できるコメント(返信を含む)の数を、置き換え表示を除き0で補って返す', async () => {
    await seedThread();
    await insertComment({
      index: 50,
      product: LISTED,
      launch: WON_LAUNCH,
      author: VIEWER,
    });

    const response = await fetchLaunchCommentCounts(productIdOf(LISTED));

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.launchCommentCounts?.toSorted((left, right) =>
        left.launchId.localeCompare(right.launchId),
      ),
    ).toEqual([
      { launchId: launchIdOf(WON_LAUNCH), count: 1 },
      { launchId: launchIdOf(CURRENT_LAUNCH), count: 3 },
      { launchId: launchIdOf(QUIET_LAUNCH), count: 0 },
    ]);
  });

  test('未ログインの閲覧者でも件数を返す', async () => {
    const response = await fetchLaunchCommentCounts(productIdOf(LISTED));

    expect(response.data?.launchCommentCounts).toHaveLength(3);
  });
});
