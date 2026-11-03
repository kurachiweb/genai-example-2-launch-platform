import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { credentialResolvers } from './credential-resolvers.ts';
import { loginResolvers } from './login-resolvers.ts';
import { ADMIN_TYPE_DEFS } from './type-defs.ts';

const adminResolvers = {
  ...loginResolvers,
  Mutation: {
    ...loginResolvers.Mutation,
    ...credentialResolvers.Mutation,
  },
} satisfies Resolvers;

export const adminSchemaModule = defineSchemaModule({
  name: 'admin',
  typeDefs: ADMIN_TYPE_DEFS,
  resolvers: adminResolvers,
});
