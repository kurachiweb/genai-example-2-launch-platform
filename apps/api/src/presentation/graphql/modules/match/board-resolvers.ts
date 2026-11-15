import { MATCH_TYPES } from '../../../../application/match/match-types.ts';
import type { QualifierBoardReader } from '../../../../application/match/qualifier-board-reader.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { toQualifierBoard } from './mappers.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

const readerOf = (context: GraphQLContext): QualifierBoardReader =>
  context.resolve<QualifierBoardReader>(MATCH_TYPES.QualifierBoardReader);

// ログインを求めず、閲覧者のUpvoteと制限だけをセッションの利用者で変える
export const boardResolvers = {
  Query: {
    qualifierBoard: clientOnly(async (_parent: unknown, _args, context) => {
      const viewer = await accountGuardOf(context).currentUser(context.session);
      const board = await readerOf(context).read({
        viewer,
        now: clockOf(context).now(),
      });
      return toQualifierBoard(board);
    }),
  },
} satisfies Resolvers;
