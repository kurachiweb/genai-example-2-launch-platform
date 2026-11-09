import type { QueryClient } from '@tanstack/react-query';

import type { CategoryMasterItem } from '../../lib/components/admin/category-master-editor.tsx';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
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

// 管理画面でプロダクトカテゴリを表すのはこの一覧だけのため、一覧の取得だけを無効にする
export async function invalidateProductCategoryQueries(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [documentIdOf(AdminProductCategoriesDocument)],
  });
}

const INPUT_FIELD_PREFIX = 'input.';

// APIは名前・ハンドルの違反と重複を入力の引数の下の欄(input.name)で返すが、カテゴリの編集部品の入力欄は引数を挟まない名前(name)のため、欄の詳細を入力欄の名前へ写して欄に理由を示させる
export const toCategoryFormError = (error: unknown): unknown => {
  if (!(error instanceof GraphQLClientError) || error.details === undefined) {
    return error;
  }
  return new GraphQLClientError(
    {
      code: error.code,
      message: error.message,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
      details: error.details.map((detail) =>
        detail.field.startsWith(INPUT_FIELD_PREFIX)
          ? { ...detail, field: detail.field.slice(INPUT_FIELD_PREFIX.length) }
          : detail,
      ),
    },
    { cause: error },
  );
};
