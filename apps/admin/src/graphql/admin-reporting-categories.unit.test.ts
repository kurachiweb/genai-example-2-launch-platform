import { describe, expect, test } from 'bun:test';
import { QueryClient, type QueryKey } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import { auditLogsQueryOptions } from './admin-audit-logs.ts';
import {
  adminReportCaseQueryOptions,
  adminReportCasesQueryOptions,
} from './admin-reporting-cases.ts';
import {
  adminReportCategoriesQueryOptions,
  invalidateReportCategoryQueries,
  toReportCategoryEntries,
  toReportCategoryOptions,
} from './admin-reporting-categories.ts';
import {
  AdminReportCategoriesDocument,
  type AdminReportCategoriesQuery,
  AdminUnhandledReportSummaryDocument,
  AdminViewerDocument,
} from './generated/graphql.ts';

const INFRINGEMENT_ID = '01JE0000000000000000000001';
const OTHER_ID = '01JE0000000000000000000002';
const SPAM_ID = '01JE0CATEGRY00000000000001';
const CASE_ID = '01JE0CASE00000000000000001';

const CATEGORIES: AdminReportCategoriesQuery = {
  adminReportCategories: [
    {
      id: INFRINGEMENT_ID,
      name: '権利侵害',
      systemDefault: true,
      infringement: true,
      reportCount: 4,
    },
    {
      id: SPAM_ID,
      name: 'スパム',
      systemDefault: false,
      infringement: false,
      reportCount: 2,
    },
    {
      id: OTHER_ID,
      name: 'その他',
      systemDefault: true,
      infringement: false,
      reportCount: 0,
    },
  ],
};

describe('adminReportCategoriesQueryOptions', () => {
  test('変数を持たない照会のキーにする', () => {
    expect([...adminReportCategoriesQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminReportCategoriesDocument, {}),
    ]);
  });
});

describe('toReportCategoryEntries', () => {
  test('APIの順のままCategoryMasterEditorの項目にし、付け替える通報の件数をIDごとに引けるようにする', () => {
    const entries = toReportCategoryEntries(CATEGORIES);

    expect(entries.items).toStrictEqual([
      { id: INFRINGEMENT_ID, name: '権利侵害', systemDefault: true },
      { id: SPAM_ID, name: 'スパム', systemDefault: false },
      { id: OTHER_ID, name: 'その他', systemDefault: true },
    ]);
    expect(entries.reportCounts.get(SPAM_ID)).toBe(2);
    expect(entries.reportCounts.get(OTHER_ID)).toBe(0);
  });
});

describe('toReportCategoryOptions', () => {
  test('APIの順のまま絞り込みの選択肢のIDと名前にする', () => {
    expect(toReportCategoryOptions(CATEGORIES)).toStrictEqual([
      { id: INFRINGEMENT_ID, name: '権利侵害' },
      { id: SPAM_ID, name: 'スパム' },
      { id: OTHER_ID, name: 'その他' },
    ]);
  });
});

describe('invalidateReportCategoryQueries', () => {
  test('カテゴリと、内訳のカテゴリ名と件数が変わる案件の一覧・詳細と、操作を記録した監査ログの検索の取得を無効にし、他の取得は残す', async () => {
    const queryClient = new QueryClient();
    const keys: readonly QueryKey[] = [
      adminReportCategoriesQueryOptions().queryKey,
      adminReportCasesQueryOptions({ categoryId: SPAM_ID }).queryKey,
      adminReportCaseQueryOptions(CASE_ID).queryKey,
      auditLogsQueryOptions({}).queryKey,
    ];
    const otherKeys: readonly QueryKey[] = [
      graphqlQueryKey(AdminUnhandledReportSummaryDocument, {}),
      graphqlQueryKey(AdminViewerDocument, {}),
    ];
    for (const key of [...keys, ...otherKeys]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateReportCategoryQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    for (const key of otherKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });
});
