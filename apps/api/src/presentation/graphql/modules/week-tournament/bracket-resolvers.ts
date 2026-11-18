import type { WeekBracketReader } from '../../../../application/week-tournament/week-bracket-reader.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../../../../application/week-tournament/week-tournament-api-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { toWeekBracket } from './mappers.ts';
import {
  accountGuardOf,
  clientOnly,
  clockOf,
} from '../tournament/resolver-support.ts';

const readerOf = (context: GraphQLContext): WeekBracketReader =>
  context.resolve<WeekBracketReader>(
    WEEK_TOURNAMENT_API_TYPES.WeekBracketReader,
  );

// ログインを求めない。週の形式の違反・存在しない週・組み合わせの決定の前は区別せずnullにする
export const bracketResolvers = {
  Query: {
    weekBracket: clientOnly(
      async (_parent: unknown, args: { week: string }, context) => {
        const viewer = await accountGuardOf(context).currentUser(
          context.session,
        );
        const view = await readerOf(context).read({
          week: args.week,
          viewer,
          now: clockOf(context).now(),
        });
        return view === undefined ? null : toWeekBracket(view);
      },
    ),
  },
} satisfies Resolvers;
