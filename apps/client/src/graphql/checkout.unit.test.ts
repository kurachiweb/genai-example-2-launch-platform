import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  CHECKOUT_PURCHASE_ID,
  checkoutData,
  openCheckout,
} from '../../test/checkout-fixtures.ts';
import { checkoutQueryOptions, loadCheckoutPage } from './checkout.ts';
import {
  ClientCheckoutDocument,
  type ClientCheckoutQuery,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

describe('checkoutQueryOptions', () => {
  test('操作の識別子と購入のIDで始まり、閲覧者ごとに別のキーにする', () => {
    const own = checkoutQueryOptions(VIEWER, CHECKOUT_PURCHASE_ID).queryKey;
    const other = checkoutQueryOptions(
      { ...VIEWER, id: '01JC0VIEWER0000000000000001' },
      CHECKOUT_PURCHASE_ID,
    ).queryKey;
    const otherPurchase = checkoutQueryOptions(
      VIEWER,
      '01JC0PURCHASE0000000000002',
    ).queryKey;

    expect(own.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientCheckoutDocument),
      { purchaseId: CHECKOUT_PURCHASE_ID },
    ]);
    expect(
      new Set([own, other, otherPurchase].map((key) => JSON.stringify(key)))
        .size,
    ).toBe(3);
  });
});

// 外部へ通信しないよう、同じキーの取得を先に始めておき、loaderの取得をその取得の結果に合流させる
const loadWhileFetching = async (
  purchaseId: string,
  fetched: () => Promise<ClientCheckoutQuery>,
): Promise<unknown> => {
  const queryClient = new QueryClient();
  void queryClient
    .query({
      queryKey: checkoutQueryOptions(VIEWER, purchaseId).queryKey,
      queryFn: fetched,
      retry: false,
    })
    .catch(() => undefined);
  return loadCheckoutPage({
    context: { queryClient, viewer: VIEWER },
    params: { purchaseId },
  }).then(
    () => 'loaded',
    (error: unknown) => error,
  );
};

const validationError = (field: string) =>
  new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容を確認してください。',
    status: 400,
    details: [
      {
        field,
        code: 'too_big',
        message: 'お探しの決済は見つかりませんでした。',
      },
    ],
  });

describe('loadCheckoutPage', () => {
  test('本人の購入を取得できれば、ページを表示する', async () => {
    expect(
      await loadWhileFetching(CHECKOUT_PURCHASE_ID, () =>
        Promise.resolve(checkoutData(openCheckout())),
      ),
    ).toBe('loaded');
  });

  test('他人・存在しない購入は、状態を明かさずに存在しないページにする', async () => {
    const result = await loadWhileFetching(CHECKOUT_PURCHASE_ID, () =>
      Promise.reject(
        new GraphQLClientError({
          code: 'checkout_not_found',
          message: 'お探しの決済は見つかりませんでした。',
          status: 404,
        }),
      ),
    );

    expect(isNotFound(result)).toBe(true);
  });

  test('購入のIDの形式の違反は、他人・不在と同じく存在しないページにする', async () => {
    const result = await loadWhileFetching('0'.repeat(65), () =>
      Promise.reject(validationError('purchaseId')),
    );

    expect(isNotFound(result)).toBe(true);
  });

  test('見つからない旨でない失敗は、そのまま投げてエラーの画面にする', async () => {
    const serverError = new GraphQLClientError({
      code: 'internal_error',
      message: 'サーバーでエラーが発生しました。',
      status: 500,
    });
    const otherField = validationError('sessionId');

    expect(
      await loadWhileFetching(CHECKOUT_PURCHASE_ID, () =>
        Promise.reject(serverError),
      ),
    ).toBe(serverError);
    expect(
      await loadWhileFetching(CHECKOUT_PURCHASE_ID, () =>
        Promise.reject(otherField),
      ),
    ).toBe(otherField);
  });
});
