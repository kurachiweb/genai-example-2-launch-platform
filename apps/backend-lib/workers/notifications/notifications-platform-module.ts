import { ContainerModule } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
import type { MatchDirectory } from '../../core/match/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../core/notifications/identifiers.ts';
import type { NotificationEventPublisher } from '../../core/notifications/notification-event-contract.ts';
import type {
  NotificationEventExpander,
  NotificationIncidentReporter,
  NotificationNoticeStore,
  NotificationPreferenceStore,
  NotificationSettingsExport,
  NotificationSlotStore,
  NotificationWorkRequester,
  SenderInfoStore,
  UnsubscribeTokenService,
} from '../../core/notifications/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { D1NotificationEventExpander } from './d1-notification-event-expander.ts';
import { D1NotificationEventPublisher } from './d1-notification-event-publisher.ts';
import { D1NotificationNoticeStore } from './d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from './d1-notification-preference-store.ts';
import { D1NotificationSettingsExport } from './d1-notification-settings-export.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import { D1SenderInfoStore } from './d1-sender-info-store.ts';
import { D1UnsubscribeTokenService } from './d1-unsubscribe-token-service.ts';
import { MessageWorkRequester } from './message-work-requester.ts';
import { SentryNotificationIncidentReporter } from './sentry-notification-incident-reporter.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。アプリの名前は発行と異常の通知のログのカテゴリの先頭になる
export function createNotificationsPlatformModule(
  appName: LoggingOptions['appName'],
): Omit<AppModule, 'routes'> {
  return {
    name: 'notifications-platform',
    bindings: new ContainerModule(({ bind }) => {
      bind<NotificationPreferenceStore>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
      )
        .to(D1NotificationPreferenceStore)
        .inSingletonScope();
      bind<UnsubscribeTokenService>(
        NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
      )
        .to(D1UnsubscribeTokenService)
        .inSingletonScope();
      bind<SenderInfoStore>(NOTIFICATIONS_PLATFORM_TYPES.SenderInfoStore)
        .to(D1SenderInfoStore)
        .inSingletonScope();
      bind<NotificationSlotStore>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationSlotStore,
      )
        .to(D1NotificationSlotStore)
        .inSingletonScope();
      bind<NotificationNoticeStore>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationNoticeStore,
      )
        .to(D1NotificationNoticeStore)
        .inSingletonScope();
      bind<NotificationEventExpander>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationEventExpander,
      )
        .to(D1NotificationEventExpander)
        .inSingletonScope();
      bind<NotificationWorkRequester>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationWorkRequester,
      )
        .to(MessageWorkRequester)
        .inSingletonScope();
      bind<NotificationSettingsExport>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationSettingsExport,
      )
        .to(D1NotificationSettingsExport)
        .inSingletonScope();
      bind<NotificationEventPublisher>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher,
      )
        .toDynamicValue(
          (context) =>
            new D1NotificationEventPublisher({
              db: context.get<Database>(PLATFORM_TYPES.Database),
              ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
              matches: context.get<MatchDirectory>(
                MATCH_PLATFORM_TYPES.MatchDirectory,
              ),
              preferences: context.get<NotificationPreferenceStore>(
                NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
              ),
              notices: context.get<NotificationNoticeStore>(
                NOTIFICATIONS_PLATFORM_TYPES.NotificationNoticeStore,
              ),
              requester: context.get<NotificationWorkRequester>(
                NOTIFICATIONS_PLATFORM_TYPES.NotificationWorkRequester,
              ),
              appName,
            }),
        )
        .inSingletonScope();
      bind<NotificationIncidentReporter>(
        NOTIFICATIONS_PLATFORM_TYPES.NotificationIncidentReporter,
      )
        .toDynamicValue(() => new SentryNotificationIncidentReporter(appName))
        .inSingletonScope();
    }),
  };
}
