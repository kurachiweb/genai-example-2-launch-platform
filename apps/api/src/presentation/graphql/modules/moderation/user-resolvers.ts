import { downloadPathOf } from '../../../../../common-lib/media/upload-protocol.ts';
import type { DisposableEmailJudgement } from '../../../../../common-lib/moderation/moderation-labels.ts';
import type { AdministrativeWithdrawalService } from '../../../../application/moderation/administrative-withdrawal-service.ts';
import type {
  AdminUserReader,
  AdminUserView,
} from '../../../../application/moderation/admin-user-reader.ts';
import { MODERATION_TYPES } from '../../../../application/moderation/moderation-types.ts';
import type { ModerationOutcome } from '../../../../application/moderation/ports.ts';
import type { UserModerationService } from '../../../../application/moderation/user-moderation-service.ts';
import { withInputPath } from '../../field-paths.ts';
import type {
  AdminUser,
  DisposableEmailCheck,
  ModerationOutcome as GraphQLModerationOutcome,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { toModerationError } from './errors.ts';
import {
  ADMIN_USER_STATUSES,
  ADMIN_USERS_ARGS,
  ADMINISTRATIVE_WITHDRAWAL_ARGS,
  QUARANTINE_REASONS,
  USER_MODERATION_ARGS,
} from './inputs.ts';
import {
  adminOnly,
  clockOf,
  moderationOperatorOf,
  toModerationConnection,
} from './resolver-support.ts';

const DISPOSABLE_EMAIL_CHECKS = Object.freeze({
  disposable: 'DISPOSABLE',
  regular: 'REGULAR',
  undetermined: 'UNDETERMINED',
  unverified: 'UNVERIFIED',
} as const satisfies Record<DisposableEmailJudgement, DisposableEmailCheck>);

// 入力の写しの表を逆に引き、上流の値をGraphQLの列挙の値へ戻す
const invert = <TKey extends string, TValue extends string>(
  table: Readonly<Record<TKey, TValue>>,
): Readonly<Record<TValue, TKey>> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(table).map(([key, value]) => [value, key]),
    ) as Record<TValue, TKey>,
  );

const STATUS_OF = invert(ADMIN_USER_STATUSES);

const QUARANTINE_REASON_OF = invert(QUARANTINE_REASONS);

const readerOf = (context: GraphQLContext): AdminUserReader =>
  context.resolve<AdminUserReader>(MODERATION_TYPES.AdminUserReader);

const moderationOf = (context: GraphQLContext): UserModerationService =>
  context.resolve<UserModerationService>(
    MODERATION_TYPES.UserModerationService,
  );

const withdrawalOf = (
  context: GraphQLContext,
): AdministrativeWithdrawalService =>
  context.resolve<AdministrativeWithdrawalService>(
    MODERATION_TYPES.AdministrativeWithdrawalService,
  );

const toAdminUser = (view: AdminUserView): AdminUser => ({
  id: view.userId,
  handle: view.handle,
  nickname: view.nickname,
  avatar:
    view.avatar === null
      ? null
      : {
          id: view.avatar.fileId,
          path: downloadPathOf(view.avatar.fileId),
          quarantined: view.avatar.quarantined,
          quarantineReasons: view.avatar.quarantineReasons.map(
            (reason) => QUARANTINE_REASON_OF[reason],
          ),
        },
  registeredAt: view.registeredAt,
  disposableEmail: DISPOSABLE_EMAIL_CHECKS[view.disposableEmail],
  status: STATUS_OF[view.status],
  suspendedAt: view.suspendedAt,
  latestSuspension: view.latestSuspension,
});

// 状態を変えたのに措置の記録が確定されなかった結果もIDを持たないまま変化ありとして返す
const toOutcome = ({
  changed,
}: ModerationOutcome): GraphQLModerationOutcome => ({
  changed,
});

async function moderating(
  run: () => Promise<ModerationOutcome>,
): Promise<GraphQLModerationOutcome> {
  try {
    return toOutcome(await run());
  } catch (error: unknown) {
    throw toModerationError(error);
  }
}

// 一覧は閲覧のみ以上、停止と停止解除はモデレーター以上、代理の退会は最上位管理者だけに許す
export const userResolvers = {
  Query: {
    adminUsers: adminOnly(
      withValidatedArgs(
        ADMIN_USERS_ARGS,
        async (_parent: unknown, { filter, first, after }, context) => {
          const operator = await moderationOperatorOf(context, 'viewer');
          const page = await readerOf(context).list({
            filter,
            first,
            ...(after !== undefined && { after }),
            operator,
            at: clockOf(context).now(),
          });
          const { nodes, pageInfo } = toModerationConnection(
            page.users,
            page.nextCursor,
            toAdminUser,
          );
          // 生成した接続の型は変更できる配列を求めるため、読み取り専用の配列を写す
          return { nodes: [...nodes], pageInfo };
        },
      ),
    ),
  },
  Mutation: {
    suspendUser: adminOnly(
      withValidatedArgs(
        USER_MODERATION_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const operator = await moderationOperatorOf(context, 'moderator');
          return moderating(() =>
            moderationOf(context).suspend({
              targetId: id,
              reason,
              operator,
              at: clockOf(context).now(),
            }),
          );
        },
      ),
    ),
    unsuspendUser: adminOnly(
      withValidatedArgs(
        USER_MODERATION_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const operator = await moderationOperatorOf(context, 'moderator');
          return moderating(() =>
            moderationOf(context).unsuspend({
              targetId: id,
              reason,
              operator,
              at: clockOf(context).now(),
            }),
          );
        },
      ),
    ),
    withdrawUserByAdministrator: adminOnly(
      withValidatedArgs(
        ADMINISTRATIVE_WITHDRAWAL_ARGS,
        async (_parent: unknown, { input }, context) => {
          const operator = await moderationOperatorOf(context, 'super_admin');
          const principal = await context.session.principal();
          return moderating(() =>
            withInputPath('input', () =>
              withdrawalOf(context).withdraw({
                userId: input.userId,
                reason: input.reason,
                operator,
                caller: context.caller,
                principal,
                at: clockOf(context).now(),
              }),
            ),
          );
        },
      ),
    ),
  },
} satisfies Resolvers;
