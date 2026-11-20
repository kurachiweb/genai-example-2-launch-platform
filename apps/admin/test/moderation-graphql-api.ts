import { QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../lib/test/start-request-fixtures.ts';

export interface SentGraphQLRequest {
  readonly documentId: string;
  readonly variables: unknown;
}

export interface ApiRun<TResult> {
  readonly result: TResult;
  readonly sent: readonly SentGraphQLRequest[];
  readonly queryClient: QueryClient;
}

export const dataResponse =
  (data: unknown): (() => Promise<Response>) =>
  () =>
    Promise.resolve(graphqlResponse({ data }));

export const unavailableResponse = (): Promise<Response> =>
  Promise.resolve(new Response('', { status: 503 }));

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で取得し、APIへ送った識別子と変数を読み取る
export const runThroughApi = async <TResult>(
  run: (queryClient: QueryClient) => Promise<TResult>,
  respond: () => Promise<Response>,
): Promise<ApiRun<TResult>> => {
  const api = recordingApi(respond);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const results: TResult[] = [];
  await runInStartRequest({
    context: renderContextOf({ api, reported: [] }),
    render: async () => {
      results.push(await run(queryClient));
      return htmlResponse();
    },
  });
  const sent = (await Promise.all(
    api.requests.map((request) => request.json()),
  )) as SentGraphQLRequest[];
  const [result] = results;
  return { result: result as TResult, sent, queryClient };
};
