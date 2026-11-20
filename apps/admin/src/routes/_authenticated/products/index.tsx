import { createFileRoute } from '@tanstack/react-router';

import {
  productModerationListArgsOf,
  toProductModerationSearch,
} from '../../../components/moderation/shared/moderation-search.ts';
import { MODERATION_PAGE_COPY } from '../../../components/moderation/shared/moderation-messages.ts';
import { ProductsPage } from '../../../components/pages/products-page.tsx';
import { loadAdminModerationProductsPage } from '../../../graphql/admin-moderation-products.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/products/')({
  validateSearch: toProductModerationSearch,
  loaderDeps: ({ search }) => productModerationListArgsOf(search),
  // 同じ画面の中の条件の変更とページの移動で待つと、ルーターが前の条件の画面を保ったまま待ち、直前の一覧を残した再読み込みの表示を出せないため、取得を始めるだけにする
  loader: ({ context, deps, cause }) => {
    const loading = loadAdminModerationProductsPage({ context, deps });
    return cause === 'stay' ? undefined : loading;
  },
  head: () =>
    buildAdminPageHead({ title: MODERATION_PAGE_COPY.products.title }),
  component: ProductsPage,
});
