import type { QueryClient } from '@tanstack/react-query';

import type { CategoryMasterItem } from '../../lib/components/admin/category-master-editor.tsx';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import { invalidateAuditLogQueries } from './admin-audit-logs.ts';
import {
  AdminReportCaseDocument,
  AdminReportCasesDocument,
  AdminReportCategoriesDocument,
  type AdminReportCategoriesQuery,
} from './generated/graphql.ts';

export interface ReportCategoryOption {
  readonly id: string;
  readonly name: string;
}

export interface ReportCategoryEntries {
  // APIの順
  readonly items: readonly CategoryMasterItem[];
  // 削除の確認の文に使う、カテゴリのIDごとの「その他」へ付け替える通報の件数
  readonly reportCounts: ReadonlyMap<string, number>;
}

export const adminReportCategoriesQueryOptions = () =>
  graphqlQueryOptions(AdminReportCategoriesDocument, {});

export const toReportCategoryEntries = ({
  adminReportCategories,
}: AdminReportCategoriesQuery): ReportCategoryEntries => ({
  items: adminReportCategories.map(({ id, name, systemDefault }) => ({
    id,
    name,
    systemDefault,
  })),
  reportCounts: new Map(
    adminReportCategories.map(({ id, reportCount }) => [id, reportCount]),
  ),
});

export const toReportCategoryOptions = ({
  adminReportCategories,
}: AdminReportCategoriesQuery): readonly ReportCategoryOption[] =>
  adminReportCategories.map(({ id, name }) => ({ id, name }));

// カテゴリの追加・名前の変更・削除の成功の後に呼ぶ。案件の内訳はカテゴリの現在の名前を示し、削除は通報を「その他」へ付け替えて内訳の件数を変えるため、案件の一覧と詳細も無効にする。操作は監査ログに残るため、監査ログの照会も無効にする
export async function invalidateReportCategoryQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    ...[
      documentIdOf(AdminReportCategoriesDocument),
      documentIdOf(AdminReportCasesDocument),
      documentIdOf(AdminReportCaseDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
    invalidateAuditLogQueries(queryClient),
  ]);
}
