import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import {
  GraphQLClientError,
  requireData,
} from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import { ClientCheckoutDocument } from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

// 購入はセッションの利用者のもののため、同じタブで別の利用者がログインした後に前の取得結果を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const checkoutQueryOptions = (
  viewer: ClientViewer,
  purchaseId: string,
) => {
  const variables = { purchaseId };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientCheckoutDocument, variables),
      viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientCheckoutDocument, variables, { signal }),
      ),
  });
};

const CHECKOUT_NOT_FOUND = 'checkout_not_found';

const VALIDATION_ERROR = 'validation_error';

const PURCHASE_ID_FIELD = 'purchaseId';

// APIサーバーは長すぎる購入のIDを見つからない旨ではなく入力の検証の失敗で返すため、他人・不在と同じ表示にして、形式で存在の有無を区別させない
const isCheckoutNotFound = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  (error.code === CHECKOUT_NOT_FOUND ||
    (error.code === VALIDATION_ERROR &&
      (error.details ?? []).some(({ field }) => field === PURCHASE_ID_FIELD)));

// 支払いの状態は決済後のランディングやWebhookの反映で変わるため、別のページから戻った時も最新を示すよう、loaderはキャッシュの鮮度によらず毎回取得する
export async function loadCheckoutPage({
  context,
  params,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
  readonly params: { readonly purchaseId: string };
}): Promise<void> {
  await context.queryClient
    .query({
      ...checkoutQueryOptions(context.viewer, params.purchaseId),
      staleTime: 0,
    })
    .catch((error: unknown) => {
      if (isCheckoutNotFound(error)) {
        throw notFound();
      }
      throw error;
    });
}
