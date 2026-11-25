import { getAppLogger } from '../../../../../lib/core/logging/app-logger.ts';
import type { WeekBoardReader } from '../../../../application/week-tournament/week-board-reader.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../../../../application/week-tournament/week-tournament-api-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { TOURNAMENT_BOARD_ARGS } from '../tournament/inputs.ts';
import { clientOnly, clockOf } from '../tournament/resolver-support.ts';
import { tournamentRoundBoardFieldResolvers } from '../tournament/round-board-resolvers.ts';
import { toWeekTournamentRoundBoard } from './mappers.ts';

const logger = getAppLogger(['api', 'presentation', 'week-tournament']);

const readerOf = (context: GraphQLContext): WeekBoardReader =>
  context.resolve<WeekBoardReader>(WEEK_TOURNAMENT_API_TYPES.WeekBoardReader);

// ログインを求めず、閲覧者のUpvoteと制限だけをセッションの利用者で変える
export const boardResolvers = {
  Query: {
    weekTournamentBoard: clientOnly(
      withValidatedArgs(
        TOURNAMENT_BOARD_ARGS,
        async (_parent: unknown, { date }, context) => {
          const now = clockOf(context).now();
          const rows = await readerOf(context).read(date, now);
          return {
            date,
            serverTime: now,
            rounds: rows.map(toWeekTournamentRoundBoard),
          };
        },
      ),
    ),
  },
  WeekTournamentRoundBoard: tournamentRoundBoardFieldResolvers({
    logger,
    message: 'Weekトーナメントの区画に置けないマッチを除きました',
  }),
} satisfies Resolvers;
