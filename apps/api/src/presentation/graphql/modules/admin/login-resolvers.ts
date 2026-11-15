import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { getAppLogger } from '../../../../../lib/core/logging/app-logger.ts';
import type { AdminLogin } from '../../../../application/admin/admin-login.ts';
import { ADMIN_TYPES } from '../../../../application/admin/admin-types.ts';
import type { AdminRecoveryCodeStore } from '../../../../application/admin/ports.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  ADMIN_LOGIN_ARGS,
  COMPLETE_ADMIN_SECOND_FACTOR_LOGIN_ARGS,
} from './inputs.ts';
import {
  ADMIN_BOT_ACTIONS,
  adminOnly,
  adminRequestMetaOf,
  type AdminViewerSource,
  assertHuman,
  avatarOf,
  currentAdminViewer,
  issueSession,
  loadAdminViewer,
} from './resolver-support.ts';

type AdminLoginOutcome = 'authenticated' | 'second-factor-required';

const loginLogger = getAppLogger(['api', 'admin', 'login']);

const loginUseCase = (context: GraphQLContext): AdminLogin =>
  context.resolve<AdminLogin>(ADMIN_TYPES.AdminLogin);

// ログインの成否と理由だけを残し、メールアドレス・IPアドレス・トークンは属性に入れない
async function loggedLogin<T>(
  run: () => Promise<{
    readonly result: T;
    readonly outcome: AdminLoginOutcome;
    readonly adminId: string;
  }>,
): Promise<T> {
  try {
    const { result, outcome, adminId } = await run();
    loginLogger.info('管理者のログインの段階を通過しました', {
      outcome,
      adminId,
    });
    return result;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      loginLogger.warn('管理者のログインを拒否しました', {
        reason: error.code,
      });
    }
    throw error;
  }
}

export const loginResolvers = {
  Query: {
    adminViewer: adminOnly(
      (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        currentAdminViewer(context),
    ),
  },
  AdminViewer: {
    avatar: (
      parent: AdminViewerSource,
      _args: unknown,
      context: GraphQLContext,
    ) => avatarOf(parent, context),
    remainingRecoveryCodes: (
      parent: AdminViewerSource,
      _args: unknown,
      context: GraphQLContext,
    ) =>
      context
        .resolve<AdminRecoveryCodeStore>(ADMIN_TYPES.AdminRecoveryCodeStore)
        .count(parent.id),
  },
  Mutation: {
    adminLogin: adminOnly(
      withValidatedArgs(ADMIN_LOGIN_ARGS, (_parent: unknown, input, context) =>
        loggedLogin(async () => {
          await assertHuman(context, ADMIN_BOT_ACTIONS.login);
          const { adminId, challenge, expiresAt } = await loginUseCase(
            context,
          ).withPassword(input, adminRequestMetaOf(context));
          return {
            result: { challenge, expiresAt },
            outcome: 'second-factor-required' as const,
            adminId,
          };
        }),
      ),
    ),
    completeAdminSecondFactorLogin: adminOnly(
      withValidatedArgs(
        COMPLETE_ADMIN_SECOND_FACTOR_LOGIN_ARGS,
        (_parent: unknown, input, context) =>
          loggedLogin(async () => {
            const { adminId, session } = await loginUseCase(
              context,
            ).withSecondFactor(input, adminRequestMetaOf(context));
            issueSession(context, session);
            return {
              result: await loadAdminViewer(context, adminId),
              outcome: 'authenticated' as const,
              adminId,
            };
          }),
      ),
    ),
    adminLogout: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        const principal = await context.session.requireAuthenticated();
        await loginUseCase(context).logout(principal);
        context.session.clear();
        return true;
      },
    ),
  },
} satisfies Resolvers;
