import type { WeekEntryCheckout } from '../../../../application/week-tournament/week-entry-checkout.ts';
import type { WeekEntryPanelReader } from '../../../../application/week-tournament/week-entry-panel-reader.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../../../../application/week-tournament/week-tournament-api-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { START_WEEK_TOURNAMENT_CHECKOUT_ARGS } from './inputs.ts';
import { toWeekEntryPanel } from './mappers.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

const panelReaderOf = (context: GraphQLContext): WeekEntryPanelReader =>
  context.resolve<WeekEntryPanelReader>(
    WEEK_TOURNAMENT_API_TYPES.WeekEntryPanelReader,
  );

const checkoutOf = (context: GraphQLContext): WeekEntryCheckout =>
  context.resolve<WeekEntryCheckout>(
    WEEK_TOURNAMENT_API_TYPES.WeekEntryCheckout,
  );

// 他人の決済の状態を返さないよう、導線はログインした投稿者本人のプロダクトだけに返す。
// 決済の開始の認証・確認済みの判定・回数制限・枠の判定・受付期限はpaymentsの決済の開始が行う
export const entryResolvers = {
  Query: {
    myWeekEntry: clientOnly(
      async (_parent: unknown, args: { productHandle: string }, context) => {
        const viewer = await accountGuardOf(context).requireUser(
          context.session,
        );
        const now = clockOf(context).now();
        const panel = await panelReaderOf(context).readForOwner(
          viewer,
          args.productHandle,
          now,
        );
        return panel === null ? null : toWeekEntryPanel(panel, now);
      },
    ),
  },
  Mutation: {
    startWeekTournamentCheckout: clientOnly(
      withValidatedArgs(
        START_WEEK_TOURNAMENT_CHECKOUT_ARGS,
        async (_parent: unknown, { launchId }, context) => {
          const { purchaseId } = await checkoutOf(context).start(
            context.session,
            launchId,
          );
          return { purchaseId };
        },
      ),
    ),
  },
} satisfies Resolvers;
