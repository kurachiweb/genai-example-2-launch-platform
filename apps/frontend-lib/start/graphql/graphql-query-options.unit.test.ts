import { describe, expect, test } from 'bun:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../test/start-request-fixtures.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';

import {
  type DocumentId,
  graphqlQueryKey,
  type PersistedDocument,
} from '../../utilities/graphql/persisted-document.ts';
import {
  graphqlMutationOptions,
  graphqlQueryOptions,
} from './graphql-query-options.ts';

interface ProductQuery {
  readonly product: { readonly id: string } | null;
}

interface ProductQueryVariables {
  readonly id: string;
}

const DOCUMENT_ID: DocumentId = `sha256:${'fedcba9876543210'.repeat(4)}`;

const PRODUCT_DOCUMENT = {
  __meta__: { hash: DOCUMENT_ID },
} as unknown as PersistedDocument<ProductQuery, ProductQueryVariables>;

describe('graphqlQueryOptions', () => {
  test('取得のキーは操作の識別子と変数の組にする', () => {
    const options = graphqlQueryOptions(PRODUCT_DOCUMENT, { id: 'product-1' });

    const queryKey: readonly unknown[] = options.queryKey;

    expect(queryKey).toEqual(
      graphqlQueryKey(PRODUCT_DOCUMENT, { id: 'product-1' }),
    );
    expect(queryKey).toEqual([DOCUMENT_ID, { id: 'product-1' }]);
    expect(typeof options.queryFn).toBe('function');
  });

  test('識別子を持たない文書は組み立てる時点で例外にする', () => {
    const withoutId = {} as PersistedDocument<
      ProductQuery,
      ProductQueryVariables
    >;

    expect(() => graphqlQueryOptions(withoutId, { id: 'product-1' })).toThrow(
      TypeError,
    );
  });
});

describe('graphqlMutationOptions', () => {
  test('変更のキーは操作の識別子にする', () => {
    const options = graphqlMutationOptions(PRODUCT_DOCUMENT);

    expect(options.mutationKey).toEqual([DOCUMENT_ID]);
    expect(typeof options.mutationFn).toBe('function');
  });
});

const FAILURE_BODY = {
  errors: [
    {
      message: '対象が見つかりません。',
      extensions: { code: 'not_found' },
    },
  ],
};

const runWithApi = async (
  respond: () => Response,
  action: () => Promise<unknown>,
): Promise<{
  readonly value?: unknown;
  readonly error?: unknown;
  readonly requests: readonly Request[];
}> => {
  const api = recordingApi(() => Promise.resolve(respond()));
  let outcome: { readonly value?: unknown; readonly error?: unknown } = {};
  await runInStartRequest({
    context: renderContextOf({ api }),
    render: async () => {
      try {
        outcome = { value: await action() };
      } catch (error) {
        outcome = { error };
      }
      return htmlResponse();
    },
  });
  return { ...outcome, requests: api.requests };
};

describe('graphqlQueryOptions(取得)', () => {
  test('取得に成功すればdataを返す', async () => {
    const queryClient = new QueryClient();

    const { value, requests } = await runWithApi(
      () => graphqlResponse({ data: { product: { id: 'product-1' } } }),
      () =>
        queryClient.query(
          graphqlQueryOptions(PRODUCT_DOCUMENT, { id: 'product-1' }),
        ),
    );

    expect(value).toEqual({ product: { id: 'product-1' } });
    expect(requests).toHaveLength(1);
  });

  test('失敗した結果はGraphQLClientErrorの例外にする', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { error } = await runWithApi(
      () => graphqlResponse(FAILURE_BODY),
      () =>
        queryClient.query(
          graphqlQueryOptions(PRODUCT_DOCUMENT, { id: 'product-1' }),
        ),
    );

    expect(error).toBeInstanceOf(GraphQLClientError);
    expect((error as GraphQLClientError).code).toBe('not_found');
  });
});

describe('graphqlMutationOptions(変更)', () => {
  test('変数とbot判定のトークンを送り、成功すればdataを返す', async () => {
    const queryClient = new QueryClient();

    const { value, requests } = await runWithApi(
      () => graphqlResponse({ data: { product: null } }),
      () =>
        new MutationObserver(
          queryClient,
          graphqlMutationOptions(PRODUCT_DOCUMENT),
        ).mutate({
          variables: { id: 'product-1' },
          turnstileToken: 'turnstile-token',
        }),
    );

    expect(value).toEqual({ product: null });
    const [upstream] = requests;
    expect(upstream?.headers.get('cf-turnstile-response')).toBe(
      'turnstile-token',
    );
    expect(await upstream?.json()).toEqual({
      documentId: DOCUMENT_ID,
      variables: { id: 'product-1' },
    });
  });

  test('失敗した結果はGraphQLClientErrorの例外にする', async () => {
    const queryClient = new QueryClient();

    const { error } = await runWithApi(
      () => graphqlResponse(FAILURE_BODY),
      () =>
        new MutationObserver(
          queryClient,
          graphqlMutationOptions(PRODUCT_DOCUMENT),
        ).mutate({ variables: { id: 'product-1' } }),
    );

    expect(error).toBeInstanceOf(GraphQLClientError);
  });
});
