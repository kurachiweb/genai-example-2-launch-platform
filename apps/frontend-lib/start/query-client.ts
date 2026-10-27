import { environmentManager, QueryClient } from '@tanstack/react-query';

import { GraphQLClientError } from '../utilities/graphql/graphql-result.ts';

export const QUERY_STALE_TIME_MS = 30_000;

export const MAX_QUERY_RETRIES = 2;

// 時間をおけば成功し得る、通信の失敗と中継先の一時的な障害だけを再試行する。429は待つべき時間を利用者に示すため、想定内の失敗と内部エラーは繰り返しても結果が変わらないため再試行しない
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'network_error',
  'upstream_unavailable',
  'upstream_timeout',
]);

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  return (
    error instanceof GraphQLClientError &&
    !error.expected &&
    TRANSIENT_ERROR_CODES.has(error.code) &&
    failureCount < MAX_QUERY_RETRIES
  );
}

export interface AppQueryClientOptions {
  readonly isServer?: boolean;
}

export function createAppQueryClient({
  isServer = environmentManager.isServer(),
}: AppQueryClientOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        refetchOnWindowFocus: false,
        // 中継の時間切れを描画中に再試行すると、その待ち時間だけ初回表示が遅れるため、サーバーでは再試行せずブラウザでの取得に任せる
        retry: isServer ? false : shouldRetryQuery,
      },
      mutations: { retry: false },
    },
  });
}
