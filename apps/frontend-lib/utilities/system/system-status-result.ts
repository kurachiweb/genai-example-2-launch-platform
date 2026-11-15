import type {
  GraphQLClientError,
  GraphQLResult,
} from '../graphql/graphql-result.ts';

export interface SystemStatusSnapshot {
  readonly serverTime: string;
  readonly databaseReachable: boolean;
}

export type SystemStatusResult = GraphQLResult<SystemStatusSnapshot>;

// フロントエンドサーバーの中継がAPIサーバーへ届かなかった失敗と、ブラウザから中継の経路へ届かなかった失敗だけを、APIサーバーへ到達できなかったとみなす
const API_UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'upstream_unavailable',
  'upstream_timeout',
  'network_error',
]);

export const isApiUnreachable = (error: GraphQLClientError): boolean =>
  API_UNREACHABLE_CODES.has(error.code);
