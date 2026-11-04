import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { publicResolvers } from './public-resolvers.ts';
import { LEGAL_TYPE_DEFS } from './type-defs.ts';

const legalResolvers = {
  Query: { ...publicResolvers.Query },
} satisfies Resolvers;

export const legalSchemaModule = defineSchemaModule({
  name: 'legal',
  typeDefs: LEGAL_TYPE_DEFS,
  resolvers: legalResolvers,
});
