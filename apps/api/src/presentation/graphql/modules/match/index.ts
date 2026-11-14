import { defineSchemaModule } from '../../schema-module.ts';
import { boardResolvers } from './board-resolvers.ts';
import { matchViewResolvers } from './match-views.ts';
import { MATCH_TYPE_DEFS } from './type-defs.ts';
import { upvoteHistoryResolvers } from './upvote-history-resolvers.ts';
import { upvoteResolvers } from './upvote-resolvers.ts';

export const matchSchemaModule = defineSchemaModule({
  name: 'match',
  typeDefs: MATCH_TYPE_DEFS,
  resolvers: {
    ...matchViewResolvers,
    Query: { ...boardResolvers.Query, ...upvoteHistoryResolvers.Query },
    Mutation: { ...upvoteResolvers.Mutation },
  },
});
