import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { isNotFound, isRedirect } from '@tanstack/react-router';

import { createAppQueryClient } from '../../lib/start/query-client.ts';
import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  CATEGORY,
  FIELDS,
  FIRST_PAGE,
  VIEWER,
  WINDOW,
} from '../../test/my-products-fixtures.ts';
import {
  ClientMyProductDocument,
  type ClientMyProductQuery,
  ClientMyProductsDocument,
  ClientNewProductLaunchWindowDocument,
  ClientProductCategoriesDocument,
} from './generated/graphql.ts';
import {
  invalidateMyProductQueries,
  loadMyProductEdit,
  loadMyProducts,
  loadProductRegistration,
  MY_PRODUCTS_PAGE_SIZE,
  myProductQueryOptions,
  myProductsQueryOptions,
  newProductLaunchWindowQueryOptions,
  productCategoriesQueryOptions,
} from './my-products.ts';

const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  respond: (request: Request) => Promise<Response>,
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
  const sent = await Promise.all(api.requests.map((request) => request.json()));
  return { result, sent, queryClient };
};

describe('取得の処理', () => {
  test('最初のページは件数だけ、続きのページは件数とカーソルを変数にして実行する', async () => {
    const { sent } = await runThroughApi(
      async (queryClient) => {
        const options = myProductsQueryOptions(VIEWER.id);
        await queryClient.infiniteQuery(options);
        return queryClient.infiniteQuery({ ...options, pages: 2 });
      },
      () => Promise.resolve(graphqlResponse({ data: FIRST_PAGE })),
    );
    const documentId = documentIdOf(ClientMyProductsDocument);

    expect(sent).toStrictEqual([
      { documentId, variables: { first: MY_PRODUCTS_PAGE_SIZE } },
      { documentId, variables: { first: MY_PRODUCTS_PAGE_SIZE } },
      {
        documentId,
        variables: { first: MY_PRODUCTS_PAGE_SIZE, after: 'cursor-1' },
      },
    ]);
  });

  test('編集の照会は開いたハンドルを変数にして実行する', async () => {
    const { sent, result } = await runThroughApi(
      (queryClient) =>
        queryClient.query(myProductQueryOptions(VIEWER.id, 'pitch-deck')),
      () => Promise.resolve(graphqlResponse({ data: { myProduct: null } })),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientMyProductDocument),
        variables: { handle: 'pitch-deck' },
      },
    ]);
    expect(result).toStrictEqual({ myProduct: null });
  });
});

describe('loadMyProducts', () => {
  test('最初のページだけを読み、キャッシュに残す', async () => {
    const { result, sent } = await runThroughApi(
      async (client) => {
        await loadMyProducts({
          context: { queryClient: client, viewer: VIEWER },
        });
        return client.getQueryData(myProductsQueryOptions(VIEWER.id).queryKey);
      },
      () => Promise.resolve(graphqlResponse({ data: FIRST_PAGE })),
    );

    expect(result).toStrictEqual({ pages: [FIRST_PAGE], pageParams: [null] });
    expect(sent).toHaveLength(1);
  });

  test('取得に失敗しても、一覧の位置で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadMyProducts({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(myProductsQueryOptions(VIEWER.id).queryKey)
        ?.status,
    ).toBe('error');
  });
});

describe('loadProductRegistration', () => {
  const respondToRegistration = async (request: Request) => {
    const { documentId } = (await request.clone().json()) as {
      readonly documentId: string;
    };
    return graphqlResponse({
      data:
        documentId === documentIdOf(ClientProductCategoriesDocument)
          ? { productCategories: [CATEGORY] }
          : { newProductLaunchWindow: WINDOW },
    });
  };

  test('選べる日は締め切りで変わるため、キャッシュに新しい値があっても取得し直し、カテゴリはキャッシュの値を使う', async () => {
    const { sent } = await runThroughApi(
      async (client) => {
        client.setQueryData(
          newProductLaunchWindowQueryOptions(VIEWER.id).queryKey,
          { newProductLaunchWindow: WINDOW },
        );
        client.setQueryData(productCategoriesQueryOptions().queryKey, {
          productCategories: [CATEGORY],
        });
        return loadProductRegistration({
          context: { queryClient: client, viewer: VIEWER },
        });
      },
      respondToRegistration,
      createAppQueryClient({ isServer: false }),
    );

    expect(
      (sent as readonly { readonly documentId: string }[]).map(
        ({ documentId }) => documentId,
      ),
    ).toStrictEqual([documentIdOf(ClientNewProductLaunchWindowDocument)]);
  });

  test('選べる日とカテゴリを同時に読み、キャッシュに残す', async () => {
    const { result, sent } = await runThroughApi(async (client) => {
      await loadProductRegistration({
        context: { queryClient: client, viewer: VIEWER },
      });
      return [
        client.getQueryData(
          newProductLaunchWindowQueryOptions(VIEWER.id).queryKey,
        ),
        client.getQueryData(productCategoriesQueryOptions().queryKey),
      ];
    }, respondToRegistration);

    expect(result).toStrictEqual([
      { newProductLaunchWindow: WINDOW },
      { productCategories: [CATEGORY] },
    ]);
    expect(
      (sent as readonly { readonly documentId: string }[])
        .map(({ documentId }) => documentId)
        .toSorted(),
    ).toStrictEqual(
      [
        documentIdOf(ClientNewProductLaunchWindowDocument),
        documentIdOf(ClientProductCategoriesDocument),
      ].toSorted(),
    );
  });

  test('取得に失敗しても、ページの位置で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadProductRegistration({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(productCategoriesQueryOptions().queryKey)
        ?.status,
    ).toBe('error');
  });
});

describe('invalidateMyProductQueries(取り直さない指定)', () => {
  test('表示中の取得も取り直さずに古いものとだけし、次に読む時に取得し直させる', async () => {
    const queryClient = new QueryClient();
    const key = myProductQueryOptions(VIEWER.id, 'pitch-deck').queryKey;
    queryClient.setQueryData(key, { myProduct: null });
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => Promise.reject(new Error('取り直してはいけません')),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await invalidateMyProductQueries(queryClient, { refetchActive: false });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(key)?.fetchStatus).toBe('idle');
    unsubscribe();
  });
});

describe('loadMyProductEdit', () => {
  const myProductData = (myProduct: ClientMyProductQuery['myProduct']) =>
    graphqlResponse({ data: { myProduct } });

  const respondByDocument =
    (myProduct: () => Promise<Response>) => async (request: Request) => {
      const { documentId } = (await request.clone().json()) as {
        readonly documentId: string;
      };
      return documentId === documentIdOf(ClientProductCategoriesDocument)
        ? graphqlResponse({ data: { productCategories: [CATEGORY] } })
        : myProduct();
    };

  const load = (client: QueryClient, handle = 'pitch-deck') =>
    loadMyProductEdit({
      context: { queryClient: client, viewer: VIEWER },
      params: { handle },
    });

  test('自分のプロダクトとカテゴリを同時に読み、名称を返してキャッシュに残す', async () => {
    const { result, sent, queryClient } = await runThroughApi(
      (client) => load(client),
      respondByDocument(() =>
        Promise.resolve(myProductData({ __typename: 'MyProduct', ...FIELDS })),
      ),
    );

    expect(result).toStrictEqual({ name: FIELDS.name });
    expect(sent).toHaveLength(2);
    expect(
      queryClient.getQueryData(
        myProductQueryOptions(VIEWER.id, 'pitch-deck').queryKey,
      ),
    ).toStrictEqual({ myProduct: { __typename: 'MyProduct', ...FIELDS } });
    expect(
      queryClient.getQueryData(productCategoriesQueryOptions().queryKey),
    ).toStrictEqual({ productCategories: [CATEGORY] });
  });

  test('キャッシュに値があっても、ローンチの状態と固定が変わり得るため取得し直す', async () => {
    const { sent } = await runThroughApi(
      async (client) => {
        client.setQueryData(
          myProductQueryOptions(VIEWER.id, 'pitch-deck').queryKey,
          { myProduct: { __typename: 'MyProduct', ...FIELDS } },
        );
        return load(client);
      },
      respondByDocument(() =>
        Promise.resolve(myProductData({ __typename: 'MyProduct', ...FIELDS })),
      ),
      createAppQueryClient({ isServer: false }),
    );

    expect(
      (sent as readonly { readonly documentId: string }[]).filter(
        ({ documentId }) =>
          documentId === documentIdOf(ClientMyProductDocument),
      ),
    ).toHaveLength(1);
  });

  test('他人・論理削除済み・不在のプロダクトは404にする', async () => {
    const { result } = await runThroughApi(
      (client) => load(client).catch((thrown: unknown) => thrown),
      respondByDocument(() => Promise.resolve(myProductData(null))),
    );

    expect(isNotFound(result)).toBe(true);
  });

  test('旧ハンドルは現在のハンドルの編集画面へ302で移す', async () => {
    const { result } = await runThroughApi(
      (client) =>
        load(client, 'pitch-deck-old').catch((thrown: unknown) => thrown),
      respondByDocument(() =>
        Promise.resolve(
          myProductData({
            __typename: 'MyProductRedirect',
            handle: 'pitch-deck',
          }),
        ),
      ),
    );

    expect(isRedirect(result)).toBe(true);
    const { options } = result as { readonly options: Record<string, unknown> };
    expect(options).toMatchObject({
      to: '/my/products/$handle/edit',
      params: { handle: 'pitch-deck' },
      statusCode: 302,
    });
  });

  test('プロダクトの取得の失敗は、題名を作れずページを表示できないためそのまま投げ、カテゴリの失敗はキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) => load(client).catch((thrown: unknown) => thrown),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBeInstanceOf(GraphQLClientError);
    expect(
      queryClient.getQueryState(productCategoriesQueryOptions().queryKey)
        ?.status,
    ).toBe('error');
  });
});
