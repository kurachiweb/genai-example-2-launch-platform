import { defineSchemaModule } from '../../schema-module.ts';
import { publicApiResolvers } from './resolvers.ts';
import { PUBLIC_API_TYPE_DEFS } from './type-defs.ts';

export const publicApiSchemaModule = defineSchemaModule({
  name: 'public-api',
  typeDefs: PUBLIC_API_TYPE_DEFS,
  resolvers: publicApiResolvers,
});
