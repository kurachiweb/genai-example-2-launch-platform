import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { TurnstileTokenController } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ClientUpdateProductDocument } from '../../graphql/generated/graphql.ts';
import {
  invalidateMyProductQueries,
  type MyProductEditView,
  myProductQueryOptions,
  toMyProductEditView,
} from '../../graphql/my-products.ts';
import {
  NEXT_LAUNCH_RESERVED_MESSAGE,
  PRODUCT_SAVED_MESSAGE,
} from './product-edit-messages.ts';
import type { EditProductFormOutput } from './product-form-schema.ts';
import { toUpdateProductInput } from './product-form-values.ts';

// 別の画面での変更・選べる日の締め切り・固定の始まりで拒否された保存は、画面が古い状態を示しているため、最新を示してから選び直させる
const STALE_STATE_CODES: ReadonlySet<string> = new Set([
  'product_update_conflict',
  'launch_date_unavailable',
  'product_locked',
]);

export interface ProductUpdateTarget {
  readonly viewerId: string;
  // フォームを作った時点のプロダクト。編集画面を開いたハンドルと版とカテゴリを送る
  readonly product: MyProductEditView;
  // 真なら次回のローンチの予約を選べる計画で、ローンチ日を選んだ保存は予約になる
  readonly reserving: boolean;
  readonly onSaved: (saved: MyProductEditView) => void;
}

export type ProductUpdate = (
  values: EditProductFormOutput,
  turnstile: TurnstileTokenController,
) => Promise<void>;

// 成功したら保存の結果を新しいハンドルの取得へ入れ、ハンドルが変わっていれば新しい編集画面のURLへ置き換えてから、一覧とローンチ履歴の取得を古いものにする
export function useProductUpdate({
  viewerId,
  product,
  reserving,
  onSaved,
}: ProductUpdateTarget): ProductUpdate {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const updateProduct = useMutation(
    graphqlMutationOptions(ClientUpdateProductDocument),
  );

  return async (values, turnstile) => {
    const { updateProduct: updated } = await sendWithTurnstile(
      turnstile,
      (turnstileToken) =>
        updateProduct.mutateAsync({
          variables: { input: toUpdateProductInput(values, product) },
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
    const saved = toMyProductEditView(updated);
    queryClient.setQueryData(
      myProductQueryOptions(viewerId, saved.handle).queryKey,
      { myProduct: { __typename: 'MyProduct' as const, ...updated } },
    );
    notify.success(
      reserving && values.launchDate != null
        ? NEXT_LAUNCH_RESERVED_MESSAGE
        : PRODUCT_SAVED_MESSAGE,
    );
    onSaved(saved);
    if (saved.handle !== product.handle) {
      await navigate({
        to: '/my/products/$handle/edit',
        params: { handle: saved.handle },
        replace: true,
      });
    }
    await invalidateMyProductQueries(queryClient);
  };
}
