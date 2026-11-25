import type { QueryClient } from '@tanstack/react-query';

import type { CategoryMasterItem } from '../../lib/components/admin/category-master-editor.tsx';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import { invalidateAuditLogQueries } from './admin-audit-logs.ts';
import {
  AdminProductCategoriesDocument,
  type AdminProductCategoriesQuery,
} from './generated/graphql.ts';

export const adminProductCategoriesQueryOptions = () =>
  graphqlQueryOptions(AdminProductCategoriesDocument, {});

// APIの順(追加の順で、標準カテゴリが末尾)のまま並べる
export const toAdminProductCategoryItems = ({
  adminProductCategories,
}: AdminProductCategoriesQuery): readonly CategoryMasterItem[] =>
  adminProductCategories.map(({ id, name, handle, systemDefault }) => ({
    id,
    name,
    handle,
    systemDefault,
  }));

// カテゴリの追加・編集・削除の成功の後に呼ぶ。管理画面でプロダクトカテゴリを表すのはこの一覧だけのため、一覧の取得を無効にし、操作は監査ログに残るため監査ログの照会も無効にする
export async function invalidateProductCategoryQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: [documentIdOf(AdminProductCategoriesDocument)],
    }),
    invalidateAuditLogQueries(queryClient),
  ]);
}
