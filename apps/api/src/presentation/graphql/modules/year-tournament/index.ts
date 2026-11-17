import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { boardResolvers } from './board-resolvers.ts';
import { bracketResolvers } from './bracket-resolvers.ts';
import { YEAR_TOURNAMENT_TYPE_DEFS } from './type-defs.ts';

const yearTournamentResolvers = {
  YearTournamentRoundBoard: boardResolvers.YearTournamentRoundBoard,
  Query: {
    ...boardResolvers.Query,
    ...bracketResolvers.Query,
  },
} satisfies Resolvers;

export const yearTournamentSchemaModule = defineSchemaModule({
  name: 'year-tournament',
  typeDefs: YEAR_TOURNAMENT_TYPE_DEFS,
  resolvers: yearTournamentResolvers,
});
