import { describe, expect, test } from 'bun:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

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
  type ApiKeyFieldsFragment,
  ClientDeleteApiKeyDocument,
  ClientIssueApiKeyDocument,
  ClientMyApiKeysDocument,
  type ClientMyApiKeysQuery,
  ClientReissueApiKeyDocument,
  ClientUpdateApiKeyDocument,
} from './generated/graphql.ts';
import {
  deleteApiKeyMutationOptions,
  invalidateMyApiKeys,
  issueApiKeyMutationOptions,
  loadMyApiKeys,
  MY_API_KEYS_PAGE_SIZE,
  myApiKeysQueryOptions,
  reissueApiKeyMutationOptions,
  toApiKeyScopes,
  toApiKeyScopesInput,
  updateApiKeyMutationOptions,
} from './public-api.ts';
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

const API_KEY_ID = '01JD0000000000000000000001';

const PLAIN_KEY = `lsk_${'A'.repeat(43)}`;

const API_KEY: ApiKeyFieldsFragment = {
  id: API_KEY_ID,
  name: '集計スクリプト',
  scopes: {
    products: 'READ',
    launches: 'READ',
    upvotes: 'READ',
    comments: 'READ',
    ratings: 'READ',
    profile: 'NONE',
    productDescriptions: 'NONE',
  },
  createdAt: '2026-09-15T07:40:00.000Z',
};

const API_KEY_INPUT = Object.freeze({
  name: API_KEY.name,
  scopes: API_KEY.scopes,
});

interface SentRequest {
  readonly documentId: string;
  readonly variables: unknown;
}

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で実行し、APIへ送った識別子と変数を読み取る
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

const respondWith = (data: unknown) => () =>
  Promise.resolve(graphqlResponse({ data }));

const myApiKeysPage = (
  nodes: readonly ApiKeyFieldsFragment[],
  endCursor: string | null,
  hasNextPage: boolean,
): ClientMyApiKeysQuery => ({
  myApiKeys: { nodes: [...nodes], pageInfo: { endCursor, hasNextPage } },
});

const FIRST_PAGE = myApiKeysPage([API_KEY], 'cursor-1', true);

const nextPageParamOf = (page: ClientMyApiKeysQuery) =>
  myApiKeysQueryOptions(VIEWER.id).getNextPageParam(page, [page], null, [null]);

// 変更の記録はgcTimeの経過後のタイマーで消えるため、そのタイマーが動くまで待つ
const waitForGarbageCollection = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

describe('権限の値とGraphQLの列挙型の対応', () => {
  test('フォームの値の小文字の権限を、GraphQLの入力の大文字の列挙型にする', () => {
    expect(
      toApiKeyScopesInput({
        products: 'read',
        launches: 'none',
        upvotes: 'read',
        comments: 'none',
        ratings: 'read',
        profile: 'read_write',
        productDescriptions: 'read',
      }),
    ).toStrictEqual({
      products: 'READ',
      launches: 'NONE',
      upvotes: 'READ',
      comments: 'NONE',
      ratings: 'READ',
      profile: 'READ_WRITE',
      productDescriptions: 'READ',
    });
  });

  test('GraphQLの応答の大文字の列挙型を、表示名を引く共用部品の小文字の権限にする', () => {
    expect(
      toApiKeyScopes({
        products: 'NONE',
        launches: 'READ',
        upvotes: 'NONE',
        comments: 'READ',
        ratings: 'NONE',
        profile: 'NONE',
        productDescriptions: 'READ_WRITE',
      }),
    ).toStrictEqual({
      products: 'none',
      launches: 'read',
      upvotes: 'none',
      comments: 'read',
      ratings: 'none',
      profile: 'none',
      productDescriptions: 'read_write',
    });
  });

  test('相互に写すと元の値に戻る', () => {
    const scopes = {
      products: 'READ',
      launches: 'READ',
      upvotes: 'READ',
      comments: 'READ',
      ratings: 'READ',
      profile: 'READ',
      productDescriptions: 'NONE',
    } as const;

    expect(toApiKeyScopesInput(toApiKeyScopes(scopes))).toStrictEqual(scopes);
  });
});

describe('myApiKeysQueryOptions', () => {
  test('操作の識別子と1ページの件数で始まり、閲覧者ごとに別のキーにする', () => {
    const mine = myApiKeysQueryOptions(VIEWER.id).queryKey;

    expect([...mine]).toStrictEqual([
      ...graphqlQueryKey(ClientMyApiKeysDocument, {
        first: MY_API_KEYS_PAGE_SIZE,
      }),
      VIEWER.id,
    ]);
    expect(JSON.stringify(mine)).not.toBe(
      JSON.stringify(myApiKeysQueryOptions(OTHER_VIEWER_ID).queryKey),
    );
  });

  test('1ページは50件で、最初のページはカーソルを持たない', () => {
    expect(MY_API_KEYS_PAGE_SIZE).toBe(50);
    expect(myApiKeysQueryOptions(VIEWER.id).initialPageParam).toBeNull();
  });

  test('続きがあれば最後のキーのカーソルを次のページの位置にする', () => {
    expect(nextPageParamOf(FIRST_PAGE)).toBe('cursor-1');
  });

  test.each([
    ['続きが無い', myApiKeysPage([API_KEY], 'cursor-1', false)],
    ['カーソルが無い', myApiKeysPage([], null, true)],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextPageParamOf(page)).toBeUndefined();
  });

  test('件数の引数は必須のため最初のページも件数を明示し、続きのページは件数とカーソルを変数にして実行する', async () => {
    const { sent } = await runThroughApi(async (queryClient) => {
      const options = myApiKeysQueryOptions(VIEWER.id);
      await queryClient.infiniteQuery(options);
      return queryClient.infiniteQuery({ ...options, pages: 2 });
    }, respondWith(FIRST_PAGE));

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientMyApiKeysDocument),
        variables: { first: 50 },
      },
      {
        documentId: documentIdOf(ClientMyApiKeysDocument),
        variables: { first: 50 },
      },
      {
        documentId: documentIdOf(ClientMyApiKeysDocument),
        variables: { first: 50, after: 'cursor-1' },
      },
    ]);
  });
});

describe('loadMyApiKeys', () => {
  test('最初のページを読み、続きは読まない', async () => {
    const { result, sent } = await runThroughApi(async (queryClient) => {
      await loadMyApiKeys({ context: { queryClient, viewer: VIEWER } });
      return queryClient.getQueryData(
        myApiKeysQueryOptions(VIEWER.id).queryKey,
      );
    }, respondWith(FIRST_PAGE));

    expect(result).toStrictEqual({ pages: [FIRST_PAGE], pageParams: [null] });
    expect(sent).toHaveLength(1);
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadMyApiKeys({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(myApiKeysQueryOptions(VIEWER.id).queryKey)
        ?.status,
    ).toBe('error');
  });
});

describe('invalidateMyApiKeys', () => {
  test('閲覧者によらず一覧の取得を全て無効にし、他の取得は残す', async () => {
    const queryClient = new QueryClient();
    const mine = myApiKeysQueryOptions(VIEWER.id).queryKey;
    const others = myApiKeysQueryOptions(OTHER_VIEWER_ID).queryKey;
    const unrelated = ['other-document', {}];
    for (const key of [mine, others, unrelated]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateMyApiKeys(queryClient);

    expect(queryClient.getQueryState(mine)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(others)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });
});

describe('APIキーの変更の設定', () => {
  test.each([
    [
      '発行',
      issueApiKeyMutationOptions().mutationKey,
      documentIdOf(ClientIssueApiKeyDocument),
    ],
    [
      '編集',
      updateApiKeyMutationOptions().mutationKey,
      documentIdOf(ClientUpdateApiKeyDocument),
    ],
    [
      '再発行',
      reissueApiKeyMutationOptions().mutationKey,
      documentIdOf(ClientReissueApiKeyDocument),
    ],
    [
      '削除',
      deleteApiKeyMutationOptions().mutationKey,
      documentIdOf(ClientDeleteApiKeyDocument),
    ],
  ] as const)(
    '%sの変更のキーは操作の識別子だけにする',
    (_label, key, documentId) => {
      expect(key).toStrictEqual([documentId]);
    },
  );

  test('発行は入力を変数にして送り、発行したキーと平文を返す', async () => {
    const data = { issueApiKey: { apiKey: API_KEY, plainKey: PLAIN_KEY } };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        new MutationObserver(queryClient, issueApiKeyMutationOptions()).mutate({
          variables: { input: API_KEY_INPUT },
        }),
      respondWith(data),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientIssueApiKeyDocument),
        variables: { input: API_KEY_INPUT },
      },
    ]);
    expect(result).toStrictEqual(data);
  });

  test('編集はキーのIDと入力を、再発行と削除はキーのIDを変数にして送る', async () => {
    const { sent } = await runThroughApi(
      async (queryClient) => {
        await new MutationObserver(
          queryClient,
          updateApiKeyMutationOptions(),
        ).mutate({ variables: { id: API_KEY_ID, input: API_KEY_INPUT } });
        await new MutationObserver(
          queryClient,
          reissueApiKeyMutationOptions(),
        ).mutate({ variables: { id: API_KEY_ID } });
        return new MutationObserver(
          queryClient,
          deleteApiKeyMutationOptions(),
        ).mutate({ variables: { id: API_KEY_ID } });
      },
      respondWith({
        updateApiKey: API_KEY,
        reissueApiKey: { apiKey: API_KEY, plainKey: PLAIN_KEY },
        deleteApiKey: API_KEY_ID,
      }),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientUpdateApiKeyDocument),
        variables: { id: API_KEY_ID, input: API_KEY_INPUT },
      },
      {
        documentId: documentIdOf(ClientReissueApiKeyDocument),
        variables: { id: API_KEY_ID },
      },
      {
        documentId: documentIdOf(ClientDeleteApiKeyDocument),
        variables: { id: API_KEY_ID },
      },
    ]);
  });

  test('発行の結果を捨てると、平文を持つ変更の記録はすぐに消える', async () => {
    const queryClient = new QueryClient();
    const observer = new MutationObserver(
      queryClient,
      issueApiKeyMutationOptions(),
    );

    await runThroughApi(
      () => observer.mutate({ variables: { input: API_KEY_INPUT } }),
      respondWith({ issueApiKey: { apiKey: API_KEY, plainKey: PLAIN_KEY } }),
      queryClient,
    );
    observer.reset();
    await waitForGarbageCollection();

    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  test('再発行の結果を捨てると、平文を持つ変更の記録はすぐに消える', async () => {
    const queryClient = new QueryClient();
    const observer = new MutationObserver(
      queryClient,
      reissueApiKeyMutationOptions(),
    );

    await runThroughApi(
      () => observer.mutate({ variables: { id: API_KEY_ID } }),
      respondWith({ reissueApiKey: { apiKey: API_KEY, plainKey: PLAIN_KEY } }),
      queryClient,
    );
    observer.reset();
    await waitForGarbageCollection();

    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});
