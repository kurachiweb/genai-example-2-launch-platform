import { IDENTITY_TYPES } from '../../../../application/identity/identity-types.ts';
import type { TotpManagement } from '../../../../application/identity/totp-management.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { withInputPath } from '../../field-paths.ts';
import { INPUT_ARGUMENT } from './errors.ts';
import { ENABLE_TOTP_ARGS, RE_AUTHENTICATION_ARGS } from './inputs.ts';
import {
  accountGuard,
  clientOnly,
  issueSession,
  requestMetaOf,
} from './resolver-support.ts';

const totpManagement = (context: GraphQLContext): TotpManagement =>
  context.resolve<TotpManagement>(IDENTITY_TYPES.TotpManagement);

// 停止中・未確認の拒否は操作ごとに条件が異なるため、ユースケースが判定する
const requireUser = (context: GraphQLContext) =>
  accountGuard(context).requireUser(context.session);

export const totpResolvers = {
  Mutation: {
    startTotpSetup: clientOnly(
      withValidatedArgs(
        RE_AUTHENTICATION_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireUser(context);
          return withInputPath(INPUT_ARGUMENT, () =>
            totpManagement(context).start(
              current,
              input,
              requestMetaOf(context),
            ),
          );
        },
      ),
    ),
    enableTotp: clientOnly(
      withValidatedArgs(
        ENABLE_TOTP_ARGS,
        async (_parent: unknown, { totpCode }, context) => {
          const current = await requireUser(context);
          const { recoveryCodes, session } = await totpManagement(
            context,
          ).enable(current, totpCode, requestMetaOf(context));
          issueSession(context, session);
          return { codes: [...recoveryCodes] };
        },
      ),
    ),
    disableTotp: clientOnly(
      withValidatedArgs(
        RE_AUTHENTICATION_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireUser(context);
          const { session } = await withInputPath(INPUT_ARGUMENT, () =>
            totpManagement(context).disable(
              current,
              input,
              requestMetaOf(context),
            ),
          );
          issueSession(context, session);
          return true;
        },
      ),
    ),
    regenerateRecoveryCodes: clientOnly(
      withValidatedArgs(
        RE_AUTHENTICATION_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireUser(context);
          const { recoveryCodes, session } = await withInputPath(
            INPUT_ARGUMENT,
            () =>
              totpManagement(context).regenerateRecoveryCodes(
                current,
                input,
                requestMetaOf(context),
              ),
          );
          issueSession(context, session);
          return { codes: [...recoveryCodes] };
        },
      ),
    ),
  },
} satisfies Resolvers;
