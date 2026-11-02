import { defineSchemaModule } from '../../schema-module.ts';
import { accountResolvers } from './account-resolvers.ts';
import { IDENTITY_TYPE_DEFS } from './type-defs.ts';

export const identitySchemaModule = defineSchemaModule({
  name: 'identity',
  typeDefs: IDENTITY_TYPE_DEFS,
  resolvers: accountResolvers,
});
