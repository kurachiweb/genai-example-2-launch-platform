import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../lib/utilities/graphql/graphql-result.ts';
import type { SystemStatusResult } from '../../lib/utilities/system/system-status-result.ts';
import type { ClientSystemStatusQuery } from './generated/graphql.ts';

export interface SystemStatusLoaderFailure {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

export type SystemStatusLoaderData =
  | Extract<SystemStatusResult, { readonly ok: true }>
  | { readonly ok: false; readonly error: SystemStatusLoaderFailure };

export const toSystemStatusResult = (
  result: GraphQLResult<ClientSystemStatusQuery>,
): SystemStatusResult => {
  if (!result.ok) {
    return result;
  }
  const { serverTime, databaseReachable } = result.data.systemStatus;
  return { ok: true, data: { serverTime, databaseReachable } };
};

// TanStack RouterはloaderのデータのうちErrorをメッセージだけの別のErrorにしてHTMLへ書き出し、エラーコードが失われてハイドレーションの表示が食い違うため、画面の分岐に使う項目だけの素のオブジェクトで渡す
export const toSystemStatusLoaderData = (
  result: SystemStatusResult,
): SystemStatusLoaderData => {
  if (result.ok) {
    return result;
  }
  const { code, message, status } = result.error;
  return { ok: false, error: { code, message, status } };
};

export const fromSystemStatusLoaderData = (
  data: SystemStatusLoaderData,
): SystemStatusResult =>
  data.ok ? data : { ok: false, error: new GraphQLClientError(data.error) };
