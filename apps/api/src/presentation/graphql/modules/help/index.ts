import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { adminArticleResolvers } from './admin-article-resolvers.ts';
import { adminCategoryResolvers } from './admin-category-resolvers.ts';
import { helpAuthorFieldResolvers } from './author-fields.ts';
import { publicResolvers } from './public-resolvers.ts';
import { HELP_TYPE_DEFS } from './type-defs.ts';

const helpResolvers = {
  ...helpAuthorFieldResolvers,
  HelpArticleResult: publicResolvers.HelpArticleResult,
  Query: {
    ...publicResolvers.Query,
    ...adminArticleResolvers.Query,
    ...adminCategoryResolvers.Query,
  },
  Mutation: {
    ...adminArticleResolvers.Mutation,
    ...adminCategoryResolvers.Mutation,
  },
} satisfies Resolvers;

export const helpSchemaModule = defineSchemaModule({
  name: 'help',
  typeDefs: HELP_TYPE_DEFS,
  resolvers: helpResolvers,
});
