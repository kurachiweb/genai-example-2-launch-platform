import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminInquiryCategoriesQueryOptions,
  invalidateInquiryCategoryQueries,
  toAdminInquiryCategoryEntries,
} from './admin-inquiry-categories.ts';
import {
  AdminInquiriesDocument,
  AdminInquiryCategoriesDocument,
  AdminInquiryCategoryOptionsDocument,
  AdminInquiryDocument,
  AdminViewerDocument,
} from './generated/graphql.ts';

const BUG_ID = '01JC0CATEGRY0000000000000A';
const OTHER_ID = '01JC0000000000000000000000';

describe('toAdminInquiryCategoryEntries', () => {
  test('APIの順のままCategoryMasterEditorの項目にし、紐付く件数をIDごとに引けるようにする', () => {
    const entries = toAdminInquiryCategoryEntries({
      adminInquiryCategories: [
        {
          id: BUG_ID,
          name: '不具合の報告',
          systemDefault: false,
          linkedCount: 3,
        },
        { id: OTHER_ID, name: 'その他', systemDefault: true, linkedCount: 0 },
      ],
    });

    expect(entries.items).toStrictEqual([
      { id: BUG_ID, name: '不具合の報告', systemDefault: false },
      { id: OTHER_ID, name: 'その他', systemDefault: true },
    ]);
    expect(entries.linkedCounts.get(BUG_ID)).toBe(3);
    expect(entries.linkedCounts.get(OTHER_ID)).toBe(0);
  });
});

describe('invalidateInquiryCategoryQueries', () => {
  test('カテゴリの一覧・選択肢と問い合わせの一覧・詳細の取得を無効にし、他の取得は残す', async () => {
    const queryClient = new QueryClient();
    const keys = [
      adminInquiryCategoriesQueryOptions().queryKey,
      [documentIdOf(AdminInquiryCategoryOptionsDocument), {}],
      [documentIdOf(AdminInquiriesDocument), { filter: {} }],
      [documentIdOf(AdminInquiryDocument), { id: BUG_ID }],
    ];
    const viewerKey = [documentIdOf(AdminViewerDocument), {}];
    for (const key of [...keys, viewerKey]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateInquiryCategoryQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(viewerKey)?.isInvalidated).toBe(false);
    expect(adminInquiryCategoriesQueryOptions().queryKey[0]).toBe(
      documentIdOf(AdminInquiryCategoriesDocument),
    );
  });
});
