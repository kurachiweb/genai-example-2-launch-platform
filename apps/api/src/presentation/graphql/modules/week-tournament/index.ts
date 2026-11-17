import type { Resolvers } from '../../generated/resolvers-types.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { boardResolvers } from './board-resolvers.ts';
import { bracketResolvers } from './bracket-resolvers.ts';
import { bracketViewResolvers } from './bracket-views.ts';
import { trophyResolvers } from './trophy-resolvers.ts';
import { WEEK_TOURNAMENT_TYPE_DEFS } from './type-defs.ts';

const weekTournamentResolvers = {
  ...bracketViewResolvers,
  WeekTournamentRoundBoard: boardResolvers.WeekTournamentRoundBoard,
  Query: {
    ...boardResolvers.Query,
    ...bracketResolvers.Query,
    ...trophyResolvers.Query,
  },
} satisfies Resolvers;

export const weekTournamentSchemaModule = defineSchemaModule({
  name: 'week-tournament',
  typeDefs: WEEK_TOURNAMENT_TYPE_DEFS,
  resolvers: weekTournamentResolvers,
});
