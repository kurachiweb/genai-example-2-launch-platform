import { describe, expect, test } from 'bun:test';

import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import {
  type AdminRatingReader,
  DefaultAdminRatingReader,
} from './admin-rating-reader.ts';
import {
  DELETED_PRODUCT_ID,
  NEXT_CURSOR,
  OTHER_PRODUCT_ID,
  OTHER_RATING_ID,
  OTHER_USER_ID,
  PRODUCT_ID,
  RATING_ID,
  USER_ID,
  WITHDRAWN_USER_ID,
  createEngagementReaderFakes,
  type EngagementReaderFakeOptions,
  productOf,
  ratingOf,
  userOf,
} from './testing/admin-engagement-reader-fakes.ts';

const createHarness = (options: EngagementReaderFakeOptions = {}) => {
  const fakes = createEngagementReaderFakes(options);
  const reader: AdminRatingReader = new DefaultAdminRatingReader(
    fakes.ratingDirectory,
    fakes.profiles,
    fakes.products,
    fakes.records,
  );
  return { reader, calls: fakes.calls };
};

const INVALIDATED_AT = new Date('2026-11-19T12:00:00.000Z');

describe('DefaultAdminRatingReader.list', () => {
  test('一覧の評価者とプロダクトの表示名と無効化の最新の理由をそれぞれ1回の照会でまとめて組み立てる', async () => {
    const { reader, calls } = createHarness({
      ratings: {
        ratings: [
          ratingOf(),
          ratingOf({
            ratingId: OTHER_RATING_ID,
            productId: OTHER_PRODUCT_ID,
            userId: OTHER_USER_ID,
            score: 1,
            invalidatedAt: INVALIDATED_AT,
          }),
        ],
        nextCursor: NEXT_CURSOR,
      },
      users: [
        userOf({ handle: 'rater', nickname: '評価したひと' }),
        userOf({
          userId: OTHER_USER_ID,
          handle: 'suspended-rater',
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
          OTHER_RATING_ID,
          {
            action: 'rating.invalidate',
            reason: '自作自演の評価のため',
            occurredAt: INVALIDATED_AT,
          },
        ],
      ]),
    });

    const page = await reader.list({ filter: {}, first: 50 });

    expect(calls.ratingSearch).toEqual([{ filter: {}, page: { limit: 50 } }]);
    expect(calls.userSummaries).toEqual([
      { ids: [USER_ID, OTHER_USER_ID], scope: 'not-withdrawn' },
    ]);
    expect(calls.productSummaries).toEqual([
      { ids: [PRODUCT_ID, OTHER_PRODUCT_ID], scope: 'not-deleted' },
    ]);
    expect(calls.latestFor).toEqual([
      { targetIds: [OTHER_RATING_ID], actions: ['rating.invalidate'] },
    ]);
    expect(page).toEqual({
      ratings: [
        {
          ratingId: RATING_ID,
          productId: PRODUCT_ID,
          productName: '試合を見守る道具',
          rater: {
            userId: USER_ID,
            handle: 'rater',
            nickname: '評価したひと',
            suspended: false,
          },
          score: 4,
          createdAt: new Date('2026-11-18T10:00:00.000Z'),
          updatedAt: new Date('2026-11-19T10:00:00.000Z'),
          state: 'valid',
          invalidatedAt: null,
          latestInvalidation: null,
        },
        {
          ratingId: OTHER_RATING_ID,
          productId: OTHER_PRODUCT_ID,
          productName: '別の道具',
          rater: {
            userId: OTHER_USER_ID,
            handle: 'suspended-rater',
            nickname: '停止中のひと',
            suspended: true,
          },
          score: 1,
          createdAt: new Date('2026-11-18T10:00:00.000Z'),
          updatedAt: new Date('2026-11-19T10:00:00.000Z'),
          state: 'invalidated',
          invalidatedAt: INVALIDATED_AT,
          latestInvalidation: {
            reason: '自作自演の評価のため',
            occurredAt: INVALIDATED_AT,
          },
        },
      ],
      nextCursor: NEXT_CURSOR,
    });
  });

  test('退会済みの評価者・論理削除済みのプロダクト・記録の消えた無効化はnullにする', async () => {
    const { reader, calls } = createHarness({
      ratings: {
        ratings: [
          ratingOf({
            userId: WITHDRAWN_USER_ID,
            productId: DELETED_PRODUCT_ID,
            invalidatedAt: INVALIDATED_AT,
          }),
        ],
        nextCursor: null,
      },
    });

    const page = await reader.list({ filter: {}, first: 50 });

    expect(calls.latestFor).toEqual([
      { targetIds: [RATING_ID], actions: ['rating.invalidate'] },
    ]);
    expect(page.ratings).toEqual([
      expect.objectContaining({
        rater: null,
        productName: null,
        state: 'invalidated',
        latestInvalidation: null,
      }),
    ]);
  });

  test('無効化された評価が無ければ措置の記録を照会しない', async () => {
    const { reader, calls } = createHarness();

    await reader.list({ filter: {}, first: 50 });

    expect(calls.latestFor).toEqual([]);
  });

  test('プロダクトと評価者のハンドルを解決し、状態とページとともに上流の一覧へ渡す', async () => {
    const { reader, calls } = createHarness({
      userHandles: new Map([
        ['old-rater', { kind: 'previous', user: userOf() }],
      ]),
      productHandles: new Map([
        ['launch-stadium-tool', { kind: 'current', product: productOf() }],
      ]),
    });

    await reader.list({
      filter: {
        productHandle: 'launch-stadium-tool',
        raterHandle: 'old-rater',
        state: 'invalidated',
      },
      first: 20,
      after: NEXT_CURSOR,
    });

    expect(calls.productHandles).toEqual(['launch-stadium-tool']);
    expect(calls.userHandles).toEqual(['old-rater']);
    expect(calls.ratingSearch).toEqual([
      {
        filter: {
          productId: PRODUCT_ID,
          userId: USER_ID,
          state: 'invalidated',
        },
        page: { after: NEXT_CURSOR, limit: 20 },
      },
    ]);
  });

  test('プロダクトの詳細の評価の一覧はプロダクトのIDで絞り込み、ハンドルを解決しない', async () => {
    const { reader, calls } = createHarness();

    await reader.list({ filter: { productId: PRODUCT_ID }, first: 50 });

    expect(calls.productHandles).toEqual([]);
    expect(calls.userHandles).toEqual([]);
    expect(calls.ratingSearch[0]?.filter).toEqual({ productId: PRODUCT_ID });
  });

  test.each([
    ['評価者', { raterHandle: 'nobody', productHandle: 'launch-stadium-tool' }],
    ['プロダクト', { raterHandle: 'rater', productHandle: 'nothing' }],
    [
      'プロダクトのIDと異なるプロダクト',
      { productId: OTHER_PRODUCT_ID, productHandle: 'launch-stadium-tool' },
    ],
  ])(
    '%sのハンドルに該当が無ければ、上流の一覧を照会せずに空の結果を返す',
    async (_, filter) => {
      const { reader, calls } = createHarness({
        userHandles: new Map([['rater', { kind: 'current', user: userOf() }]]),
        productHandles: new Map([
          ['launch-stadium-tool', { kind: 'current', product: productOf() }],
        ]),
      });

      const page = await reader.list({ filter, first: 50 });

      expect(page).toEqual({ ratings: [], nextCursor: null });
      expect(calls.ratingSearch).toEqual([]);
    },
  );

  test('プロダクトのIDとハンドルが同じプロダクトを指すなら、そのIDで絞り込む', async () => {
    const { reader, calls } = createHarness({
      productHandles: new Map([
        ['launch-stadium-tool', { kind: 'current', product: productOf() }],
      ]),
    });

    await reader.list({
      filter: { productId: PRODUCT_ID, productHandle: 'launch-stadium-tool' },
      first: 50,
    });

    expect(calls.ratingSearch[0]?.filter).toEqual({ productId: PRODUCT_ID });
  });

  test('上流の一覧が空なら表示名と措置の記録を照会せず、続きの位置をそのまま返す', async () => {
    const { reader, calls } = createHarness({
      ratings: { ratings: [], nextCursor: null },
    });

    const page = await reader.list({ filter: {}, first: 50 });

    expect(page).toEqual({ ratings: [], nextCursor: null });
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
