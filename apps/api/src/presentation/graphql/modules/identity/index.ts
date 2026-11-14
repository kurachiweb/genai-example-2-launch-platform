import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { accountResolvers } from './account-resolvers.ts';
import { sessionResolvers } from './session-resolvers.ts';
import { totpResolvers } from './totp-resolvers.ts';
import { IDENTITY_TYPE_DEFS } from './type-defs.ts';

const identityResolvers = {
  ...accountResolvers,
  Query: { ...accountResolvers.Query, ...sessionResolvers.Query },
  Mutation: {
    ...accountResolvers.Mutation,
    ...sessionResolvers.Mutation,
    ...totpResolvers.Mutation,
  },
} satisfies Resolvers;

export const identitySchemaModule = defineSchemaModule({
  name: 'identity',
  typeDefs: IDENTITY_TYPE_DEFS,
  resolvers: identityResolvers,
});
