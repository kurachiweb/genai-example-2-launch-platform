import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import { CategoryMasterEditor } from '../../../lib/components/admin/category-master-editor.tsx';
import type { CategoryFormValues } from '../../../lib/components/admin/category-form-dialog.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminProductCategoriesQueryOptions,
  invalidateProductCategoryQueries,
  toAdminProductCategoryItems,
} from '../../graphql/admin-product-categories.ts';
import {
  AdminCreateProductCategoryDocument,
  AdminDeleteProductCategoryDocument,
  AdminUpdateProductCategoryDocument,
  type ProductCategoryInput,
} from '../../graphql/generated/graphql.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';
import {
  PRODUCT_CATEGORIES_TITLE,
  PRODUCT_CATEGORY_DELETE_DESCRIPTION,
  validateProductCategoryHandle,
} from './product-category-messages.ts';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

const deleteDescriptionOf = (): string => PRODUCT_CATEGORY_DELETE_DESCRIPTION;

// ハンドルの欄の検証が未入力を拒否するため、送る時点でハンドルは常にある
const toInput = ({
  name,
  handle,
}: CategoryFormValues): ProductCategoryInput => ({
  name,
  handle: handle ?? '',
});

// カテゴリのページのプロダクトカテゴリの区画。標準カテゴリの保護・名前とハンドルの重複・紐付くプロダクトのある削除はAPIサーバーが拒否し、その文言をダイアログに示す。
// カテゴリの編集部品に理由の入力欄が無いため、理由は送らない
export function ProductCategorySection() {
  const queryClient = useQueryClient();
  const canEdit = hasRole(useAdminRole(), 'moderator');
  const { data } = useQuery({
    ...adminProductCategoriesQueryOptions(),
    select: toAdminProductCategoryItems,
    // 一覧が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の一覧を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  const onSuccess = () => invalidateProductCategoryQueries(queryClient);
  const createCategory = useMutation({
    ...graphqlMutationOptions(AdminCreateProductCategoryDocument),
    onSuccess,
  });
  const updateCategory = useMutation({
    ...graphqlMutationOptions(AdminUpdateProductCategoryDocument),
    onSuccess,
  });
  const deleteCategory = useMutation({
    ...graphqlMutationOptions(AdminDeleteProductCategoryDocument),
    onSuccess,
  });

  return (
    <CategoryMasterEditor
      title={PRODUCT_CATEGORIES_TITLE}
      categories={data}
      withHandle
      canEdit={canEdit}
      validateHandle={validateProductCategoryHandle}
      onCreate={async (values) => {
        await createCategory.mutateAsync({
          variables: { input: toInput(values) },
        });
      }}
      onUpdate={async (id, values) => {
        await updateCategory.mutateAsync({
          variables: { id, input: toInput(values) },
        });
      }}
      onDelete={async (id) => {
        await deleteCategory.mutateAsync({ variables: { id } });
      }}
      failureMessageOf={failureMessageOf}
      serverFieldPrefix="input"
      deleteDescriptionOf={deleteDescriptionOf}
      deleteAudited
    />
  );
}
