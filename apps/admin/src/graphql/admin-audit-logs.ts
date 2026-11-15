import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
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

export const toAuditLogPage = ({
  auditLogs,
}: AdminAuditLogsQuery): AuditLogPage => auditLogs;
