import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { TurnstileTokenController } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ClientDeleteProductDocument } from '../../graphql/generated/graphql.ts';
import { invalidateMyProductQueries } from '../../graphql/my-products.ts';
import { PRODUCT_DELETED_MESSAGE } from './product-edit-messages.ts';

// 別の画面での変更と固定の始まりで拒否された削除は、画面が古い状態を示しているため、最新を示す
const STALE_STATE_CODES: ReadonlySet<string> = new Set([
  'product_update_conflict',
  'product_locked',
]);

export interface ProductDeletionTarget {
  readonly productHandle: string;
  // 編集画面が表示中に取り直した最新の版
  readonly expectedVersion: number;
}

export type ProductDeletion = (
  turnstile: TurnstileTokenController,
) => Promise<void>;

// 成功したら、表示中の編集画面が消えたプロダクトを取り直さないよう取得を古いものとだけし、自分のプロダクトの一覧へ移ってから一覧を取得し直させる
export function useProductDeletion({
  productHandle,
  expectedVersion,
}: ProductDeletionTarget): ProductDeletion {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deleteProduct = useMutation(
    graphqlMutationOptions(ClientDeleteProductDocument),
  );

  return async (turnstile) => {
    await sendWithTurnstile(turnstile, (turnstileToken) =>
      deleteProduct.mutateAsync({
        variables: { productHandle, expectedVersion },
        turnstileToken,
      }),
    ).catch((error: unknown) => {
      if (
        error instanceof GraphQLClientError &&
        STALE_STATE_CODES.has(error.code)
      ) {
        void invalidateMyProductQueries(queryClient);
      }
      throw error;
    });
    await invalidateMyProductQueries(queryClient, { refetchActive: false });
    notify.success(PRODUCT_DELETED_MESSAGE);
    await navigate({ to: '/my/products' });
  };
}
