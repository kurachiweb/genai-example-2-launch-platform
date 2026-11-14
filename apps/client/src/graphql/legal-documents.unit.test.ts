import { describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientLegalDocumentDocument,
  type ClientLegalDocumentQuery,
  ClientLegalDocumentVersionDocument,
  type ClientLegalDocumentVersionQuery,
} from './generated/graphql.ts';
import {
  legalDocumentQueryOptions,
  legalDocumentVersionQueryOptions,
  loadLegalDocument,
  loadLegalDocumentVersion,
  toLegalDocumentView,
  toLegalVersionView,
} from './legal-documents.ts';

const PUBLISHED: ClientLegalDocumentQuery = {
  legalDocument: {
    latest: {
      versionNumber: 2,
      publishedAt: '2026-11-02T03:04:05.000Z',
      body: '# 第1条\n\n本規約は…',
    },
    revisions: [
      {
        versionNumber: 2,
        publishedAt: '2026-11-02T03:04:05.000Z',
        changeSummary: '第3条を改めました。',
      },
      {
        versionNumber: 1,
        publishedAt: '2026-10-01T00:00:00.000Z',
        changeSummary: '初版',
      },
    ],
  },
};

const PREPARING: ClientLegalDocumentQuery = {
  legalDocument: { latest: null, revisions: [] },
};

const VERSION: ClientLegalDocumentVersionQuery = {
  legalDocumentVersion: {
    publishedAt: '2026-10-01T00:00:00.000Z',
    changeSummary: '初版',
    body: '# 第1条',
    isLatest: false,
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

describe('legalDocumentQueryOptions', () => {
  test('公開ページの操作と、GraphQLの列挙型の種類の変数をキーにする', () => {
    expect([
      ...legalDocumentQueryOptions('legal-notice').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientLegalDocumentDocument, { kind: 'LEGAL_NOTICE' }),
    ]);
    expect([...legalDocumentQueryOptions('terms').queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientLegalDocumentDocument, { kind: 'TERMS' }),
    ]);
  });
});

describe('legalDocumentVersionQueryOptions', () => {
  test('過去版の操作と、種類・版番号の変数をキーにする', () => {
    expect([
      ...legalDocumentVersionQueryOptions('privacy', 3).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientLegalDocumentVersionDocument, {
        kind: 'PRIVACY',
        versionNumber: 3,
      }),
    ]);
  });
});

describe('toLegalDocumentView', () => {
  test('最新版と改訂履歴を、公開ページの部品の値に写す', () => {
    expect(toLegalDocumentView(PUBLISHED)).toStrictEqual({
      latest: {
        versionNumber: 2,
        publishedAt: '2026-11-02T03:04:05.000Z',
        body: '# 第1条\n\n本規約は…',
      },
      revisions: [
        {
          versionNumber: 2,
          publishedAt: '2026-11-02T03:04:05.000Z',
          changeSummary: '第3条を改めました。',
        },
        {
          versionNumber: 1,
          publishedAt: '2026-10-01T00:00:00.000Z',
          changeSummary: '初版',
        },
      ],
    });
  });

  test('版が無い文書は最新版をnull、改訂履歴を空にする', () => {
    expect(toLegalDocumentView(PREPARING)).toStrictEqual({
      latest: null,
      revisions: [],
    });
  });
});

describe('toLegalVersionView', () => {
  test('版の公開日時・変更概要・本文・最新版かどうかを、過去版のページの部品の値に写す', () => {
    expect(toLegalVersionView(VERSION)).toStrictEqual({
      publishedAt: '2026-10-01T00:00:00.000Z',
      changeSummary: '初版',
      body: '# 第1条',
      isLatest: false,
    });
  });

  test('存在しない版はundefinedにする', () => {
    expect(toLegalVersionView({ legalDocumentVersion: null })).toBeUndefined();
  });
});

describe('loadLegalDocument', () => {
  test('公開済みの文書は準備中でなく、正規のURLを公開ページのパスにする', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      legalDocumentQueryOptions('legal-notice').queryKey,
      PUBLISHED,
    );

    const data = await loadLegalDocument('legal-notice')({
      context: { queryClient },
    });

    expect(data).toStrictEqual({ preparing: false, canonicalUrl: '/legal' });
  });

  test('版が無い文書は準備中にする', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      legalDocumentQueryOptions('terms').queryKey,
      PREPARING,
    );

    const data = await loadLegalDocument('terms')({
      context: { queryClient },
    });

    expect(data).toStrictEqual({ preparing: true, canonicalUrl: '/terms' });
  });

  test('取得の失敗はエラーの画面にするため、そのまま投げる', async () => {
    const load = loadLegalDocument('privacy')({
      context: { queryClient: failingQueryClient(INTERNAL_ERROR) },
    });

    expect(await load.catch((error: unknown) => error)).toBe(INTERNAL_ERROR);
  });
});

describe('loadLegalDocumentVersion', () => {
  test('版番号を解析し、存在する版の版番号を返す', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      legalDocumentVersionQueryOptions('privacy', 12).queryKey,
      VERSION,
    );

    const data = await loadLegalDocumentVersion('privacy')({
      params: { versionNumber: '12' },
      context: { queryClient },
    });

    expect(data).toStrictEqual({ versionNumber: 12 });
  });

  test.each(['0', '01', '-1', '+1', '1.5', 'abc', '1234567890', ''])(
    '版番号の形式違反(%p)は取得せずに存在しないページにする',
    async (raw) => {
      const query = mock(() => Promise.resolve(VERSION));
      const queryClient = { query } as unknown as QueryClient;

      const load = loadLegalDocumentVersion('terms')({
        params: { versionNumber: raw },
        context: { queryClient },
      });

      expect(isNotFound(await load.catch((error: unknown) => error))).toBe(
        true,
      );
      expect(query).not.toHaveBeenCalled();
    },
  );

  test('存在しない版は存在しないページにする', async () => {
    const queryClient = cachedQueryClient();
    queryClient.setQueryData(
      legalDocumentVersionQueryOptions('terms', 9).queryKey,
      { legalDocumentVersion: null },
    );

    const load = loadLegalDocumentVersion('terms')({
      params: { versionNumber: '9' },
      context: { queryClient },
    });

    expect(isNotFound(await load.catch((error: unknown) => error))).toBe(true);
  });

  test('取得の失敗はエラーの画面にするため、そのまま投げる', async () => {
    const load = loadLegalDocumentVersion('legal-notice')({
      params: { versionNumber: '1' },
      context: { queryClient: failingQueryClient(INTERNAL_ERROR) },
    });

    expect(await load.catch((error: unknown) => error)).toBe(INTERNAL_ERROR);
  });
});
