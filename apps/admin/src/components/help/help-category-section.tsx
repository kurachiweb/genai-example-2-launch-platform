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
  adminHelpCategoriesQueryOptions,
  type HelpCategoryEntries,
  type HelpCategoryView,
  invalidateHelpCategoryQueries,
  toHelpCategories,
  toHelpCategoryEntries,
} from '../../graphql/admin-help-categories.ts';
import {
  AdminCreateHelpCategoryDocument,
  AdminDeleteHelpCategoryDocument,
  type AdminHelpCategoriesQuery,
  AdminRenameHelpCategoryDocument,
} from '../../graphql/generated/graphql.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';
import { HelpCategoryOrderEditor } from './help-category-order-editor.tsx';
import {
  HELP_CATEGORIES_TITLE,
  helpCategoryDeleteDescription,
} from './help-messages.ts';

interface HelpCategorySectionData {
  readonly entries: HelpCategoryEntries;
  readonly categories: readonly HelpCategoryView[];
}

const toSectionData = (
  data: AdminHelpCategoriesQuery,
): HelpCategorySectionData => ({
  entries: toHelpCategoryEntries(data),
  categories: toHelpCategories(data),
});

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

// カテゴリのページのヘルプ記事カテゴリの区画。一覧は管理者が指定した並び順で、その下に並べ替えを置く。名前の重複・標準カテゴリの保護・不在はAPIサーバーが拒否し、その文言をダイアログに示す
export function HelpCategorySection() {
  const queryClient = useQueryClient();
  const canEdit = hasRole(useAdminRole(), 'moderator');
  const { data } = useQuery({
    ...adminHelpCategoriesQueryOptions(),
    select: toSectionData,
    // 一覧が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の一覧を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  const onSuccess = () => invalidateHelpCategoryQueries(queryClient);
  const createCategory = useMutation({
    ...graphqlMutationOptions(AdminCreateHelpCategoryDocument),
    onSuccess,
  });
  const renameCategory = useMutation({
    ...graphqlMutationOptions(AdminRenameHelpCategoryDocument),
    onSuccess,
  });
  const deleteCategory = useMutation({
    ...graphqlMutationOptions(AdminDeleteHelpCategoryDocument),
    onSuccess,
  });

  const deleteDescriptionOf = (category: CategoryMasterItem): string =>
    helpCategoryDeleteDescription(
      data?.entries.articleCounts.get(category.id) ?? 0,
    );

  return (
    <CategoryMasterEditor
      title={HELP_CATEGORIES_TITLE}
      categories={data?.entries.items}
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
    >
      {data === undefined ? null : (
        <HelpCategoryOrderEditor
          categories={data.categories}
          readOnly={!canEdit}
        />
      )}
    </CategoryMasterEditor>
  );
}
