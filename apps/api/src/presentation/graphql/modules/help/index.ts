import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { adminCategoryResolvers } from './admin-category-resolvers.ts';
import { HELP_TYPE_DEFS } from './type-defs.ts';

const helpResolvers = {
  Query: { ...adminCategoryResolvers.Query },
  Mutation: { ...adminCategoryResolvers.Mutation },
} satisfies Resolvers;

export const helpSchemaModule = defineSchemaModule({
  name: 'help',
  typeDefs: HELP_TYPE_DEFS,
  resolvers: helpResolvers,
});
