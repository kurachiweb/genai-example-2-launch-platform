import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { accountResolvers } from './account-resolvers.ts';
import { auditLogResolvers } from './audit-log-resolvers.ts';
import { credentialResolvers } from './credential-resolvers.ts';
import { loginResolvers } from './login-resolvers.ts';
import { selfResolvers } from './self-resolvers.ts';
import { ADMIN_TYPE_DEFS } from './type-defs.ts';

const adminResolvers = {
  AdminViewer: loginResolvers.AdminViewer,
  AdminAccount: accountResolvers.AdminAccount,
  Query: {
    ...loginResolvers.Query,
    ...accountResolvers.Query,
    ...auditLogResolvers.Query,
  },
  Mutation: {
    ...loginResolvers.Mutation,
    ...credentialResolvers.Mutation,
    ...accountResolvers.Mutation,
    ...selfResolvers.Mutation,
  },
} satisfies Resolvers;

export const adminSchemaModule = defineSchemaModule({
  name: 'admin',
  typeDefs: ADMIN_TYPE_DEFS,
  resolvers: adminResolvers,
});
