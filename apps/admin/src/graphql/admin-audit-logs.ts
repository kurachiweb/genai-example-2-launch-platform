import type { QueryClient } from '@tanstack/react-query';

import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  AdminAuditLogsDocument,
  type AdminAuditLogsQuery,
  type AdminAuditLogsQueryVariables,
} from './generated/graphql.ts';

export type AuditLogPage = AdminAuditLogsQuery['auditLogs'];

export type AuditLogEntry = AuditLogPage['entries'][number];

export const auditLogsQueryOptions = (
  variables: AdminAuditLogsQueryVariables,
) => graphqlQueryOptions(AdminAuditLogsDocument, variables);

// 監査ログを残す操作の後に、条件とページの位置を問わず検索の結果を取り直させる。表示していない照会は古い印が付くだけで取り直さない
export async function invalidateAuditLogQueries(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [documentIdOf(AdminAuditLogsDocument)],
  });
}

export const toAuditLogPage = ({
  auditLogs,
}: AdminAuditLogsQuery): AuditLogPage => auditLogs;
