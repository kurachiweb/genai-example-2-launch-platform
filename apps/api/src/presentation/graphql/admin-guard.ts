import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import type {
  AdminAuthorizer,
  CurrentAdmin,
} from '../../application/admin/admin-authorizer.ts';
import { ADMIN_TYPES } from '../../application/admin/admin-types.ts';
import type { GraphQLContext } from './graphql-context.ts';

function authorizerOf(context: GraphQLContext): AdminAuthorizer {
  return context.resolve<AdminAuthorizer>(ADMIN_TYPES.AdminAuthorizer);
}

export function requireAdmin(
  context: GraphQLContext,
  minimum: AdminRole,
): Promise<CurrentAdmin> {
  return authorizerOf(context).requireAdmin(
    context.session,
    context.caller,
    minimum,
  );
}

export function requireSelfOrRole(
  context: GraphQLContext,
  ownerAdminId: string,
  minimum: AdminRole,
): Promise<CurrentAdmin> {
  return authorizerOf(context).requireSelfOrRole(
    context.session,
    context.caller,
    ownerAdminId,
    minimum,
  );
}
