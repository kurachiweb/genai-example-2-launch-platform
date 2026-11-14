import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode, RefObject } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  invalidateMyProductQueries,
  type MyProductCardView,
  myProductsQueryOptions,
  toMyProductCards,
} from '../../graphql/my-products.ts';
import { useFollowListFocus } from '../profile/use-follow-list-focus.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import { MyProductCard } from './my-product-card.tsx';
import { MyProductCardSkeletons } from './my-product-card-skeletons.tsx';
import {
  MY_PRODUCTS_EMPTY_DESCRIPTION,
  MY_PRODUCTS_EMPTY_TITLE,
  MY_PRODUCTS_LOAD_MORE_LABEL,
  MY_PRODUCTS_LOAD_MORE_PENDING_LABEL,
} from './my-product-messages.ts';
import { MyProductSectionSlots } from './my-product-section-slots.tsx';
import type { MyProductSection } from './product-section-types.ts';

export interface MyProductListProps {
  readonly viewerId: string;
  // orderの順に並べ替え済みの登録
  readonly sections: readonly MyProductSection[];
  readonly editable: boolean;
  // 一覧の名前にするページの見出し
  readonly labelledBy: string;
  // 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないための移り先
  readonly retryFocusRef: RefObject<HTMLElement | null>;
  // 0件の表示に添える登録の導線
  readonly newProductAction: ReactNode;
}

// キックオフ(ローンチ日の0:00)を迎えると直近のローンチがマッチ中に変わるため、予定・ペアリング済みのローンチのキックオフを境界にする
const kickoffBoundariesOf = (
  products: readonly MyProductCardView[],
): readonly string[] =>
  products.flatMap(({ latestLaunch }) =>
    latestLaunch !== null &&
    (latestLaunch.status === 'scheduled' || latestLaunch.status === 'paired')
      ? [latestLaunch.kickoffAt]
      : [],
  );

// 自分のプロダクトを直近のローンチ日が新しい順に20件ずつ示し、「さらに読み込む」で続きを後ろに加える
export function MyProductList({
  viewerId,
  sections,
  editable,
  labelledBy,
  retryFocusRef,
  newProductAction,
}: MyProductListProps) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    ...myProductsQueryOptions(viewerId),
    select: toMyProductCards,
  });
  const products = query.data;
  useBoundaryRefresh(kickoffBoundariesOf(products ?? []), () => {
    void invalidateMyProductQueries(queryClient);
  });
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const loadError =
    products === undefined && !query.isFetching ? query.error : null;
  const loadingMore = query.isFetchingNextPage;
  const loadMoreError =
    query.isFetchNextPageError && !loadingMore ? query.error : null;
  const { listRef, loadMoreRef, rememberCount } = useFollowListFocus({
    entryCount: products?.length,
    loadingMore,
    loadMoreFailed: query.isFetchNextPageError,
  });

  if (loadError !== null) {
    return (
      <PartialErrorState
        message={errorMessageOf(loadError, CLIENT_PROFILE.contactAvailable)}
        onRetry={() => {
          retryFocusRef.current?.focus();
          void query.refetch();
        }}
      />
    );
  }
  if (products === undefined) {
    return (
      <LoadingSkeleton>
        <MyProductCardSkeletons />
      </LoadingSkeleton>
    );
  }
  if (products.length === 0) {
    return (
      <EmptyState
        title={MY_PRODUCTS_EMPTY_TITLE}
        description={MY_PRODUCTS_EMPTY_DESCRIPTION}
        action={newProductAction}
      />
    );
  }

  const loadMore = () => {
    if (loadingMore) {
      return;
    }
    rememberCount(products.length);
    void query.fetchNextPage();
  };

  return (
    <div className="flex flex-col gap-4">
      <ul
        ref={listRef}
        aria-labelledby={labelledBy}
        className="flex flex-col gap-4"
      >
        {products.map((product) => (
          // 続きを読み込んだ後に、加えた最初のカードへフォーカスを移せるよう、プログラムからだけフォーカスできるようにする
          <li
            key={product.handle}
            tabIndex={-1}
            className="flex flex-col gap-3 rounded-xl"
          >
            <MyProductCard product={product} editable={editable} />
            <MyProductSectionSlots
              sections={sections}
              product={{
                productHandle: product.handle,
                productName: product.name,
                hidden: product.hidden,
                placement: 'list',
              }}
            />
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreError === null ? null : (
            <FormMessage role="alert">
              {errorMessageOf(loadMoreError, CLIENT_PROFILE.contactAvailable)}
            </FormMessage>
          )}
          <Button
            ref={loadMoreRef}
            type="button"
            variant="outline"
            aria-disabled={loadingMore || undefined}
            aria-busy={loadingMore || undefined}
            onClick={loadMore}
          >
            {loadingMore
              ? MY_PRODUCTS_LOAD_MORE_PENDING_LABEL
              : MY_PRODUCTS_LOAD_MORE_LABEL}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
