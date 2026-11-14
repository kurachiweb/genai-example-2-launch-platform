import { defineSchemaModule } from '../../schema-module.ts';
import { systemResolvers } from './resolvers.ts';
import { SYSTEM_TYPE_DEFS } from './type-defs.ts';

export const systemSchemaModule = defineSchemaModule({
  name: 'system',
  typeDefs: SYSTEM_TYPE_DEFS,
  resolvers: systemResolvers,
});
