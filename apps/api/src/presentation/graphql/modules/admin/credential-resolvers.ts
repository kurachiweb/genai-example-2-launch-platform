import type { AdminEmailChange } from '../../../../application/admin/admin-email-change.ts';
import type { AdminInvitation } from '../../../../application/admin/admin-invitation.ts';
import type { AdminPasswordReset } from '../../../../application/admin/admin-password-reset.ts';
import { ADMIN_TYPES } from '../../../../application/admin/admin-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  COMPLETE_ADMIN_INVITATION_ARGS,
  CONFIRM_ADMIN_EMAIL_CHANGE_ARGS,
  REQUEST_ADMIN_PASSWORD_RESET_ARGS,
  RESET_ADMIN_PASSWORD_ARGS,
  START_ADMIN_INVITATION_ARGS,
} from './inputs.ts';
import {
  ADMIN_BOT_ACTIONS,
  adminConfirmationResult,
  adminOnly,
  adminRequestMetaOf,
  assertHuman,
  issueSession,
} from './resolver-support.ts';

const passwordReset = (context: GraphQLContext): AdminPasswordReset =>
  context.resolve<AdminPasswordReset>(ADMIN_TYPES.AdminPasswordReset);

const invitation = (context: GraphQLContext): AdminInvitation =>
  context.resolve<AdminInvitation>(ADMIN_TYPES.AdminInvitation);

// ユースケースは詳細の欄を引数と同じ名前(nickname・password・newPassword)で返すため、経路を付け直さない
export const credentialResolvers = {
  Mutation: {
    requestAdminPasswordReset: adminOnly(
      withValidatedArgs(
        REQUEST_ADMIN_PASSWORD_RESET_ARGS,
        async (_parent: unknown, { email }, context) => {
          await assertHuman(context, ADMIN_BOT_ACTIONS.passwordReset);
          await passwordReset(context).request(
            email,
            adminRequestMetaOf(context),
          );
          return true;
        },
      ),
    ),
    resetAdminPassword: adminOnly(
      withValidatedArgs(
        RESET_ADMIN_PASSWORD_ARGS,
        async (_parent: unknown, input, context) => {
          await passwordReset(context).complete(
            input,
            adminRequestMetaOf(context),
          );
          return true;
        },
      ),
    ),
    startAdminInvitation: adminOnly(
      withValidatedArgs(
        START_ADMIN_INVITATION_ARGS,
        (_parent: unknown, input, context) =>
          invitation(context).start(input, adminRequestMetaOf(context)),
      ),
    ),
    completeAdminInvitation: adminOnly(
      withValidatedArgs(
        COMPLETE_ADMIN_INVITATION_ARGS,
        async (_parent: unknown, input, context) => {
          const { recoveryCodes, session } = await invitation(context).complete(
            input,
            adminRequestMetaOf(context),
          );
          issueSession(context, session);
          return { codes: [...recoveryCodes] };
        },
      ),
    ),
    confirmAdminEmailChange: adminOnly(
      withValidatedArgs(
        CONFIRM_ADMIN_EMAIL_CHANGE_ARGS,
        async (_parent: unknown, { token }, context) => {
          const operator = await context.session.principal();
          const { session } = await context
            .resolve<AdminEmailChange>(ADMIN_TYPES.AdminEmailChange)
            .confirm(token, operator, adminRequestMetaOf(context));
          return adminConfirmationResult(context, operator, session);
        },
      ),
    ),
  },
} satisfies Resolvers;
