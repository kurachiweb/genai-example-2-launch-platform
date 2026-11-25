import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'bun:test';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  auditLogsQueryOptions,
  invalidateAuditLogQueries,
  toAuditLogPage,
} from './admin-audit-logs.ts';
import {
  AdminAuditLogsDocument,
  type AdminAuditLogsQuery,
} from './generated/graphql.ts';

describe('auditLogsQueryOptions', () => {
  test('監査ログの検索の操作と変数をキーにする', () => {
    const variables = { filter: { action: 'admin-account.invite' } };

    expect([...auditLogsQueryOptions(variables).queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminAuditLogsDocument, variables),
    ]);
  });
});

describe('invalidateAuditLogQueries', () => {
  test('条件とページの位置を問わず、監査ログの検索の取得を全て無効にし、他の照会は無効にしない', async () => {
    const queryClient = new QueryClient();
    const page: AdminAuditLogsQuery = {
      auditLogs: { entries: [], nextCursor: null },
    };
    const unfiltered = auditLogsQueryOptions({}).queryKey;
    const filtered = auditLogsQueryOptions({
      filter: { targetId: 'target-1' },
      after: 'cursor-2',
    }).queryKey;
    const other = ['other-query'];
    queryClient.setQueryData(unfiltered, page);
    queryClient.setQueryData(filtered, page);
    queryClient.setQueryData(other, {});

    await invalidateAuditLogQueries(queryClient);

    expect(queryClient.getQueryState(unfiltered)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(filtered)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  });
});

describe('toAuditLogPage', () => {
  test('検索の結果から1ページ分の監査ログと次のページの位置を取り出す', () => {
    const data: AdminAuditLogsQuery = {
      auditLogs: { entries: [], nextCursor: 'cursor-2' },
    };

    expect(toAuditLogPage(data)).toBe(data.auditLogs);
  });
});
