import { defineSchemaModule } from '../../schema-module.ts';
import { ultrasResolvers } from './resolvers.ts';
import { ULTRAS_TYPE_DEFS } from './type-defs.ts';

export const ultrasSchemaModule = defineSchemaModule({
  name: 'ultras',
  typeDefs: ULTRAS_TYPE_DEFS,
  resolvers: ultrasResolvers,
});
