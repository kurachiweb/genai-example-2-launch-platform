import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  launchCommentCountsKeyOf,
  launchCommentCountsQueryOptions,
  launchCommentsQueryOptions,
  productRatingQueryOptions,
  replaceProductRating,
} from './engagement.ts';
import {
  ClientLaunchCommentCountsDocument,
  ClientLaunchCommentsDocument,
  ClientProductRatingDocument,
  type ProductRatingFragment,
} from './generated/graphql.ts';

const PRODUCT_ID = '01JC0PRODUCT000000000000001';

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const RATING: ProductRatingFragment = {
  productId: PRODUCT_ID,
  average: 4.25,
  count: 4,
  viewerScore: 5,
};

describe('productRatingQueryOptions', () => {
  test('操作の識別子とプロダクトのIDで始まり、閲覧者ごとと未ログインで別のキーにする', () => {
    const own = productRatingQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey;
    const other = productRatingQueryOptions(
      '01JC0VIEWER0000000000000001',
      PRODUCT_ID,
    ).queryKey;
    const guest = productRatingQueryOptions(null, PRODUCT_ID).queryKey;

    expect(own.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientProductRatingDocument),
      { productId: PRODUCT_ID },
    ]);
    expect(
      new Set([own, other, guest].map((key) => JSON.stringify(key))).size,
    ).toBe(3);
  });

  test('プロダクトごとに別のキーにする', () => {
    expect(
      productRatingQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey,
    ).not.toStrictEqual(
      productRatingQueryOptions(VIEWER_ID, '01JC0PRODUCT000000000000002')
        .queryKey,
    );
  });
});

describe('replaceProductRating', () => {
  test('操作の結果で同じ閲覧者とプロダクトの評価欄の値を取り直さずに置き換える', () => {
    const queryClient = new QueryClient();
    const { queryKey } = productRatingQueryOptions(VIEWER_ID, PRODUCT_ID);
    queryClient.setQueryData(queryKey, {
      productRating: { ...RATING, average: 4, count: 3, viewerScore: null },
    });

    replaceProductRating(queryClient, VIEWER_ID, RATING);

    expect(queryClient.getQueryData(queryKey)).toStrictEqual({
      productRating: RATING,
    });
  });

  test('未取得の評価欄にも値を入れ、他の閲覧者の値は変えない', () => {
    const queryClient = new QueryClient();
    const otherKey = productRatingQueryOptions(null, PRODUCT_ID).queryKey;
    const guestRating = { ...RATING, viewerScore: null };
    queryClient.setQueryData(otherKey, { productRating: guestRating });

    replaceProductRating(queryClient, VIEWER_ID, RATING);

    expect(
      queryClient.getQueryData(
        productRatingQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey,
      ),
    ).toStrictEqual({ productRating: RATING });
    expect(queryClient.getQueryData(otherKey)).toStrictEqual({
      productRating: guestRating,
    });
  });
});

const LAUNCH_ID = '01JC0LAUNCH0000000000000001';

const threadPageOf = (endCursor: string | null, hasNextPage: boolean) => ({
  launchComments: { nodes: [], pageInfo: { endCursor, hasNextPage } },
});

describe('launchCommentsQueryOptions', () => {
  test('操作の識別子とプロダクト・ローンチのIDで始まり、閲覧者ごとと未ログインとローンチごとで別のキーにする', () => {
    const own = launchCommentsQueryOptions(
      VIEWER_ID,
      PRODUCT_ID,
      LAUNCH_ID,
    ).queryKey;
    const guest = launchCommentsQueryOptions(
      null,
      PRODUCT_ID,
      LAUNCH_ID,
    ).queryKey;
    const otherLaunch = launchCommentsQueryOptions(
      VIEWER_ID,
      PRODUCT_ID,
      '01JC0LAUNCH0000000000000002',
    ).queryKey;

    expect(own.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientLaunchCommentsDocument),
      { productId: PRODUCT_ID, launchId: LAUNCH_ID },
    ]);
    expect(
      new Set([own, guest, otherLaunch].map((key) => JSON.stringify(key))).size,
    ).toBe(3);
  });

  test('最初のページはカーソル無しで読み、続きがあれば最後のカーソルを次のページの引数にする', () => {
    const options = launchCommentsQueryOptions(
      VIEWER_ID,
      PRODUCT_ID,
      LAUNCH_ID,
    );

    expect(options.initialPageParam).toBeNull();
    expect(
      options.getNextPageParam(threadPageOf('cursor-10', true), [], null, []),
    ).toBe('cursor-10');
    expect(
      options.getNextPageParam(threadPageOf('cursor-10', false), [], null, []),
    ).toBeUndefined();
    expect(
      options.getNextPageParam(threadPageOf(null, true), [], null, []),
    ).toBeUndefined();
    expect(
      options.getNextPageParam({ launchComments: null }, [], null, []),
    ).toBeUndefined();
  });
});

describe('launchCommentCountsQueryOptions', () => {
  test('操作の識別子とプロダクトのIDで始まり、ローンチを含めずに閲覧者ごとと未ログインで別のキーにする', () => {
    const own = launchCommentCountsQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey;
    const guest = launchCommentCountsQueryOptions(null, PRODUCT_ID).queryKey;

    expect(own.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientLaunchCommentCountsDocument),
      { productId: PRODUCT_ID },
    ]);
    expect(JSON.stringify(own)).not.toBe(JSON.stringify(guest));
  });

  test('同じプロダクトの件数は全ての閲覧者のキーを共通の前方の部分でまとめて無効にできる', () => {
    expect(
      launchCommentCountsQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey.slice(
        0,
        2,
      ),
    ).toStrictEqual([...launchCommentCountsKeyOf(PRODUCT_ID)]);
  });
});
