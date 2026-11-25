import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hasRole } from '../../../../common-lib/admin/admin-roles.ts';
import {
  CategoryMasterEditor,
  type CategoryMasterItem,
} from '../../../../lib/components/admin/category-master-editor.tsx';
import { graphqlMutationOptions } from '../../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import {
  adminReportCategoriesQueryOptions,
  invalidateReportCategoryQueries,
  toReportCategoryEntries,
} from '../../../graphql/admin-reporting-categories.ts';
import {
  AdminCreateReportCategoryDocument,
  AdminDeleteReportCategoryDocument,
  AdminRenameReportCategoryDocument,
} from '../../../graphql/generated/graphql.ts';
import { useAdminRole } from '../../layout/use-current-admin.ts';
import {
  REPORT_CATEGORIES_TITLE,
  reportCategoryDeleteDescription,
} from './report-category-messages.ts';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

// カテゴリのページの通報カテゴリの区画。名前の重複・標準カテゴリの保護・不在はAPIサーバーが拒否し、その文言をダイアログに示す
export function ReportCategorySection() {
  const queryClient = useQueryClient();
  const canEdit = hasRole(useAdminRole(), 'moderator');
  const { data } = useQuery({
    ...adminReportCategoriesQueryOptions(),
    select: toReportCategoryEntries,
    // 一覧が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の一覧を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  const onSuccess = () => invalidateReportCategoryQueries(queryClient);
  const createCategory = useMutation({
    ...graphqlMutationOptions(AdminCreateReportCategoryDocument),
    onSuccess,
  });
  const renameCategory = useMutation({
    ...graphqlMutationOptions(AdminRenameReportCategoryDocument),
    onSuccess,
  });
  const deleteCategory = useMutation({
    ...graphqlMutationOptions(AdminDeleteReportCategoryDocument),
    onSuccess,
  });

  const deleteDescriptionOf = (category: CategoryMasterItem): string =>
    reportCategoryDeleteDescription(data?.reportCounts.get(category.id) ?? 0);

  return (
    <CategoryMasterEditor
      title={REPORT_CATEGORIES_TITLE}
      categories={data?.items}
      withHandle={false}
      canEdit={canEdit}
      readOnlyDisplay="hidden"
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
