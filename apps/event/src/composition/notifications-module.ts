import type { Hono } from 'hono';
import { ContainerModule, type ResolutionContext } from 'inversify';

import type { Database } from '../../db/client.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type {
  AlertThrottle,
  EmailSender,
  SuppressionList,
} from '../../lib/core/email/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../lib/core/identity/ports.ts';
import { MATCH_PLATFORM_TYPES } from '../../lib/core/match/identifiers.ts';
import type { MatchDirectory } from '../../lib/core/match/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type {
  NotificationIncidentReporter,
  NotificationNoticeStore,
  NotificationPreferenceStore,
  SenderInfoStore,
  UnsubscribeTokenService,
} from '../../lib/core/notifications/ports.ts';
import {
  createResultNoticeSupplementRegistry,
  type ResultNoticeSupplementProvider,
  type ResultNoticeSupplementRegistration,
} from '../../lib/core/notifications/result-notice-supplements.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../lib/core/profile/identifiers.ts';
import type { UserProfileDirectory } from '../../lib/core/profile/ports.ts';
import type {
  ExpandNotificationEventBody,
  FlushNotificationSlotBody,
} from '../../lib/core/messaging/contracts/notifications.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createNotificationsPlatformModule } from '../../lib/workers/notifications/notifications-platform-module.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import { ExpandEventHandler } from '../application/notifications/expand-event-handler.ts';
import { FlushSlotHandler } from '../application/notifications/flush-slot-handler.ts';
import { OneClickUnsubscribe } from '../application/notifications/one-click-unsubscribe.ts';
import type {
  GroupDispatcher,
  SlotCollector,
  SupplementSource,
} from '../application/notifications/ports.ts';
import { EveningCollector } from '../infrastructure/notifications/evening-collector.ts';
import { EmailGroupDispatcher } from '../infrastructure/notifications/group-dispatcher.ts';
import { MorningCollector } from '../infrastructure/notifications/morning-collector.ts';
import { RegisteredSupplementSource } from '../infrastructure/notifications/registered-supplement-source.ts';
import { registerOneClickUnsubscribeRoute } from '../presentation/notifications/one-click-unsubscribe-route.ts';
import type { EventEnv } from './env-schema.ts';
import { RESULT_NOTICE_SUPPLEMENTS } from './result-notice-supplements.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

function groupDispatcherOf(context: ResolutionContext): GroupDispatcher {
  const env = context.get<EventEnv>(PLATFORM_TYPES.Env);
  return new EmailGroupDispatcher({
    db: context.get<Database>(PLATFORM_TYPES.Database),
    notices: context.get<NotificationNoticeStore>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationNoticeStore,
    ),
    preferences: context.get<NotificationPreferenceStore>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
    ),
    senderInfo: context.get<SenderInfoStore>(
      NOTIFICATIONS_PLATFORM_TYPES.SenderInfoStore,
    ),
    tokens: context.get<UnsubscribeTokenService>(
      NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
    ),
    incidents: context.get<NotificationIncidentReporter>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationIncidentReporter,
    ),
    alertThrottle: context.get<AlertThrottle>(EMAIL_TYPES.AlertThrottle),
    contacts: context.get<UserContactDirectory>(
      IDENTITY_PLATFORM_TYPES.UserContactDirectory,
    ),
    suppressions: context.get<SuppressionList>(EMAIL_TYPES.SuppressionList),
    emails: context.get<EmailSender>(EMAIL_TYPES.EmailSender),
    matches: context.get<MatchDirectory>(MATCH_PLATFORM_TYPES.MatchDirectory),
    products: context.get<ProductDirectory>(
      PRODUCT_PLATFORM_TYPES.ProductDirectory,
    ),
    profiles: context.get<UserProfileDirectory>(
      PROFILE_PLATFORM_TYPES.UserProfileDirectory,
    ),
    supplements: context.get<SupplementSource>(
      EVENT_NOTIFICATIONS_TYPES.SupplementSource,
    ),
    origins: { client: env.CLIENT_SITE_ORIGIN, event: env.EVENT_SITE_ORIGIN },
  });
}

export const EVENT_NOTIFICATIONS_PLATFORM_MODULE: EventAppModule =
  createNotificationsPlatformModule('event');

export interface EventNotificationsModuleOptions {
  readonly resultNoticeSupplements: readonly ResultNoticeSupplementRegistration[];
}

// 受信設定と通知のストア(EVENT_NOTIFICATIONS_PLATFORM_MODULE)、マッチ・プロダクト・フォロワー・利用者の照会(各機能のプラットフォームのモジュール)、メールの送信と抑止(EMAIL_PLATFORM_MODULE)が束縛されている前提で、夜と朝の枠の収集・結果の追記の取得・まとめの送信・送信枠の送り出しと受賞の展開の処理・ワンクリックの配信停止を束縛し、配信停止の経路を登録する。メールの送信者情報の取得口はemail-registrations.tsの登録をメールのモジュールが束縛する
export function createEventNotificationsModule(
  options: EventNotificationsModuleOptions,
): EventAppModule {
  // 名前・順序の重複などの登録の誤りを、最初のメッセージではなくisolateの起動時に検出する
  const supplements = createResultNoticeSupplementRegistry(
    options.resultNoticeSupplements,
  );
  return {
    name: 'event-notifications',
    bindings: new ContainerModule(({ bind }) => {
      bind<SlotCollector>(EVENT_NOTIFICATIONS_TYPES.EveningCollector).to(
        EveningCollector,
      );
      bind<SlotCollector>(EVENT_NOTIFICATIONS_TYPES.MorningCollector).to(
        MorningCollector,
      );
      bind<SupplementSource>(
        EVENT_NOTIFICATIONS_TYPES.SupplementSource,
      ).toDynamicValue(
        (context) =>
          new RegisteredSupplementSource(supplements, (identifier) =>
            context.get<ResultNoticeSupplementProvider>(identifier),
          ),
      );
      bind<GroupDispatcher>(
        EVENT_NOTIFICATIONS_TYPES.GroupDispatcher,
      ).toDynamicValue(groupDispatcherOf);
      bind<MessageHandler<FlushNotificationSlotBody>>(
        EVENT_NOTIFICATIONS_TYPES.FlushSlotHandler,
      ).to(FlushSlotHandler);
      bind<MessageHandler<ExpandNotificationEventBody>>(
        EVENT_NOTIFICATIONS_TYPES.ExpandEventHandler,
      ).to(ExpandEventHandler);
      bind<OneClickUnsubscribe>(
        EVENT_NOTIFICATIONS_TYPES.OneClickUnsubscribe,
      ).to(OneClickUnsubscribe);
    }),
    routes: registerOneClickUnsubscribeRoute,
  };
}

export const EVENT_NOTIFICATIONS_MODULE: EventAppModule =
  createEventNotificationsModule({
    resultNoticeSupplements: RESULT_NOTICE_SUPPLEMENTS,
  });
