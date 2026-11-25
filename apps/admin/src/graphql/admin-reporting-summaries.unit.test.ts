import { describe, expect, test } from 'bun:test';
import { QueryClient, type QueryKey } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminReportCaseQueryOptions,
  adminReportCasesQueryOptions,
} from './admin-reporting-cases.ts';
import { adminReportCategoriesQueryOptions } from './admin-reporting-categories.ts';
import {
  adminProductReportSummaryQueryOptions,
  adminUnhandledReportSummaryQueryOptions,
  invalidateReportSummaryQueries,
  toProductReportSummary,
  toUnhandledReportSummary,
} from './admin-reporting-summaries.ts';
import {
  AdminProductReportSummaryDocument,
  AdminUnhandledReportSummaryDocument,
} from './generated/graphql.ts';

const PRODUCT_ID = '01JE0PRDCT0000000000000001';
const OTHER_PRODUCT_ID = '01JE0PRDCT0000000000000002';
const CASE_ID = '01JE0CASE00000000000000001';

describe('adminUnhandledReportSummaryQueryOptions', () => {
  test('変数を持たない照会のキーにする', () => {
    expect([
      ...adminUnhandledReportSummaryQueryOptions().queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminUnhandledReportSummaryDocument, {}),
    ]);
  });
});

describe('adminProductReportSummaryQueryOptions', () => {
  test('プロダクトのIDを変数にする', () => {
    expect([
      ...adminProductReportSummaryQueryOptions(PRODUCT_ID).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminProductReportSummaryDocument, {
        productId: PRODUCT_ID,
      }),
    ]);
  });
});

describe('toUnhandledReportSummary', () => {
  test('未対応の件数とそのうちの権利侵害の件数を写す', () => {
    expect(
      toUnhandledReportSummary({
        adminUnhandledReportSummary: { open: 5, infringementOpen: 2 },
      }),
    ).toStrictEqual({ open: 5, infringementOpen: 2 });
  });
});

describe('toProductReportSummary', () => {
  test.each([
    ['OPEN', 'open'],
    ['IN_PROGRESS', 'in_progress'],
  ] as const)(
    '累計の件数を写し、未完了の案件の状態%sを%sへ写す',
    (status, expected) => {
      expect(
        toProductReportSummary({
          adminProductReportSummary: {
            reportCount: 7,
            openCase: { id: CASE_ID, status },
          },
        }),
      ).toStrictEqual({
        reportCount: 7,
        openCase: { id: CASE_ID, status: expected },
      });
    },
  );

  test('未完了の案件が無ければnullのまま写す', () => {
    expect(
      toProductReportSummary({
        adminProductReportSummary: { reportCount: 0, openCase: null },
      }),
    ).toStrictEqual({ reportCount: 0, openCase: null });
  });
});

describe('invalidateReportSummaryQueries', () => {
  test('未対応の件数と、全てのプロダクトの件数の取得を無効にし、案件とカテゴリの取得は残す', async () => {
    const queryClient = new QueryClient();
    const keys: readonly QueryKey[] = [
      adminUnhandledReportSummaryQueryOptions().queryKey,
      adminProductReportSummaryQueryOptions(PRODUCT_ID).queryKey,
      adminProductReportSummaryQueryOptions(OTHER_PRODUCT_ID).queryKey,
    ];
    const otherKeys: readonly QueryKey[] = [
      adminReportCasesQueryOptions({}).queryKey,
      adminReportCaseQueryOptions(CASE_ID).queryKey,
      adminReportCategoriesQueryOptions().queryKey,
    ];
    for (const key of [...keys, ...otherKeys]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateReportSummaryQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    for (const key of otherKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });
});
