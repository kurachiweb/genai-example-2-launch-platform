import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { DATA_EXPORT_LIST_PAGE_SIZE } from '../../common-lib/data-export/data-export-rules.ts';
import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  invalidateMyDataExports,
  loadMyDataExports,
  myDataExportsQueryOptions,
  requestDataExportMutationOptions,
} from './data-export.ts';
import {
  ClientMyDataExportsDocument,
  type ClientMyDataExportsQuery,
  ClientRequestDataExportDocument,
  type DataExportFieldsFragment,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const OTHER_VIEWER_ID = '01JC0VIEWER0000000000000001';

const DATA_EXPORT: DataExportFieldsFragment = {
  id: '01JD0000000000000000000001',
  status: 'PENDING',
  failureKind: null,
  requestedAt: '2026-11-22T01:00:00.000Z',
  completedAt: null,
  expiresAt: null,
  failedAt: null,
  fileName: null,
  byteSize: null,
  downloadPath: null,
};

interface SentRequest {
  readonly documentId: string;
  readonly variables: unknown;
}

const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  respond: () => Promise<Response>,
  queryClient = new QueryClient(),
) => {
  const api = recordingApi(respond);
  let result: unknown;
  await runInStartRequest({
    context: renderContextOf({ api, reported: [] }),
    render: async () => {
      result = await run(queryClient);
      return htmlResponse();
    },
  });
  const sent = await Promise.all(
    api.requests.map((request) => request.json() as Promise<SentRequest>),
  );
  return { result, sent, queryClient };
};

const page = (
  nodes: readonly DataExportFieldsFragment[],
  endCursor: string | null,
  hasNextPage: boolean,
): ClientMyDataExportsQuery => ({
  myDataExports: { nodes: [...nodes], pageInfo: { endCursor, hasNextPage } },
});

const FIRST_PAGE = page([DATA_EXPORT], 'cursor-1', true);

const respondWith = (data: unknown) => () =>
  Promise.resolve(graphqlResponse({ data }));

const nextPageParamOf = (target: ClientMyDataExportsQuery) =>
  myDataExportsQueryOptions(VIEWER.id).getNextPageParam(
    target,
    [target],
    null,
    [null],
  );

describe('myDataExportsQueryOptions', () => {
  test('操作の識別子と1ページの件数で始まり、閲覧者ごとに別のキーにする', () => {
    const mine = myDataExportsQueryOptions(VIEWER.id).queryKey;

    expect([...mine]).toStrictEqual([
      ...graphqlQueryKey(ClientMyDataExportsDocument, {
        first: DATA_EXPORT_LIST_PAGE_SIZE,
      }),
      VIEWER.id,
    ]);
    expect(JSON.stringify(mine)).not.toBe(
      JSON.stringify(myDataExportsQueryOptions(OTHER_VIEWER_ID).queryKey),
    );
  });

  test('最初のページはカーソルを持たない', () => {
    expect(myDataExportsQueryOptions(VIEWER.id).initialPageParam).toBeNull();
  });

  test('続きがあれば最後のカーソルを次のページの位置にする', () => {
    expect(nextPageParamOf(FIRST_PAGE)).toBe('cursor-1');
  });

  test.each([
    ['続きが無い', page([DATA_EXPORT], 'cursor-1', false)],
    ['カーソルが無い', page([], null, true)],
  ])('%sなら次のページを持たない', (_case, target) => {
    expect(nextPageParamOf(target)).toBeUndefined();
  });

  test('最初のページも件数を明示し、続きのページは件数とカーソルを変数にして実行する', async () => {
    const { sent } = await runThroughApi(async (queryClient) => {
      const options = myDataExportsQueryOptions(VIEWER.id);
      await queryClient.infiniteQuery(options);
      return queryClient.infiniteQuery({ ...options, pages: 2 });
    }, respondWith(FIRST_PAGE));

    const documentId = documentIdOf(ClientMyDataExportsDocument);
    expect(sent).toStrictEqual([
      { documentId, variables: { first: DATA_EXPORT_LIST_PAGE_SIZE } },
      { documentId, variables: { first: DATA_EXPORT_LIST_PAGE_SIZE } },
      {
        documentId,
        variables: { first: DATA_EXPORT_LIST_PAGE_SIZE, after: 'cursor-1' },
      },
    ]);
  });
});

describe('loadMyDataExports', () => {
  test('最初のページを読み、続きは読まない', async () => {
    const { result, sent } = await runThroughApi(async (queryClient) => {
      await loadMyDataExports({ context: { queryClient, viewer: VIEWER } });
      return queryClient.getQueryData(
        myDataExportsQueryOptions(VIEWER.id).queryKey,
      );
    }, respondWith(FIRST_PAGE));

    expect(result).toStrictEqual({ pages: [FIRST_PAGE], pageParams: [null] });
    expect(sent).toHaveLength(1);
  });

  test('取得に失敗しても、区画の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadMyDataExports({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(myDataExportsQueryOptions(VIEWER.id).queryKey)
        ?.status,
    ).toBe('error');
  });
});

describe('invalidateMyDataExports', () => {
  test('一覧の操作のキャッシュだけを無効にする', async () => {
    const queryClient = new QueryClient();
    const listKey = myDataExportsQueryOptions(VIEWER.id).queryKey;
    queryClient.setQueryData(listKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(['other'], 1);

    await invalidateMyDataExports(queryClient);

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['other'])?.isInvalidated).toBe(false);
  });
});

describe('requestDataExportMutationOptions', () => {
  test('操作の識別子を変更のキーにし、変数なしで要求の操作を実行して結果を返す', async () => {
    const { result, sent } = await runThroughApi(
      async (queryClient) => {
        const options = requestDataExportMutationOptions();
        return queryClient
          .getMutationCache()
          .build(queryClient, options)
          .execute({ variables: {} });
      },
      respondWith({ requestDataExport: DATA_EXPORT }),
    );

    expect(requestDataExportMutationOptions().mutationKey).toStrictEqual([
      documentIdOf(ClientRequestDataExportDocument),
    ]);
    expect(result).toStrictEqual({ requestDataExport: DATA_EXPORT });
    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientRequestDataExportDocument),
        variables: {},
      },
    ]);
  });
});
