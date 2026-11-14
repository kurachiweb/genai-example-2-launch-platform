import { ADMIN_PLATFORM_TYPES } from '../../../../../lib/core/admin/identifiers.ts';
import type { AdminDirectory } from '../../../../../lib/core/admin/ports.ts';
import { NOTIFICATIONS_TYPES } from '../../../../application/notifications/notifications-types.ts';
import type {
  SenderInfoService,
  SenderInfoView,
} from '../../../../application/notifications/sender-info-service.ts';
import { requireAdmin } from '../../admin-guard.ts';
import { withInputPath } from '../../field-paths.ts';
import type {
  NotificationSenderInfoState,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { adminOnly } from '../admin/resolver-support.ts';
import { senderInfoValidationError } from './errors.ts';
import { UPDATE_NOTIFICATION_SENDER_INFO_ARGS } from './inputs.ts';
import { toNotificationSenderInfoState } from './mappers.ts';
import { clockOf } from './resolver-support.ts';

const INPUT_ARGUMENT = 'input';

const senderInfoOf = (context: GraphQLContext): SenderInfoService =>
  context.resolve<SenderInfoService>(NOTIFICATIONS_TYPES.SenderInfoService);

// 照会口は有効な管理者だけを返すため、削除済み・招待中の管理者のニックネームはnullになる
async function stateOf(
  context: GraphQLContext,
  view: SenderInfoView,
): Promise<NotificationSenderInfoState> {
  const adminId = view.updatedByAdminId;
  if (adminId === null) {
    return toNotificationSenderInfoState(view, null);
  }
  const profiles = await context
    .resolve<AdminDirectory>(ADMIN_PLATFORM_TYPES.AdminDirectory)
    .findProfiles([adminId]);
  return toNotificationSenderInfoState(
    view,
    profiles.get(adminId)?.nickname ?? null,
  );
}

// 照会は全ての管理者、保存は最上位管理者に限る。保存した管理者のIDをユースケースへ渡す
export const senderInfoResolvers = {
  Query: {
    notificationSenderInfo: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return stateOf(context, await senderInfoOf(context).read());
      },
    ),
  },
  Mutation: {
    updateNotificationSenderInfo: adminOnly(
      withValidatedArgs(
        UPDATE_NOTIFICATION_SENDER_INFO_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'super_admin');
          const { expectedVersion, reason, ...info } = input;
          const view = await withInputPath(INPUT_ARGUMENT, async () => {
            const result = await senderInfoOf(context).update({
              adminId: current.id,
              info,
              expectedVersion,
              reason,
              now: clockOf(context).now(),
            });
            if (result.kind === 'invalid') {
              throw senderInfoValidationError(result.violations);
            }
            return result.view;
          });
          return stateOf(context, view);
        },
      ),
    ),
  },
} satisfies Resolvers;
