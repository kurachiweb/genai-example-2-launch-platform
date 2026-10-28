import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../lib/utilities/graphql/graphql-result.ts';
import type { ExecutionSite } from '../../lib/utilities/system/execution-site.ts';
import type { SystemStatusResult } from '../../lib/utilities/system/system-status-result.ts';
import type { ClientSystemStatusQuery } from './generated/graphql.ts';

export interface SystemStatusLoaderFailure {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

export type SystemStatusLoaderResult =
  | Extract<SystemStatusResult, { readonly ok: true }>
  | { readonly ok: false; readonly error: SystemStatusLoaderFailure };

export interface SystemStatusLoaderData {
  readonly executedOn: ExecutionSite;
  readonly result: SystemStatusLoaderResult;
}

export interface SystemStatusInitialResult {
  readonly executedOn: ExecutionSite;
  readonly result: SystemStatusResult;
}

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
  executedOn: ExecutionSite,
): SystemStatusLoaderData => {
  if (result.ok) {
    return { executedOn, result };
  }
  const { code, message, status } = result.error;
  return {
    executedOn,
    result: { ok: false, error: { code, message, status } },
  };
};

export const fromSystemStatusLoaderData = ({
  executedOn,
  result,
}: SystemStatusLoaderData): SystemStatusInitialResult => ({
  executedOn,
  result: result.ok
    ? result
    : { ok: false, error: new GraphQLClientError(result.error) },
});
