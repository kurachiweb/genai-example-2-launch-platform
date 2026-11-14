import type { GraphQLResult } from '../../lib/utilities/graphql/graphql-result.ts';
import type { ExecutionSite } from '../../lib/utilities/system/execution-site.ts';
import type { SystemStatusResult } from '../../lib/utilities/system/system-status-result.ts';
import type { AdminSystemStatusQuery } from './generated/graphql.ts';

export interface SystemStatusLoaderData {
  readonly executedOn: ExecutionSite;
  readonly result: SystemStatusResult;
}

export const toSystemStatusResult = (
  result: GraphQLResult<AdminSystemStatusQuery>,
): SystemStatusResult => {
  if (!result.ok) {
    return result;
  }
  const { serverTime, databaseReachable } = result.data.systemStatus;
  return { ok: true, data: { serverTime, databaseReachable } };
};
