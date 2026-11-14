import { IDENTITY_TYPES } from '../../../../application/identity/identity-types.ts';
import type { SessionManagement } from '../../../../application/identity/session-management.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { REVOKE_SESSION_ARGS } from './inputs.ts';
import { accountGuard, clientOnly, requestMetaOf } from './resolver-support.ts';

const sessionManagement = (context: GraphQLContext): SessionManagement =>
  context.resolve<SessionManagement>(IDENTITY_TYPES.SessionManagement);

// 停止中の利用者も、乗っ取りに気づいたときに他の端末を締め出せるよう、セッションの一覧と失効を使える
const requirePrincipal = async (context: GraphQLContext) =>
  (await accountGuard(context).requireUser(context.session)).principal;

export const sessionResolvers = {
  Query: {
    mySessions: clientOnly(
      async (_parent: unknown, _args: unknown, context) => [
        ...(await sessionManagement(context).list(
          await requirePrincipal(context),
          requestMetaOf(context).now,
        )),
      ],
    ),
  },
  Mutation: {
    revokeSession: clientOnly(
      withValidatedArgs(
        REVOKE_SESSION_ARGS,
        async (_parent: unknown, { id }, context) => {
          const { revokedCurrent } = await sessionManagement(context).revoke(
            await requirePrincipal(context),
            id,
          );
          if (revokedCurrent) {
            context.session.clear();
          }
          return true;
        },
      ),
    ),
    revokeOtherSessions: clientOnly(
      async (_parent: unknown, _args: unknown, context) =>
        sessionManagement(context).revokeOthers(
          await requirePrincipal(context),
        ),
    ),
  },
} satisfies Resolvers;
