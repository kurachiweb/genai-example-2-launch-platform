import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { RELAY_REQUEST_HEADERS } from '../../server/relay/relay-contract.ts';
import { GRAPHQL_RELAY_ROUTE } from '../../server/relay/relay-route.ts';
import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../utilities/graphql/graphql-result.ts';
import type {
  DocumentId,
  PersistedDocument,
} from '../../utilities/graphql/persisted-document.ts';
import {
  buildGraphQLRequest,
  executeGraphQLInBrowser,
  executeGraphQLWithGlobalFetch,
  type FetchFunction,
  GRAPHQL_REQUEST_ACCEPT,
  GRAPHQL_REQUEST_CONTENT_TYPE,
} from './browser-transport.ts';

interface ProductQuery {
  readonly product: { readonly id: string } | null;
}

interface ProductQueryVariables {
  readonly id: string;
}

const DOCUMENT_ID: DocumentId = `sha256:${'0123456789abcdef'.repeat(4)}`;

const OPERATION_SOURCE = 'query Product($id: ID!) { product(id: $id) { id } }';

const TURNSTILE_TOKEN = 'turnstile-token-of-browser';

const VARIABLES: ProductQueryVariables = { id: 'product-1' };

// コード生成の出力と同じく、識別子に加えて操作の本文と構文木を持つ文書
const PRODUCT_DOCUMENT = {
  kind: 'Document',
  definitions: [{ kind: 'OperationDefinition', operation: 'query' }],
  loc: { start: 0, end: OPERATION_SOURCE.length, source: OPERATION_SOURCE },
  __meta__: { hash: DOCUMENT_ID },
} as unknown as PersistedDocument<ProductQuery, ProductQueryVariables>;

interface FetchCall {
  readonly input: string;
  readonly init: RequestInit;
}

const fakeFetch = (
  respond: () => Promise<Response>,
): { readonly fetch: FetchFunction; readonly calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  return {
    fetch: (input, init) => {
      calls.push({ input, init });
      return respond();
    },
    calls,
  };
};

const respondWith =
  (body: BodyInit | null, init: ResponseInit = {}) =>
  (): Promise<Response> =>
    Promise.resolve(new Response(body, init));

const jsonResponse = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', GRAPHQL_REQUEST_ACCEPT);
  return respondWith(JSON.stringify(body), { ...init, headers });
};

const onlyCall = (calls: readonly FetchCall[]): FetchCall => {
  const [call] = calls;
  if (calls.length !== 1 || call === undefined) {
    throw new Error(
      `fetchの呼び出しは1回を期待したが${String(calls.length)}回だった`,
    );
  }
  return call;
};

const headersOf = (call: FetchCall): Headers => new Headers(call.init.headers);

const bodyOf = (call: FetchCall): string => {
  if (typeof call.init.body !== 'string') {
    throw new Error('本文は文字列を期待した');
  }
  return call.init.body;
};

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗を期待したが成功した');
};

const errorOf = (result: GraphQLResult<ProductQuery>): GraphQLClientError => {
  if (result.ok) {
    throw new Error('失敗の結果を期待したが成功だった');
  }
  return result.error;
};

const execute = (
  fetchFunction: FetchFunction,
  options?: Parameters<typeof executeGraphQLInBrowser>[3],
): Promise<GraphQLResult<ProductQuery>> =>
  executeGraphQLInBrowser(fetchFunction, PRODUCT_DOCUMENT, VARIABLES, options);

describe('buildGraphQLRequest', () => {
  test('本文は操作の識別子と変数だけで、操作の本文と構文木を含まない', () => {
    const { body } = buildGraphQLRequest(
      PRODUCT_DOCUMENT,
      VARIABLES,
      undefined,
    );

    expect(JSON.parse(body)).toEqual({
      documentId: DOCUMENT_ID,
      variables: VARIABLES,
    });
    expect(body).not.toContain('query Product');
    expect(body).not.toContain('definitions');
  });

  test('本文の形式と受け付ける応答の形式の項目を付け、トークンが無ければbot判定の項目を付けない', () => {
    const { headers } = buildGraphQLRequest(
      PRODUCT_DOCUMENT,
      VARIABLES,
      undefined,
    );

    expect([...headers.keys()].sort()).toEqual(['accept', 'content-type']);
    expect(headers.get('content-type')).toBe(GRAPHQL_REQUEST_CONTENT_TYPE);
    expect(headers.get('accept')).toBe(GRAPHQL_REQUEST_ACCEPT);
  });

  test('bot判定のトークンを契約の項目に付け、本文には含めない', () => {
    const { headers, body } = buildGraphQLRequest(
      PRODUCT_DOCUMENT,
      VARIABLES,
      TURNSTILE_TOKEN,
    );

    expect(headers.get(RELAY_REQUEST_HEADERS.botToken)).toBe(TURNSTILE_TOKEN);
    expect(body).not.toContain(TURNSTILE_TOKEN);
  });

  test('識別子を持たない文書は例外にする', () => {
    const withoutId = {
      ...PRODUCT_DOCUMENT,
      __meta__: undefined,
    } as PersistedDocument<ProductQuery, ProductQueryVariables>;

    expect(() => buildGraphQLRequest(withoutId, VARIABLES, undefined)).toThrow(
      TypeError,
    );
  });
});

describe('executeGraphQLInBrowser(送信の形)', () => {
  test('中継の経路へPOSTで識別子と変数だけを送る', async () => {
    const { fetch, calls } = fakeFetch(
      jsonResponse({ data: { product: null } }),
    );

    await execute(fetch);

    const call = onlyCall(calls);
    expect(call.input).toBe(GRAPHQL_RELAY_ROUTE.path);
    expect(call.init.method).toBe('POST');
    expect(call.init.credentials).toBe('same-origin');
    expect(JSON.parse(bodyOf(call))).toEqual({
      documentId: DOCUMENT_ID,
      variables: VARIABLES,
    });
    expect(bodyOf(call)).not.toContain('query Product');
  });

  test('中継の経路が受け付ける形式で送り、トークンが無ければbot判定の項目を付けない', async () => {
    const { fetch, calls } = fakeFetch(
      jsonResponse({ data: { product: null } }),
    );

    await execute(fetch);

    const headers = headersOf(onlyCall(calls));
    expect(GRAPHQL_RELAY_ROUTE.acceptContentTypes).toContain(
      headers.get('content-type') ?? '',
    );
    expect(headers.get('accept')).toBe(GRAPHQL_REQUEST_ACCEPT);
    expect(headers.has(RELAY_REQUEST_HEADERS.botToken)).toBe(false);
  });

  test('bot判定のトークンを項目として付ける', async () => {
    const { fetch, calls } = fakeFetch(
      jsonResponse({ data: { product: null } }),
    );

    await execute(fetch, { turnstileToken: TURNSTILE_TOKEN });

    const call = onlyCall(calls);
    expect(headersOf(call).get(RELAY_REQUEST_HEADERS.botToken)).toBe(
      TURNSTILE_TOKEN,
    );
    expect(bodyOf(call)).not.toContain(TURNSTILE_TOKEN);
  });

  test('呼び出し元の中断の合図をfetchへ渡す', async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch(
      jsonResponse({ data: { product: null } }),
    );

    await execute(fetch, { signal: controller.signal });

    expect(onlyCall(calls).init.signal).toBe(controller.signal);
  });

  test('識別子を持たない文書は送らずに例外にする', async () => {
    const { fetch, calls } = fakeFetch(
      jsonResponse({ data: { product: null } }),
    );
    const withoutId = {
      ...PRODUCT_DOCUMENT,
      __meta__: undefined,
    } as PersistedDocument<ProductQuery, ProductQueryVariables>;

    expect(
      await rejectionOf(executeGraphQLInBrowser(fetch, withoutId, VARIABLES)),
    ).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe('executeGraphQLInBrowser(通信の失敗)', () => {
  test('fetchが例外になれば通信の失敗のエラーにする', async () => {
    const cause = new TypeError('Failed to fetch');
    const { fetch } = fakeFetch(() => Promise.reject(cause));

    const error = errorOf(await execute(fetch));

    expect(error).toBeInstanceOf(GraphQLClientError);
    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.expected).toBe(false);
    expect(error.cause).toBe(cause);
  });

  test('本文の受信が途中で失敗すれば通信の失敗のエラーにする', async () => {
    const cause = new TypeError('network connection lost');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(cause);
      },
    });
    const { fetch } = fakeFetch(respondWith(body, { status: 200 }));

    const error = errorOf(await execute(fetch));

    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
  });

  test('呼び出し元が中断した場合は通信の失敗にせず中断の理由で失敗する', async () => {
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    const fetch = mock<FetchFunction>(() => {
      controller.abort(reason);
      return Promise.reject(reason);
    });

    expect(
      await rejectionOf(execute(fetch, { signal: controller.signal })),
    ).toBe(reason);
  });
});

describe('executeGraphQLInBrowser(応答の解析)', () => {
  test('dataがあれば成功としてdataを返す', async () => {
    const { fetch } = fakeFetch(
      jsonResponse({ data: { product: { id: 'product-1' } } }),
    );

    expect(await execute(fetch)).toEqual({
      ok: true,
      data: { product: { id: 'product-1' } },
    });
  });

  test('GraphQLのエラーはエラーコード・メッセージ・項目ごとの詳細を型付きで返す', async () => {
    const details = [
      { field: 'id', message: '商品が見つかりません。', code: 'not_found' },
    ];
    const { fetch } = fakeFetch(
      jsonResponse({
        errors: [
          {
            message: '入力内容を確認してください。',
            extensions: { code: 'validation_failed', details },
          },
        ],
      }),
    );

    const error = errorOf(await execute(fetch));

    expect(error.code).toBe('validation_failed');
    expect(error.message).toBe('入力内容を確認してください。');
    expect(error.details).toEqual(details);
    expect(error.status).toBe(200);
    expect(error.expected).toBe(true);
  });

  test('中継の経路の共通のエラー形式は状態コードと再試行までの秒数を保つ', async () => {
    const { fetch } = fakeFetch(
      jsonResponse(
        {
          error: {
            code: 'upstream_unavailable',
            message: '現在ご利用いただけません。',
          },
        },
        { status: 503, headers: { 'Retry-After': '5' } },
      ),
    );

    const error = errorOf(await execute(fetch));

    expect(error.code).toBe('upstream_unavailable');
    expect(error.status).toBe(503);
    expect(error.retryAfterSeconds).toBe(5);
    expect(error.expected).toBe(false);
  });

  test('IP制限の超過は想定内の失敗として再試行までの秒数を返す', async () => {
    const { fetch } = fakeFetch(
      jsonResponse(
        {
          error: {
            code: 'rate_limit_exceeded',
            message: '時間をおいて再度お試しください。',
          },
        },
        { status: 429, headers: { 'Retry-After': '10' } },
      ),
    );

    const error = errorOf(await execute(fetch));

    expect(error.code).toBe('rate_limit_exceeded');
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(10);
    expect(error.expected).toBe(true);
  });

  test('JSONでない本文は解釈できない応答のエラーにする', async () => {
    const { fetch } = fakeFetch(
      respondWith('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const error = errorOf(await execute(fetch));

    expect(error.code).toBe('invalid_response');
    expect(error.status).toBe(502);
    expect(error.expected).toBe(false);
  });
});

describe('executeGraphQLWithGlobalFetch', () => {
  afterEach(() => {
    mock.restore();
  });

  test('大域のfetchで中継の経路へ送り、応答を解析する', async () => {
    const fakeGlobalFetch = Object.assign(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ data: { product: null } }), {
            headers: { 'Content-Type': GRAPHQL_REQUEST_ACCEPT },
          }),
        ),
      { preconnect: () => undefined },
    );
    const globalFetch = spyOn(globalThis, 'fetch').mockImplementation(
      fakeGlobalFetch,
    );

    const result = await executeGraphQLWithGlobalFetch(
      PRODUCT_DOCUMENT,
      VARIABLES,
      { turnstileToken: TURNSTILE_TOKEN },
    );

    expect(result).toEqual({ ok: true, data: { product: null } });
    expect(globalFetch).toHaveBeenCalledTimes(1);
    const [input, init] = globalFetch.mock.calls[0] ?? [];
    expect(input).toBe(GRAPHQL_RELAY_ROUTE.path);
    expect(new Headers(init?.headers).get(RELAY_REQUEST_HEADERS.botToken)).toBe(
      TURNSTILE_TOKEN,
    );
  });
});
