import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import {
  CategoryMasterEditor,
  type CategoryMasterItem,
} from '../../../lib/components/admin/category-master-editor.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminInquiryCategoriesQueryOptions,
  invalidateInquiryCategoryQueries,
  toAdminInquiryCategoryEntries,
} from '../../graphql/admin-inquiry-categories.ts';
import {
  AdminCreateInquiryCategoryDocument,
  AdminDeleteInquiryCategoryDocument,
  AdminRenameInquiryCategoryDocument,
} from '../../graphql/generated/graphql.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';
import {
  INQUIRY_CATEGORIES_TITLE,
  inquiryCategoryDeleteDescription,
} from './inquiry-category-messages.ts';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

// カテゴリのページの問い合わせカテゴリの区画。標準カテゴリの保護と名前の重複はAPIサーバーが拒否し、その文言をダイアログに示す
export function InquiryCategorySection() {
  const queryClient = useQueryClient();
  const canEdit = hasRole(useAdminRole(), 'moderator');
  const { data } = useQuery({
    ...adminInquiryCategoriesQueryOptions(),
    select: toAdminInquiryCategoryEntries,
    // 一覧が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の一覧を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  const onSuccess = () => invalidateInquiryCategoryQueries(queryClient);
  const createCategory = useMutation({
    ...graphqlMutationOptions(AdminCreateInquiryCategoryDocument),
    onSuccess,
  });
  const renameCategory = useMutation({
    ...graphqlMutationOptions(AdminRenameInquiryCategoryDocument),
    onSuccess,
  });
  const deleteCategory = useMutation({
    ...graphqlMutationOptions(AdminDeleteInquiryCategoryDocument),
    onSuccess,
  });

  const deleteDescriptionOf = (category: CategoryMasterItem): string =>
    inquiryCategoryDeleteDescription(data?.linkedCounts.get(category.id) ?? 0);

  return (
    <CategoryMasterEditor
      title={INQUIRY_CATEGORIES_TITLE}
      categories={data?.items}
      withHandle={false}
      canEdit={canEdit}
      onCreate={async ({ name }) => {
        await createCategory.mutateAsync({ variables: { name } });
      }}
      onUpdate={async (id, { name }) => {
        await renameCategory.mutateAsync({ variables: { id, name } });
      }}
      onDelete={async (id) => {
        await deleteCategory.mutateAsync({ variables: { id } });
      }}
      failureMessageOf={failureMessageOf}
      deleteDescriptionOf={deleteDescriptionOf}
      deleteAudited
    />
  );
}
