import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  EMPTY_CURSOR_TRAIL,
  previousPageOf,
  trailAfterNext,
} from '../../../lib/utilities/pagination/cursor-trail.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminModerationCategoryOptionsQueryOptions,
  adminModerationProductsQueryOptions,
  toAdminModerationProductPage,
  toModerationCategoryOptions,
} from '../../graphql/admin-moderation-products.ts';
import { ProductFilters } from '../moderation/products/product-filters.tsx';
import { ProductTable } from '../moderation/products/product-table.tsx';
import { MODERATION_PAGE_COPY } from '../moderation/shared/moderation-messages.ts';
import {
  type ProductModerationSearch,
  productModerationFilterScopeOf,
  productModerationListArgsOf,
  productModerationSearchAt,
} from '../moderation/shared/moderation-search.ts';

const routeApi = getRouteApi('/_authenticated/products/');

const failureOf = (error: unknown, onRetry: () => void) => ({
  message: errorMessageOf(error, ADMIN_PROFILE.contactAvailable),
  onRetry,
});

export function ProductsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const products = useQuery({
    ...adminModerationProductsQueryOptions(productModerationListArgsOf(search)),
    select: toAdminModerationProductPage,
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    ...adminModerationCategoryOptionsQueryOptions(),
    select: toModerationCategoryOptions,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const scope = productModerationFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const nextCursor = products.data?.nextCursor ?? null;
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得の失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = products.isFetching ? null : products.error;
  const categoriesFailure = categories.isFetching ? null : categories.error;
  const show = (next: ProductModerationSearch) => {
    void navigate({ search: next });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={MODERATION_PAGE_COPY.products.title}
        description={MODERATION_PAGE_COPY.products.description}
      />
      <ProductFilters
        search={search}
        categories={categories.data}
        {...(categoriesFailure === null
          ? {}
          : {
              categoriesError: failureOf(categoriesFailure, () => {
                void categories.refetch();
              }),
            })}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <ProductTable
        rows={products.data?.items}
        {...(failure === null
          ? {}
          : {
              error: failureOf(failure, () => {
                void products.refetch();
              }),
            })}
        refetching={products.isPlaceholderData}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(productModerationSearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(productModerationSearchAt(search, nextCursor));
          },
        }}
      />
    </div>
  );
}
