import type { QueryClient } from '@tanstack/react-query';

import { auditLogsQueryOptions } from '../src/graphql/admin-audit-logs.ts';

// 監査ログの画面で読んだ照会をキャッシュに置き、操作の後にその照会が無効にされたかを返す関数を作る
export function watchAuditLogQueries(queryClient: QueryClient): () => boolean {
  const { queryKey } = auditLogsQueryOptions({});
  queryClient.setQueryData(queryKey, {
    auditLogs: { entries: [], nextCursor: null },
  });
  return () => queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
}
