import type { QueryClient } from '@tanstack/react-query';

import type { CategoryMasterItem } from '../../lib/components/admin/category-master-editor.tsx';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  AdminInquiriesDocument,
  AdminInquiryCategoriesDocument,
  type AdminInquiryCategoriesQuery,
  AdminInquiryCategoryOptionsDocument,
  AdminInquiryDocument,
} from './generated/graphql.ts';

export interface AdminInquiryCategoryEntries {
  // APIの順(作成の順で、標準カテゴリが末尾)
  readonly items: readonly CategoryMasterItem[];
  // 削除の確認の文に使う、カテゴリのIDごとの紐付く問い合わせの件数
  readonly linkedCounts: ReadonlyMap<string, number>;
}

export const adminInquiryCategoriesQueryOptions = () =>
  graphqlQueryOptions(AdminInquiryCategoriesDocument, {});

export const toAdminInquiryCategoryEntries = ({
  adminInquiryCategories,
}: AdminInquiryCategoriesQuery): AdminInquiryCategoryEntries => ({
  items: adminInquiryCategories.map(({ id, name, systemDefault }) => ({
    id,
    name,
    systemDefault,
  })),
  linkedCounts: new Map(
    adminInquiryCategories.map(({ id, linkedCount }) => [id, linkedCount]),
  ),
});

// カテゴリの名前と問い合わせの紐付けは、問い合わせの一覧・詳細と絞り込みの選択肢にも表れるため、それらの取得もまとめて無効にする。表示していない取得は古いものとだけされ、次に表示した時に取得し直される
export async function invalidateInquiryCategoryQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(AdminInquiryCategoriesDocument),
      documentIdOf(AdminInquiryCategoryOptionsDocument),
      documentIdOf(AdminInquiriesDocument),
      documentIdOf(AdminInquiryDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}
