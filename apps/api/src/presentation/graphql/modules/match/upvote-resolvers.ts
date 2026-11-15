import type { MatchView } from '../../../../application/match/match-view-reader.ts';
import { matchError } from '../../../../application/match/match-errors.ts';
import { MATCH_TYPES } from '../../../../application/match/match-types.ts';
import type { UpvoteService } from '../../../../application/match/upvote-service.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { INPUT_ARGUMENT } from './errors.ts';
import { CANCEL_UPVOTE_ARGS, UPVOTE_ARGS } from './inputs.ts';
import { loadMatchView } from './match-views.ts';
import {
  accountGuardOf,
  assertHuman,
  clientOnly,
  clockOf,
  MATCH_BOT_ACTIONS,
} from './resolver-support.ts';

const serviceOf = (context: GraphQLContext): UpvoteService =>
  context.resolve<UpvoteService>(MATCH_TYPES.UpvoteService);

async function updatedMatchOf(
  context: GraphQLContext,
  matchId: string,
): Promise<MatchView> {
  const view = await loadMatchView(context, matchId);
  if (view === null) {
    throw matchError('match_not_found');
  }
  return view;
}

// 取り消しはユースケースが利用者の状態を見ないため、どちらの操作もここでメールアドレスの確認済みの利用者に限る。
// bot判定は状態の確認の後に行い、拒否できる要求でトークンを消費させない
export const upvoteResolvers = {
  Mutation: {
    upvote: clientOnly(
      withValidatedArgs(
        UPVOTE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const user = await accountGuardOf(context).requireVerifiedUser(
            context.session,
          );
          await assertHuman(context, MATCH_BOT_ACTIONS.upvote);
          await withInputPath(INPUT_ARGUMENT, () =>
            serviceOf(context).upvote({
              user,
              matchId: input.matchId,
              entryId: input.entryId,
              now: clockOf(context).now(),
            }),
          );
          return updatedMatchOf(context, input.matchId);
        },
      ),
    ),
    cancelUpvote: clientOnly(
      withValidatedArgs(
        CANCEL_UPVOTE_ARGS,
        async (_parent: unknown, { matchId }, context) => {
          const user = await accountGuardOf(context).requireVerifiedUser(
            context.session,
          );
          await assertHuman(context, MATCH_BOT_ACTIONS.upvote);
          await serviceOf(context).cancel({
            user,
            matchId,
            now: clockOf(context).now(),
          });
          return updatedMatchOf(context, matchId);
        },
      ),
    ),
  },
} satisfies Resolvers;
