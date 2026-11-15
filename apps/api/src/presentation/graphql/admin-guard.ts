import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { AdminAuthorizer } from '../../application/admin/admin-authorizer.ts';
import { ADMIN_TYPES } from '../../application/admin/admin-types.ts';
import type { GraphQLContext } from './graphql-context.ts';

const ADMIN_CALLER = 'admin';

const logger = getAppLogger(['api', 'admin', 'authorization']);

function authorizerOf(context: GraphQLContext): AdminAuthorizer {
  return context.resolve<AdminAuthorizer>(ADMIN_TYPES.AdminAuthorizer);
}

// 操作名はGraphQLの操作のログが同じ相関IDで残すため、必要なロールだけを残す。管理者側でない呼び出し元の拒否はロールの不足ではないため残さない
async function loggingRoleDenial(
  context: GraphQLContext,
  minimum: AdminRole,
  authorize: () => Promise<CurrentAdmin>,
): Promise<CurrentAdmin> {
  try {
    return await authorize();
  } catch (error: unknown) {
    if (
      context.caller === ADMIN_CALLER &&
      error instanceof AppError &&
      error.code === 'forbidden'
    ) {
      logger.warn('管理者の操作をロールの不足で拒否しました', {
        requiredRole: minimum,
      });
    }
    throw error;
  }
}

export function requireAdmin(
  context: GraphQLContext,
  minimum: AdminRole,
): Promise<CurrentAdmin> {
  return loggingRoleDenial(context, minimum, () =>
    authorizerOf(context).requireAdmin(
      context.session,
      context.caller,
      minimum,
    ),
  );
}

export function requireSelfOrRole(
  context: GraphQLContext,
  ownerAdminId: string,
  minimum: AdminRole,
): Promise<CurrentAdmin> {
  return loggingRoleDenial(context, minimum, () =>
    authorizerOf(context).requireSelfOrRole(
      context.session,
      context.caller,
      ownerAdminId,
      minimum,
    ),
  );
}
