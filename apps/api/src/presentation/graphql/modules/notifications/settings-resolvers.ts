import type { NotificationSettingsService } from '../../../../application/notifications/notification-settings-service.ts';
import { NOTIFICATIONS_TYPES } from '../../../../application/notifications/notifications-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { UPDATE_NOTIFICATION_PREFERENCE_ARGS } from './inputs.ts';
import { toNotificationSettings } from './mappers.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

const settingsOf = (context: GraphQLContext): NotificationSettingsService =>
  context.resolve<NotificationSettingsService>(
    NOTIFICATIONS_TYPES.NotificationSettingsService,
  );

// 照会は停止中の利用者にも変更できない状態の設定を返し、変更は書き込み可能な利用者に限る
export const settingsResolvers = {
  Query: {
    viewerNotificationSettings: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const current = await accountGuardOf(context).requireUser(
          context.session,
        );
        return toNotificationSettings(await settingsOf(context).read(current));
      },
    ),
  },
  Mutation: {
    updateNotificationPreference: clientOnly(
      withValidatedArgs(
        UPDATE_NOTIFICATION_PREFERENCE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          return toNotificationSettings(
            await settingsOf(context).update(
              current,
              input.topic,
              input.enabled,
              clockOf(context).now(),
            ),
          );
        },
      ),
    ),
  },
} satisfies Resolvers;
