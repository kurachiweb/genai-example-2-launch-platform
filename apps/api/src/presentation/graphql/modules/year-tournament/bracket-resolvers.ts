import type { YearBracketReader } from '../../../../application/year-tournament/year-bracket-reader.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../../../../application/year-tournament/year-tournament-api-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { toYearBracket } from './mappers.ts';
import {
  accountGuardOf,
  clientOnly,
  clockOf,
} from '../tournament/resolver-support.ts';

const readerOf = (context: GraphQLContext): YearBracketReader =>
  context.resolve<YearBracketReader>(
    YEAR_TOURNAMENT_API_TYPES.YearBracketReader,
  );

// ログインを求めない。年の形式の違反・行の無い年・組み合わせの決定の前は区別せずnullにする
export const bracketResolvers = {
  Query: {
    yearBracket: clientOnly(
      async (_parent: unknown, args: { year: string }, context) => {
        const viewer = await accountGuardOf(context).currentUser(
          context.session,
        );
        const view = await readerOf(context).read({
          year: args.year,
          viewer,
          now: clockOf(context).now(),
        });
        return view === undefined ? null : toYearBracket(view);
      },
    ),
  },
} satisfies Resolvers;
