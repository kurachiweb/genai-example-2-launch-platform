import { describe, expect, test } from 'bun:test';

import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import {
  type AdminCommentReader,
  DefaultAdminCommentReader,
} from './admin-comment-reader.ts';
import {
  COMMENT_ID,
  DELETED_PRODUCT_ID,
  LAUNCH_ID,
  NEXT_CURSOR,
  OTHER_COMMENT_ID,
  OTHER_PRODUCT_ID,
  OTHER_USER_ID,
  PRODUCT_ID,
  THIRD_COMMENT_ID,
  USER_ID,
  WITHDRAWN_USER_ID,
  commentOf,
  createEngagementReaderFakes,
  type EngagementReaderFakeOptions,
  productOf,
  userOf,
} from './testing/admin-engagement-reader-fakes.ts';

const createHarness = (options: EngagementReaderFakeOptions = {}) => {
  const fakes = createEngagementReaderFakes(options);
  const reader: AdminCommentReader = new DefaultAdminCommentReader(
    fakes.commentDirectory,
    fakes.profiles,
    fakes.products,
    fakes.records,
  );
  return { reader, calls: fakes.calls };
};

const HIDDEN_AT = new Date('2026-11-19T12:00:00.000Z');

describe('DefaultAdminCommentReader.list', () => {
  test('一覧の投稿者とプロダクトの表示名と非公開化の最新の理由をそれぞれ1回の照会でまとめて組み立てる', async () => {
    const { reader, calls } = createHarness({
      comments: {
        comments: [
          commentOf(),
          commentOf({
            commentId: OTHER_COMMENT_ID,
            productId: OTHER_PRODUCT_ID,
            authorUserId: OTHER_USER_ID,
            excerpt: '非公開化された抜粋',
            editedAt: new Date('2026-11-19T11:00:00.000Z'),
            state: 'hidden',
          }),
          commentOf({
            commentId: THIRD_COMMENT_ID,
            productId: PRODUCT_ID,
            authorUserId: USER_ID,
            state: 'deleted',
          }),
        ],
        nextCursor: NEXT_CURSOR,
      },
      users: [
        userOf(),
        userOf({
          userId: OTHER_USER_ID,
          handle: 'suspended-user',
          nickname: '停止中のひと',
          suspended: true,
        }),
      ],
      products: [
        productOf(),
        productOf({ productId: OTHER_PRODUCT_ID, name: '別の道具' }),
      ],
      latest: new Map([
        [
          OTHER_COMMENT_ID,
          {
            action: 'comment.hide',
            reason: '誹謗中傷のため',
            occurredAt: HIDDEN_AT,
          },
        ],
      ]),
    });

    const page = await reader.list({ filter: {}, first: 50 });

    expect(calls.commentSearch).toEqual([{ filter: {}, page: { limit: 50 } }]);
    expect(calls.userSummaries).toEqual([
      { ids: [USER_ID, OTHER_USER_ID], scope: 'not-withdrawn' },
    ]);
    expect(calls.productSummaries).toEqual([
      { ids: [PRODUCT_ID, OTHER_PRODUCT_ID], scope: 'not-deleted' },
    ]);
    expect(calls.latestFor).toEqual([
      { targetIds: [OTHER_COMMENT_ID], actions: ['comment.hide'] },
    ]);
    expect(page).toEqual({
      comments: [
        {
          commentId: COMMENT_ID,
          productId: PRODUCT_ID,
          launchId: LAUNCH_ID,
          productName: '試合を見守る道具',
          author: {
            userId: USER_ID,
            handle: 'commenter',
            nickname: '投稿したひと',
            suspended: false,
          },
          excerpt: '**太字**のままの抜粋',
          createdAt: new Date('2026-11-19T10:00:00.000Z'),
          editedAt: null,
          state: 'shown',
          latestHide: null,
        },
        {
          commentId: OTHER_COMMENT_ID,
          productId: OTHER_PRODUCT_ID,
          launchId: LAUNCH_ID,
          productName: '別の道具',
          author: {
            userId: OTHER_USER_ID,
            handle: 'suspended-user',
            nickname: '停止中のひと',
            suspended: true,
          },
          excerpt: '非公開化された抜粋',
          createdAt: new Date('2026-11-19T10:00:00.000Z'),
          editedAt: new Date('2026-11-19T11:00:00.000Z'),
          state: 'hidden',
          latestHide: { reason: '誹謗中傷のため', occurredAt: HIDDEN_AT },
        },
        {
          commentId: THIRD_COMMENT_ID,
          productId: PRODUCT_ID,
          launchId: LAUNCH_ID,
          productName: '試合を見守る道具',
          author: {
            userId: USER_ID,
            handle: 'commenter',
            nickname: '投稿したひと',
            suspended: false,
          },
          excerpt: '**太字**のままの抜粋',
          createdAt: new Date('2026-11-19T10:00:00.000Z'),
          editedAt: null,
          state: 'deleted',
          latestHide: null,
        },
      ],
      nextCursor: NEXT_CURSOR,
    });
  });

  test('匿名化の投稿者・退会済みの投稿者・論理削除済みのプロダクト・記録の消えた非公開化はnullにする', async () => {
    const { reader, calls } = createHarness({
      comments: {
        comments: [
          commentOf({ authorUserId: null, excerpt: '', state: 'anonymized' }),
          commentOf({
            commentId: OTHER_COMMENT_ID,
            authorUserId: WITHDRAWN_USER_ID,
            productId: DELETED_PRODUCT_ID,
            state: 'hidden',
          }),
        ],
        nextCursor: null,
      },
      latest: new Map(),
    });

    const page = await reader.list({ filter: {}, first: 50 });

    expect(calls.userSummaries).toEqual([
      { ids: [WITHDRAWN_USER_ID], scope: 'not-withdrawn' },
    ]);
    expect(page.comments.map(({ author }) => author)).toEqual([null, null]);
    expect(page.comments.map(({ productName }) => productName)).toEqual([
      '試合を見守る道具',
      null,
    ]);
    expect(page.comments.map(({ latestHide }) => latestHide)).toEqual([
      null,
      null,
    ]);
  });

  test('投稿者がすべて匿名化で非公開化のコメントが無ければ、利用者と措置の記録を照会しない', async () => {
    const { reader, calls } = createHarness({
      comments: {
        comments: [commentOf({ authorUserId: null, state: 'anonymized' })],
        nextCursor: null,
      },
    });

    await reader.list({ filter: {}, first: 50 });

    expect(calls.userSummaries).toEqual([]);
    expect(calls.latestFor).toEqual([]);
    expect(calls.productSummaries).toHaveLength(1);
  });

  test('投稿者とプロダクトのハンドルを解決し、期間と状態とページとともに上流の一覧へ渡す', async () => {
    const postedFrom = new Date('2026-11-01T00:00:00.000Z');
    const postedBefore = new Date('2026-11-20T00:00:00.000Z');
    const { reader, calls } = createHarness({
      userHandles: new Map([
        ['commenter', { kind: 'current', user: userOf() }],
      ]),
      productHandles: new Map([
        ['old-tool', { kind: 'previous', product: productOf() }],
      ]),
    });

    await reader.list({
      filter: {
        authorHandle: 'commenter',
        productHandle: 'old-tool',
        postedFrom,
        postedBefore,
        state: 'hidden',
      },
      first: 20,
      after: NEXT_CURSOR,
    });

    expect(calls.userHandles).toEqual(['commenter']);
    expect(calls.productHandles).toEqual(['old-tool']);
    expect(calls.commentSearch).toEqual([
      {
        filter: {
          authorUserId: USER_ID,
          productId: PRODUCT_ID,
          postedFrom,
          postedBefore,
          state: 'hidden',
        },
        page: { after: NEXT_CURSOR, limit: 20 },
      },
    ]);
  });

  test('ハンドルの指定が無ければ解決しない', async () => {
    const { reader, calls } = createHarness();

    await reader.list({ filter: { state: 'shown' }, first: 50 });

    expect(calls.userHandles).toEqual([]);
    expect(calls.productHandles).toEqual([]);
    expect(calls.commentSearch[0]?.filter).toEqual({ state: 'shown' });
  });

  test.each([
    ['投稿者', { authorHandle: 'nobody', productHandle: 'old-tool' }],
    ['プロダクト', { authorHandle: 'commenter', productHandle: 'nothing' }],
  ])(
    '%sのハンドルに該当が無ければ、上流の一覧を照会せずに空の結果を返す',
    async (_, filter) => {
      const { reader, calls } = createHarness({
        userHandles: new Map([
          ['commenter', { kind: 'current', user: userOf() }],
        ]),
        productHandles: new Map([
          ['old-tool', { kind: 'current', product: productOf() }],
        ]),
      });

      const page = await reader.list({ filter, first: 50 });

      expect(page).toEqual({ comments: [], nextCursor: null });
      expect(calls.commentSearch).toEqual([]);
    },
  );

  test('上流の一覧が空なら表示名と措置の記録を照会せず、続きの位置をそのまま返す', async () => {
    const { reader, calls } = createHarness({
      comments: { comments: [], nextCursor: null },
    });

    const page = await reader.list({ filter: {}, first: 50 });

    expect(page).toEqual({ comments: [], nextCursor: null });
    expect(calls.userSummaries).toEqual([]);
    expect(calls.productSummaries).toEqual([]);
    expect(calls.latestFor).toEqual([]);
  });

  test('不正な続きの位置は上流のエラーをそのまま投げる', async () => {
    const error = invalidCursorError();
    const { reader, calls } = createHarness({ searchError: error });

    const rejection = await reader
      .list({ filter: {}, first: 50, after: 'broken' })
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );

    expect(rejection).toBe(error);
    expect(calls.userSummaries).toEqual([]);
  });
});
