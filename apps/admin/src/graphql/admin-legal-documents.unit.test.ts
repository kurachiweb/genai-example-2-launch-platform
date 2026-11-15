import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  adminLegalDocumentQueryOptions,
  adminLegalDocumentsQueryOptions,
  adminLegalDocumentVersionQueryOptions,
  loadAdminLegalDocument,
  loadAdminLegalDocuments,
  loadAdminLegalDocumentVersion,
  toAdminLegalDocument,
  toAdminLegalVersion,
  toGraphQLLegalDocumentKind,
  toLegalDocumentSummaries,
} from './admin-legal-documents.ts';
import {
  AdminLegalDocumentDocument,
  type AdminLegalDocumentQuery,
  AdminLegalDocumentsDocument,
  type AdminLegalDocumentsQuery,
  AdminLegalDocumentVersionDocument,
  type AdminLegalDocumentVersionQuery,
} from './generated/graphql.ts';

const SUPER_ADMIN = {
  id: '01JC0ADMIN000000000000000002',
  nickname: '統括の担当',
};

const DELETED_ADMIN = { id: '01JC0ADMIN0000000000000000DD', nickname: null };

const SUMMARIES: AdminLegalDocumentsQuery = {
  adminLegalDocuments: [
    {
      kind: 'TERMS',
      latestVersionNumber: 3,
      latestPublishedAt: '2026-11-02T03:04:05.000Z',
      hasDraft: true,
    },
    {
      kind: 'PRIVACY',
      latestVersionNumber: null,
      latestPublishedAt: null,
      hasDraft: false,
    },
    {
      kind: 'LEGAL_NOTICE',
      latestVersionNumber: 1,
      latestPublishedAt: '2026-10-01T00:00:00.000Z',
      hasDraft: false,
    },
  ],
};

const DOCUMENT: AdminLegalDocumentQuery = {
  adminLegalDocument: {
    kind: 'PRIVACY',
    stateVersion: 7,
    latestBody: '# 第1条',
    draft: {
      body: '# 第1条(改)',
      savedAt: '2026-11-03T09:00:00.000Z',
      savedBy: DELETED_ADMIN,
    },
    revisions: [
      {
        versionNumber: 2,
        publishedAt: '2026-11-02T03:04:05.000Z',
        changeSummary: '第3条を改めました。',
        publishedBy: SUPER_ADMIN,
      },
      {
        versionNumber: 1,
        publishedAt: '2026-10-01T00:00:00.000Z',
        changeSummary: '初版',
        publishedBy: DELETED_ADMIN,
      },
    ],
  },
};

const UNPUBLISHED_DOCUMENT: AdminLegalDocumentQuery = {
  adminLegalDocument: {
    kind: 'LEGAL_NOTICE',
    stateVersion: 0,
    latestBody: null,
    draft: null,
    revisions: [],
  },
};

const VERSION: AdminLegalDocumentVersionQuery = {
  adminLegalDocumentVersion: {
    kind: 'TERMS',
    versionNumber: 2,
    publishedAt: '2026-11-02T03:04:05.000Z',
    changeSummary: '第3条を改めました。',
    body: '# 第1条',
    isLatest: false,
    publishedBy: SUPER_ADMIN,
  },
};

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const cachedQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });

const failingQueryClient = (error: Error) =>
  ({ query: () => Promise.reject(error) }) as unknown as QueryClient;

const unusedQueryClient = () =>
  ({
    query: () => Promise.reject(new Error('取得してはならない')),
  }) as unknown as QueryClient;

const notFoundOf = async (promise: Promise<unknown>): Promise<boolean> => {
  try {
    await promise;
    return false;
  } catch (error) {
    return isNotFound(error);
  }
};

describe('toGraphQLLegalDocumentKind', () => {
  test('種類をGraphQLの列挙型の値に写す', () => {
    expect(toGraphQLLegalDocumentKind('terms')).toBe('TERMS');
    expect(toGraphQLLegalDocumentKind('privacy')).toBe('PRIVACY');
    expect(toGraphQLLegalDocumentKind('legal-notice')).toBe('LEGAL_NOTICE');
  });
});

describe('取得の設定', () => {
  test('一覧は変数の無い一覧の操作をキーにする', () => {
    expect([...adminLegalDocumentsQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminLegalDocumentsDocument, {}),
    ]);
  });

  test('編集の対象は、GraphQLの列挙型の種類の変数をキーにする', () => {
    expect([
      ...adminLegalDocumentQueryOptions('legal-notice').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminLegalDocumentDocument, { kind: 'LEGAL_NOTICE' }),
    ]);
  });

  test('版は、種類と版番号の変数をキーにする', () => {
    expect([
      ...adminLegalDocumentVersionQueryOptions('privacy', 3).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminLegalDocumentVersionDocument, {
        kind: 'PRIVACY',
        versionNumber: 3,
      }),
    ]);
  });
});

describe('toLegalDocumentSummaries', () => {
  test('一覧の各行の種類・最新版の版番号と公開日時・下書きの有無を、APIの順のまま写す', () => {
    expect(toLegalDocumentSummaries(SUMMARIES)).toStrictEqual([
      {
        kind: 'terms',
        latestVersionNumber: 3,
        latestPublishedAt: '2026-11-02T03:04:05.000Z',
        hasDraft: true,
      },
      {
        kind: 'privacy',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: false,
      },
      {
        kind: 'legal-notice',
        latestVersionNumber: 1,
        latestPublishedAt: '2026-10-01T00:00:00.000Z',
        hasDraft: false,
      },
    ]);
  });
});

describe('toAdminLegalDocument', () => {
  test('状態の版・最新版の本文・下書き・改訂履歴と、保存者・公開者(削除済みはニックネームがnull)を写す', () => {
    expect(toAdminLegalDocument(DOCUMENT.adminLegalDocument)).toStrictEqual({
      kind: 'privacy',
      stateVersion: 7,
      latestBody: '# 第1条',
      draft: {
        body: '# 第1条(改)',
        savedAt: '2026-11-03T09:00:00.000Z',
        savedBy: { id: DELETED_ADMIN.id, nickname: null },
      },
      revisions: [
        {
          versionNumber: 2,
          publishedAt: '2026-11-02T03:04:05.000Z',
          changeSummary: '第3条を改めました。',
          publishedBy: { id: SUPER_ADMIN.id, nickname: '統括の担当' },
        },
        {
          versionNumber: 1,
          publishedAt: '2026-10-01T00:00:00.000Z',
          changeSummary: '初版',
          publishedBy: { id: DELETED_ADMIN.id, nickname: null },
        },
      ],
    });
  });

  test('未公開で下書きの無い文書は、最新版の本文と下書きをnull、改訂履歴を空にする', () => {
    expect(
      toAdminLegalDocument(UNPUBLISHED_DOCUMENT.adminLegalDocument),
    ).toStrictEqual({
      kind: 'legal-notice',
      stateVersion: 0,
      latestBody: null,
      draft: null,
      revisions: [],
    });
  });
});

describe('toAdminLegalVersion', () => {
  test('版の番号・公開日時・変更概要・本文・最新版かどうか・公開者を写す', () => {
    expect(toAdminLegalVersion(VERSION)).toStrictEqual({
      kind: 'terms',
      versionNumber: 2,
      publishedAt: '2026-11-02T03:04:05.000Z',
      changeSummary: '第3条を改めました。',
      body: '# 第1条',
      isLatest: false,
      publishedBy: { id: SUPER_ADMIN.id, nickname: '統括の担当' },
    });
  });

  test('存在しない版はundefinedにする', () => {
    expect(
      toAdminLegalVersion({ adminLegalDocumentVersion: null }),
    ).toBeUndefined();
  });
});

describe('loadAdminLegalDocuments', () => {
  test('一覧を取得してキャッシュに入れる', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      adminLegalDocumentsQueryOptions().queryKey,
      SUMMARIES,
    );

    await loadAdminLegalDocuments({ context: { queryClient } });

    expect(
      queryClient.getQueryData(adminLegalDocumentsQueryOptions().queryKey),
    ).toBe(SUMMARIES);
  });

  test('取得の失敗は投げず、一覧の場所に示すためにキャッシュへ残す', async () => {
    const load = loadAdminLegalDocuments({
      context: { queryClient: failingQueryClient(INTERNAL_ERROR) },
    });

    expect(await load.then(() => 'resolved')).toBe('resolved');
  });
});

describe('loadAdminLegalDocument', () => {
  test('種類を解析して取得し、loaderのデータに種類を返す', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      adminLegalDocumentQueryOptions('legal-notice').queryKey,
      UNPUBLISHED_DOCUMENT,
    );

    expect(
      await loadAdminLegalDocument({
        params: { kind: 'legal-notice' },
        context: { queryClient },
      }),
    ).toStrictEqual({ kind: 'legal-notice' });
  });

  test.each(['legal', 'TERMS', 'terms ', '', 'unknown'])(
    '種類の形式違反(%p)は取得せずに存在しないページにする',
    async (kind) => {
      expect(
        await notFoundOf(
          loadAdminLegalDocument({
            params: { kind },
            context: { queryClient: unusedQueryClient() },
          }),
        ),
      ).toBe(true);
    },
  );

  test('取得の失敗はそのまま投げ、ルートのエラーの画面に任せる', async () => {
    const load = loadAdminLegalDocument({
      params: { kind: 'terms' },
      context: { queryClient: failingQueryClient(INTERNAL_ERROR) },
    });

    expect(await load.catch((error: unknown) => error)).toBe(INTERNAL_ERROR);
  });
});

describe('loadAdminLegalDocumentVersion', () => {
  test('種類と版番号を解析して取得し、loaderのデータに種類と版番号を返す', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      adminLegalDocumentVersionQueryOptions('terms', 2).queryKey,
      VERSION,
    );

    expect(
      await loadAdminLegalDocumentVersion({
        params: { kind: 'terms', versionNumber: '2' },
        context: { queryClient },
      }),
    ).toStrictEqual({ kind: 'terms', versionNumber: 2 });
  });

  test.each([
    ['privacy-policy', '1'],
    ['terms', '0'],
    ['terms', '01'],
    ['terms', '-1'],
    ['terms', '1.5'],
    ['terms', 'abc'],
    ['terms', '1000000000'],
  ])(
    '種類・版番号の形式違反(%p・%p)は取得せずに存在しないページにする',
    async (kind, versionNumber) => {
      expect(
        await notFoundOf(
          loadAdminLegalDocumentVersion({
            params: { kind, versionNumber },
            context: { queryClient: unusedQueryClient() },
          }),
        ),
      ).toBe(true);
    },
  );

  test('存在しない版は存在しないページにする', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      adminLegalDocumentVersionQueryOptions('privacy', 9).queryKey,
      { adminLegalDocumentVersion: null },
    );

    expect(
      await notFoundOf(
        loadAdminLegalDocumentVersion({
          params: { kind: 'privacy', versionNumber: '9' },
          context: { queryClient },
        }),
      ),
    ).toBe(true);
  });

  test('取得の失敗はそのまま投げ、ルートのエラーの画面に任せる', async () => {
    const load = loadAdminLegalDocumentVersion({
      params: { kind: 'terms', versionNumber: '1' },
      context: { queryClient: failingQueryClient(INTERNAL_ERROR) },
    });

    expect(await load.catch((error: unknown) => error)).toBe(INTERNAL_ERROR);
  });
});
