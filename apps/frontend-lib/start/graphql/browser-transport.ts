import {
  GRAPHQL_RELAY_PATH,
  RELAY_REQUEST_HEADERS,
} from '../../server/relay/relay-contract.ts';
import {
  createNetworkError,
  type GraphQLResult,
  parseGraphQLResponse,
} from '../../utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  type PersistedDocument,
} from '../../utilities/graphql/persisted-document.ts';

export interface ExecuteOptions {
  readonly turnstileToken?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export type FetchFunction = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

// 変数の型は関数の引数の位置にあり反変のため、neverにするとどの変数の型の文書も受け取れる
export type AnyPersistedDocument<TResult> = PersistedDocument<TResult, never>;

export interface GraphQLRequest {
  readonly headers: Headers;
  readonly body: string;
}

export const GRAPHQL_REQUEST_CONTENT_TYPE = 'application/json';

export const GRAPHQL_REQUEST_ACCEPT = 'application/graphql-response+json';

// ページの描画中の実行も同じ項目と本文を中継へ渡し、ブラウザからの中継と同じ組み立てにする
export function buildGraphQLRequest<TResult>(
  document: AnyPersistedDocument<TResult>,
  variables: unknown,
  turnstileToken: string | undefined,
): GraphQLRequest {
  const body = JSON.stringify({
    documentId: documentIdOf(document),
    variables,
  });
  const headers = new Headers({
    'content-type': GRAPHQL_REQUEST_CONTENT_TYPE,
    accept: GRAPHQL_REQUEST_ACCEPT,
  });
  if (turnstileToken !== undefined) {
    headers.set(RELAY_REQUEST_HEADERS.botToken, turnstileToken);
  }
  return { headers, body };
}

const receive = async (
  fetchFunction: FetchFunction,
  request: GraphQLRequest,
  signal: AbortSignal | undefined,
): Promise<{ readonly response: Response; readonly body: string }> => {
  const response = await fetchFunction(GRAPHQL_RELAY_PATH, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    credentials: 'same-origin',
    signal,
  });
  return { response, body: await response.text() };
};

export async function executeGraphQLInBrowser<TResult>(
  fetchFunction: FetchFunction,
  document: AnyPersistedDocument<TResult>,
  variables: unknown,
  options: ExecuteOptions = {},
): Promise<GraphQLResult<TResult>> {
  const { signal } = options;
  const request = buildGraphQLRequest(
    document,
    variables,
    options.turnstileToken,
  );
  let received: Awaited<ReturnType<typeof receive>>;
  try {
    received = await receive(fetchFunction, request, signal);
  } catch (error) {
    // 呼び出し元の中断は通信の失敗ではないため、再試行やエラーの表示の対象にしない
    if (signal?.aborted === true) {
      throw signal.reason;
    }
    return { ok: false, error: createNetworkError(error) };
  }
  return parseGraphQLResponse<TResult>({
    status: received.response.status,
    headers: received.response.headers,
    body: received.body,
  });
}

// 同型の関数のブラウザの分岐。fetchを変数へ取り出して呼ぶとブラウザによってはthisを失って例外になるため、呼ぶたびに大域のfetchを参照する
export function executeGraphQLWithGlobalFetch<TResult>(
  document: AnyPersistedDocument<TResult>,
  variables: unknown,
  options?: ExecuteOptions,
): Promise<GraphQLResult<TResult>> {
  return executeGraphQLInBrowser(
    (input, init) => fetch(input, init),
    document,
    variables,
    options,
  );
}
