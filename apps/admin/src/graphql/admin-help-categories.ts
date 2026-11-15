import type { QueryClient } from '@tanstack/react-query';

import type { CategoryMasterItem } from '../../lib/components/admin/category-master-editor.tsx';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  AdminHelpArticleDocument,
  AdminHelpArticlesDocument,
  AdminHelpCategoriesDocument,
  type AdminHelpCategoriesQuery,
} from './generated/graphql.ts';

export interface HelpCategoryView {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly sortOrder: number;
  // 下書き・公開を問わない記事の件数
  readonly articleCount: number;
}

export interface HelpCategoryEntries {
  // 管理者が指定した並び順
  readonly items: readonly CategoryMasterItem[];
  // 削除の確認の文に使う、カテゴリのIDごとの付け替わる記事の件数
  readonly articleCounts: ReadonlyMap<string, number>;
}

export const adminHelpCategoriesQueryOptions = () =>
  graphqlQueryOptions(AdminHelpCategoriesDocument, {});

// APIが管理者の指定した並び順で返すため並べ直さない
export const toHelpCategories = ({
  adminHelpCategories,
}: AdminHelpCategoriesQuery): readonly HelpCategoryView[] =>
  adminHelpCategories.map(
    ({ id, name, systemDefault, sortOrder, articleCount }) => ({
      id,
      name,
      systemDefault,
      sortOrder,
      articleCount,
    }),
  );

export const toHelpCategoryEntries = ({
  adminHelpCategories,
}: AdminHelpCategoriesQuery): HelpCategoryEntries => ({
  items: adminHelpCategories.map(({ id, name, systemDefault }) => ({
    id,
    name,
    systemDefault,
  })),
  articleCounts: new Map(
    adminHelpCategories.map(({ id, articleCount }) => [id, articleCount]),
  ),
});

// カテゴリの名前の変更と削除の付け替えは記事の一覧・1件のカテゴリにも表れるため、それらの取得もまとめて無効にする
export async function invalidateHelpCategoryQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(AdminHelpCategoriesDocument),
      documentIdOf(AdminHelpArticlesDocument),
      documentIdOf(AdminHelpArticleDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}
