import type { AdminEmailChange } from '../../../../application/admin/admin-email-change.ts';
import type { AdminPasswordChange } from '../../../../application/admin/admin-password-change.ts';
import type {
  AdminTotpManagement,
  IssuedAdminRecoveryCodes,
} from '../../../../application/admin/admin-totp-management.ts';
import { ADMIN_TYPES } from '../../../../application/admin/admin-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  CHANGE_ADMIN_PASSWORD_ARGS,
  COMPLETE_ADMIN_TOTP_RESET_ARGS,
  RE_AUTHENTICATION_ARGS,
  REQUEST_ADMIN_EMAIL_CHANGE_ARGS,
} from './inputs.ts';
import {
  adminOnly,
  adminRequestMetaOf,
  issueSession,
  withReAuthenticationPath,
} from './resolver-support.ts';

const totpManagement = (context: GraphQLContext): AdminTotpManagement =>
  context.resolve<AdminTotpManagement>(ADMIN_TYPES.AdminTotpManagement);

// 自分のアカウントの操作は全ロールに許し、対象をログイン中の管理者に限る
const requireSelf = (context: GraphQLContext) =>
  requireAdmin(context, 'viewer');

// ユースケースは全端末のセッションを消した後に操作した端末へ渡すセッションを返すため、応答でセッションを入れ替える
function reissuedRecoveryCodes(
  context: GraphQLContext,
  { recoveryCodes, session }: IssuedAdminRecoveryCodes,
): { readonly codes: string[] } {
  issueSession(context, session);
  return { codes: [...recoveryCodes] };
}

export const selfResolvers = {
  Mutation: {
    requestAdminEmailChange: adminOnly(
      withValidatedArgs(
        REQUEST_ADMIN_EMAIL_CHANGE_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireSelf(context);
          await withReAuthenticationPath(() =>
            context
              .resolve<AdminEmailChange>(ADMIN_TYPES.AdminEmailChange)
              .request(current, input, adminRequestMetaOf(context)),
          );
          return true;
        },
      ),
    ),
    changeAdminPassword: adminOnly(
      withValidatedArgs(
        CHANGE_ADMIN_PASSWORD_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireSelf(context);
          const { session } = await withReAuthenticationPath(() =>
            context
              .resolve<AdminPasswordChange>(ADMIN_TYPES.AdminPasswordChange)
              .change(current, input, adminRequestMetaOf(context)),
          );
          issueSession(context, session);
          return true;
        },
      ),
    ),
    startAdminTotpReset: adminOnly(
      withValidatedArgs(
        RE_AUTHENTICATION_ARGS,
        async (_parent: unknown, { reAuthentication }, context) => {
          const current = await requireSelf(context);
          return withReAuthenticationPath(() =>
            totpManagement(context).startReset(
              current,
              reAuthentication,
              adminRequestMetaOf(context),
            ),
          );
        },
      ),
    ),
    completeAdminTotpReset: adminOnly(
      withValidatedArgs(
        COMPLETE_ADMIN_TOTP_RESET_ARGS,
        async (_parent: unknown, { totpCode }, context) => {
          const current = await requireSelf(context);
          const issued = await totpManagement(context).completeReset(
            current,
            totpCode,
            adminRequestMetaOf(context),
          );
          return reissuedRecoveryCodes(context, issued);
        },
      ),
    ),
    regenerateAdminRecoveryCodes: adminOnly(
      withValidatedArgs(
        RE_AUTHENTICATION_ARGS,
        async (_parent: unknown, { reAuthentication }, context) => {
          const current = await requireSelf(context);
          const issued = await withReAuthenticationPath(() =>
            totpManagement(context).regenerateRecoveryCodes(
              current,
              reAuthentication,
              adminRequestMetaOf(context),
            ),
          );
          return reissuedRecoveryCodes(context, issued);
        },
      ),
    ),
  },
} satisfies Resolvers;
