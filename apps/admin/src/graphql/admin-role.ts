import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import type { AdminRole as GraphQLAdminRole } from './generated/graphql.ts';

const FROM_GRAPHQL: Readonly<Record<GraphQLAdminRole, AdminRole>> =
  Object.freeze({
    VIEWER: 'viewer',
    MODERATOR: 'moderator',
    SUPER_ADMIN: 'super_admin',
  });

const TO_GRAPHQL: Readonly<Record<AdminRole, GraphQLAdminRole>> = Object.freeze(
  {
    viewer: 'VIEWER',
    moderator: 'MODERATOR',
    super_admin: 'SUPER_ADMIN',
  },
);

export const fromGraphQLAdminRole = (role: GraphQLAdminRole): AdminRole =>
  FROM_GRAPHQL[role];

export const toGraphQLAdminRole = (role: AdminRole): GraphQLAdminRole =>
  TO_GRAPHQL[role];
