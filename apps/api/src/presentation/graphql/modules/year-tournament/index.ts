import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { boardResolvers } from './board-resolvers.ts';
import { bracketResolvers } from './bracket-resolvers.ts';
import { entryResolvers } from './entry-resolvers.ts';
import { finalDateResolvers } from './final-date-resolvers.ts';
import { YEAR_TOURNAMENT_TYPE_DEFS } from './type-defs.ts';

const yearTournamentResolvers = {
  YearTournamentRoundBoard: boardResolvers.YearTournamentRoundBoard,
  Query: {
    ...boardResolvers.Query,
    ...bracketResolvers.Query,
    ...entryResolvers.Query,
    ...finalDateResolvers.Query,
  },
  Mutation: {
    ...entryResolvers.Mutation,
    ...finalDateResolvers.Mutation,
  },
} satisfies Resolvers;

export const yearTournamentSchemaModule = defineSchemaModule({
  name: 'year-tournament',
  typeDefs: YEAR_TOURNAMENT_TYPE_DEFS,
  resolvers: yearTournamentResolvers,
});
