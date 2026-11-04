import { describe, expect, test } from 'bun:test';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import { auditLogsQueryOptions, toAuditLogPage } from './admin-audit-logs.ts';
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

describe('toAuditLogPage', () => {
  test('検索の結果から1ページ分の監査ログと次のページの位置を取り出す', () => {
    const data: AdminAuditLogsQuery = {
      auditLogs: { entries: [], nextCursor: 'cursor-2' },
    };

    expect(toAuditLogPage(data)).toBe(data.auditLogs);
  });
});
