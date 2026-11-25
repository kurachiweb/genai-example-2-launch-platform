import { getAppLogger } from '../../../../../lib/core/logging/app-logger.ts';
import type { YearBoardReader } from '../../../../application/year-tournament/year-board-reader.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../../../../application/year-tournament/year-tournament-api-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { TOURNAMENT_BOARD_ARGS } from '../tournament/inputs.ts';
import { clientOnly, clockOf } from '../tournament/resolver-support.ts';
import { tournamentRoundBoardFieldResolvers } from '../tournament/round-board-resolvers.ts';
import { toYearTournamentRoundBoard } from './mappers.ts';

const logger = getAppLogger(['api', 'presentation', 'year-tournament']);

const readerOf = (context: GraphQLContext): YearBoardReader =>
  context.resolve<YearBoardReader>(YEAR_TOURNAMENT_API_TYPES.YearBoardReader);

// ログインを求めず、閲覧者のUpvoteと制限だけをセッションの利用者で変える
export const boardResolvers = {
  Query: {
    yearTournamentBoard: clientOnly(
      withValidatedArgs(
        TOURNAMENT_BOARD_ARGS,
        async (_parent: unknown, { date }, context) => {
          const now = clockOf(context).now();
          const rows = await readerOf(context).read(date, now);
          return {
            date,
            serverTime: now,
            rounds: rows.map(toYearTournamentRoundBoard),
          };
        },
      ),
    ),
  },
  YearTournamentRoundBoard: tournamentRoundBoardFieldResolvers({
    logger,
    message: 'Yearトーナメントの区画に置けないマッチを除きました',
  }),
} satisfies Resolvers;
