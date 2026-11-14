import { NOTIFICATIONS_TYPES } from '../../../../application/notifications/notifications-types.ts';
import type { UnsubscribeService } from '../../../../application/notifications/unsubscribe-service.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { UNSUBSCRIBE_TOKEN_ARGS } from './inputs.ts';
import { toNotificationUnsubscribeLink } from './mappers.ts';
import { clientOnly, clockOf } from './resolver-support.ts';

const unsubscribeOf = (context: GraphQLContext): UnsubscribeService =>
  context.resolve<UnsubscribeService>(NOTIFICATIONS_TYPES.UnsubscribeService);

// メールのリンクから開くためログインを求めない。トークンは要求の本文で受け取り、ログや例外に載せない
export const unsubscribeResolvers = {
  Query: {
    notificationUnsubscribeLink: clientOnly(
      withValidatedArgs(
        UNSUBSCRIBE_TOKEN_ARGS,
        async (_parent: unknown, { token }, context) => {
          const view = await unsubscribeOf(context).inspect(token);
          return view === null ? null : toNotificationUnsubscribeLink(view);
        },
      ),
    ),
  },
  Mutation: {
    confirmNotificationUnsubscribe: clientOnly(
      withValidatedArgs(
        UNSUBSCRIBE_TOKEN_ARGS,
        async (_parent: unknown, { token }, context) => {
          const { topic } = await unsubscribeOf(context).confirm(
            token,
            clockOf(context).now(),
          );
          // 既に停止していた場合も、確定の後は受信しない設定になっている
          return toNotificationUnsubscribeLink({ topic, enabled: false });
        },
      ),
    ),
  },
} satisfies Resolvers;
