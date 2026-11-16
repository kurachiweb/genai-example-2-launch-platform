import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  productRatingQueryOptions,
  replaceProductRating,
} from '../../graphql/engagement.ts';
import {
  ClientCancelProductRatingDocument,
  ClientRateProductDocument,
  type ProductRatingFragment,
} from '../../graphql/generated/graphql.ts';
import {
  RATED_MESSAGE,
  RATING_CANCELLED_MESSAGE,
  RATING_CHANGED_MESSAGE,
} from './rating-messages.ts';

export interface UseRatingMutationsOptions {
  // 評価欄の取得の結果(キャッシュ)
  readonly rating: ProductRatingFragment;
  // ログイン中の閲覧者のID。未ログインの閲覧者は呼び出し側が評価を送らせない
  readonly viewerId: string;
  // 取消の結果をキャッシュへ入れた後に呼ぶ
  readonly onCancelled?: () => void;
}

export interface RatingMutations {
  // 評価か取消を送っている
  readonly busy: boolean;
  readonly cancelling: boolean;
  readonly rate: (score: number) => void;
  readonly cancel: () => void;
}

// 評価の値の誤りは欄を持たない入力のため、項目の詳細の文言を示す
const ratingErrorMessageOf = (error: unknown): string => {
  if (
    error instanceof GraphQLClientError &&
    error.code === 'validation_error'
  ) {
    const detail = error.details?.[0];
    if (detail !== undefined) {
      return detail.message;
    }
  }
  return errorMessageOf(error, CLIENT_PROFILE.contactAvailable);
};

// 選んだ自分の評価を先にキャッシュへ入れ、平均値と評価数はサーバーの結果で置き換える。失敗した時は最後にサーバーが返した値へ戻す。
// 矢印キーは押すたびに値を確定するため、送信中に選び直した値は送らずに保留し、送信の後に最後に選んだ値だけを送って通知を1回にまとめる
export function useRatingMutations({
  rating,
  viewerId,
  onCancelled,
}: UseRatingMutationsOptions): RatingMutations {
  const queryClient = useQueryClient();
  const rateProduct = useMutation(
    graphqlMutationOptions(ClientRateProductDocument),
  );
  const cancelRating = useMutation(
    graphqlMutationOptions(ClientCancelProductRatingDocument),
  );
  const [pending, setPending] = useState<'rate' | 'cancel' | null>(null);
  // 同じイベントの中の続けての操作は描画の前に届くため、送信中の操作と保留した値を描画を待たずに読める値で持つ
  const inFlightRef = useRef<'rate' | 'cancel' | null>(null);
  const queuedScoreRef = useRef<number | null>(null);
  const { productId } = rating;

  const apply = (next: ProductRatingFragment) => {
    replaceProductRating(queryClient, viewerId, next);
  };

  const rateAsync = async (firstScore: number): Promise<void> => {
    let confirmed = rating;
    let score = firstScore;
    setPending('rate');
    try {
      // 取り消した取得は始めた時点の値へ戻るため、選んだ値を入れる前に止める
      await queryClient.cancelQueries({
        queryKey: productRatingQueryOptions(viewerId, productId).queryKey,
      });
      apply({ ...rating, viewerScore: queuedScoreRef.current ?? score });
      for (;;) {
        const result = (
          await rateProduct.mutateAsync({ variables: { productId, score } })
        ).rateProduct;
        confirmed = result;
        const queued = queuedScoreRef.current;
        queuedScoreRef.current = null;
        if (queued === null || queued === result.viewerScore) {
          apply(result);
          break;
        }
        apply({ ...result, viewerScore: queued });
        score = queued;
      }
    } catch (error) {
      queuedScoreRef.current = null;
      apply(confirmed);
      notify.error(ratingErrorMessageOf(error));
      return;
    } finally {
      inFlightRef.current = null;
      setPending(null);
    }
    notify.success(
      rating.viewerScore === null ? RATED_MESSAGE : RATING_CHANGED_MESSAGE,
    );
  };

  const cancelAsync = async (): Promise<void> => {
    inFlightRef.current = 'cancel';
    setPending('cancel');
    let result: ProductRatingFragment;
    try {
      result = (await cancelRating.mutateAsync({ variables: { productId } }))
        .cancelProductRating;
    } catch (error) {
      notify.error(ratingErrorMessageOf(error));
      return;
    } finally {
      inFlightRef.current = null;
      setPending(null);
    }
    apply(result);
    notify.success(RATING_CANCELLED_MESSAGE);
    onCancelled?.();
  };

  return {
    busy: pending !== null,
    cancelling: pending === 'cancel',
    rate: (score) => {
      if (inFlightRef.current === 'cancel') {
        return;
      }
      if (inFlightRef.current === 'rate') {
        queuedScoreRef.current = score;
        apply({ ...rating, viewerScore: score });
        return;
      }
      inFlightRef.current = 'rate';
      void rateAsync(score);
    },
    cancel: () => {
      if (inFlightRef.current !== null) {
        return;
      }
      void cancelAsync();
    },
  };
}
