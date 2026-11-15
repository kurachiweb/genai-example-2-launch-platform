import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { getAppLogger } from '../../../../../lib/core/logging/app-logger.ts';
import type { EmailChange } from '../../../../application/identity/email-change.ts';
import type {
  EmailVerification,
  ResendVerificationResult,
} from '../../../../application/identity/email-verification.ts';
import { IDENTITY_TYPES } from '../../../../application/identity/identity-types.ts';
import type { Login } from '../../../../application/identity/login.ts';
import type { PasswordChange } from '../../../../application/identity/password-change.ts';
import type { PasswordReset } from '../../../../application/identity/password-reset.ts';
import type { Registration } from '../../../../application/identity/registration.ts';
import type { Withdrawal } from '../../../../application/identity/withdrawal.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { withInputPath } from '../../field-paths.ts';
import { INPUT_ARGUMENT, withNestedReAuthenticationPath } from './errors.ts';
import {
  COMPLETE_SECOND_FACTOR_LOGIN_ARGS,
  CONFIRM_CHANGE_ARGS,
  LOGIN_ARGS,
  RE_AUTHENTICATION_ARGS,
  REGISTER_USER_ARGS,
  REQUEST_EMAIL_CHANGE_ARGS,
  REQUEST_PASSWORD_CHANGE_ARGS,
  REQUEST_PASSWORD_RESET_ARGS,
  RESET_PASSWORD_ARGS,
  VERIFY_EMAIL_ARGS,
} from './inputs.ts';
import {
  accountGuard,
  assertHuman,
  BOT_ACTIONS,
  clientOnly,
  confirmationResult,
  countRemainingRecoveryCodes,
  issueSession,
  isViewerTotpEnabled,
  loadViewer,
  requestMetaOf,
  toViewer,
  type ViewerSource,
} from './resolver-support.ts';

type LoginResultSource =
  | { readonly viewer: ViewerSource }
  | { readonly challenge: string; readonly expiresAt: Date };

type LoginOutcome = 'authenticated' | 'second-factor-required';

const RESEND_RESULTS: Readonly<
  Record<ResendVerificationResult, 'SENT' | 'ALREADY_VERIFIED'>
> = Object.freeze({ sent: 'SENT', 'already-verified': 'ALREADY_VERIFIED' });

const loginLogger = getAppLogger(['api', 'identity', 'login']);

const loginUseCase = (context: GraphQLContext): Login =>
  context.resolve<Login>(IDENTITY_TYPES.Login);

// ログインの成否と理由だけを残し、メールアドレス・IPアドレス・トークンは属性に入れない
async function loggedLogin<T>(
  run: () => Promise<{
    readonly result: T;
    readonly outcome: LoginOutcome;
    readonly userId: string;
  }>,
): Promise<T> {
  try {
    const { result, outcome, userId } = await run();
    loginLogger.info('ログインの段階を通過しました', { outcome, userId });
    return result;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      loginLogger.warn('ログインを拒否しました', { reason: error.code });
    }
    throw error;
  }
}

export const accountResolvers = {
  Query: {
    viewer: clientOnly(async (_parent: unknown, _args: unknown, context) => {
      const current = await accountGuard(context).currentUser(context.session);
      return current === undefined ? null : toViewer(current.user);
    }),
  },
  Viewer: {
    totpEnabled: (
      parent: ViewerSource,
      _args: unknown,
      context: GraphQLContext,
    ) => isViewerTotpEnabled(context, parent.id),
    remainingRecoveryCodes: (
      parent: ViewerSource,
      _args: unknown,
      context: GraphQLContext,
    ) => countRemainingRecoveryCodes(context, parent.id),
  },
  LoginResult: {
    __resolveType: (result: object) =>
      'viewer' in result ? 'LoginSucceeded' : 'SecondFactorRequired',
  },
  Mutation: {
    registerUser: clientOnly(
      withValidatedArgs(
        REGISTER_USER_ARGS,
        async (_parent: unknown, { input }, context) => {
          await assertHuman(context, BOT_ACTIONS.register);
          const { userId, session } = await withInputPath(INPUT_ARGUMENT, () =>
            context
              .resolve<Registration>(IDENTITY_TYPES.Registration)
              .register(input, requestMetaOf(context)),
          );
          issueSession(context, session);
          return loadViewer(context, userId);
        },
      ),
    ),
    login: clientOnly(
      withValidatedArgs(LOGIN_ARGS, (_parent: unknown, { input }, context) =>
        loggedLogin<LoginResultSource>(async () => {
          await assertHuman(context, BOT_ACTIONS.login);
          const result = await loginUseCase(context).withPassword(
            input,
            requestMetaOf(context),
          );
          if (result.kind === 'second-factor-required') {
            return {
              result: {
                challenge: result.challenge,
                expiresAt: result.expiresAt,
              },
              outcome: result.kind,
              userId: result.userId,
            };
          }
          issueSession(context, result.session);
          return {
            result: { viewer: await loadViewer(context, result.userId) },
            outcome: result.kind,
            userId: result.userId,
          };
        }),
      ),
    ),
    completeSecondFactorLogin: clientOnly(
      withValidatedArgs(
        COMPLETE_SECOND_FACTOR_LOGIN_ARGS,
        (_parent: unknown, { input }, context) =>
          loggedLogin(async () => {
            const { userId, session } = await loginUseCase(
              context,
            ).withSecondFactor(input, requestMetaOf(context));
            issueSession(context, session);
            return {
              result: await loadViewer(context, userId),
              outcome: 'authenticated' as const,
              userId,
            };
          }),
      ),
    ),
    logout: clientOnly(async (_parent: unknown, _args: unknown, context) => {
      const principal = await context.session.requireAuthenticated();
      await loginUseCase(context).logout(principal);
      context.session.clear();
      return true;
    }),
    resendVerificationEmail: clientOnly(
      async (_parent: unknown, _args: unknown, context) => {
        const result = await context
          .resolve<EmailVerification>(IDENTITY_TYPES.EmailVerification)
          .resend(context.session, requestMetaOf(context));
        return RESEND_RESULTS[result];
      },
    ),
    verifyEmail: clientOnly(
      withValidatedArgs(
        VERIFY_EMAIL_ARGS,
        async (_parent: unknown, { token }, context) => {
          await context
            .resolve<EmailVerification>(IDENTITY_TYPES.EmailVerification)
            .verify(token, requestMetaOf(context));
          return true;
        },
      ),
    ),
    requestPasswordReset: clientOnly(
      withValidatedArgs(
        REQUEST_PASSWORD_RESET_ARGS,
        async (_parent: unknown, { email }, context) => {
          await assertHuman(context, BOT_ACTIONS.passwordReset);
          await context
            .resolve<PasswordReset>(IDENTITY_TYPES.PasswordReset)
            .request(email, requestMetaOf(context));
          return true;
        },
      ),
    ),
    resetPassword: clientOnly(
      withValidatedArgs(
        RESET_PASSWORD_ARGS,
        async (_parent: unknown, { input }, context) => {
          await withInputPath(INPUT_ARGUMENT, () =>
            context
              .resolve<PasswordReset>(IDENTITY_TYPES.PasswordReset)
              .complete(input, requestMetaOf(context)),
          );
          return true;
        },
      ),
    ),
    requestEmailChange: clientOnly(
      withValidatedArgs(
        REQUEST_EMAIL_CHANGE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await accountGuard(context).requireWritableUser(
            context.session,
          );
          await assertHuman(context, BOT_ACTIONS.emailChange);
          await withNestedReAuthenticationPath(() =>
            context
              .resolve<EmailChange>(IDENTITY_TYPES.EmailChange)
              .request(current, input, requestMetaOf(context)),
          );
          return true;
        },
      ),
    ),
    confirmEmailChange: clientOnly(
      withValidatedArgs(
        CONFIRM_CHANGE_ARGS,
        async (_parent: unknown, { token }, context) => {
          const operator = await context.session.principal();
          const { session } = await context
            .resolve<EmailChange>(IDENTITY_TYPES.EmailChange)
            .confirm(token, operator, requestMetaOf(context));
          return confirmationResult(context, operator, session);
        },
      ),
    ),
    requestPasswordChange: clientOnly(
      withValidatedArgs(
        REQUEST_PASSWORD_CHANGE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await accountGuard(context).requireWritableUser(
            context.session,
          );
          await assertHuman(context, BOT_ACTIONS.passwordChange);
          await withNestedReAuthenticationPath(() =>
            context
              .resolve<PasswordChange>(IDENTITY_TYPES.PasswordChange)
              .request(current, input, requestMetaOf(context)),
          );
          return true;
        },
      ),
    ),
    confirmPasswordChange: clientOnly(
      withValidatedArgs(
        CONFIRM_CHANGE_ARGS,
        async (_parent: unknown, { token }, context) => {
          const operator = await context.session.principal();
          const { session } = await context
            .resolve<PasswordChange>(IDENTITY_TYPES.PasswordChange)
            .confirm(token, operator, requestMetaOf(context));
          return confirmationResult(context, operator, session);
        },
      ),
    ),
    withdraw: clientOnly(
      withValidatedArgs(
        RE_AUTHENTICATION_ARGS,
        async (_parent: unknown, { input }, context) => {
          // 停止中の利用者も退会できるよう、書き込みの可否を問わない
          const current = await accountGuard(context).requireUser(
            context.session,
          );
          await assertHuman(context, BOT_ACTIONS.withdraw);
          await withInputPath(INPUT_ARGUMENT, () =>
            context
              .resolve<Withdrawal>(IDENTITY_TYPES.Withdrawal)
              .withdraw(current, input, requestMetaOf(context)),
          );
          context.session.clear();
          return true;
        },
      ),
    ),
  },
} satisfies Resolvers;
