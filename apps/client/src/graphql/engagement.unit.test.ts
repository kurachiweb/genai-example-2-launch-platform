import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  productRatingQueryOptions,
  replaceProductRating,
} from './engagement.ts';
import {
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
