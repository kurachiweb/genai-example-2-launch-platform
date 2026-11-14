import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createNotificationsPlatformModule } from '../../lib/workers/notifications/notifications-platform-module.ts';
import {
  type NotificationSettingsService,
  StoreNotificationSettingsService,
} from '../application/notifications/notification-settings-service.ts';
import { NOTIFICATIONS_TYPES } from '../application/notifications/notifications-types.ts';
import type {
  DeliveryStatusReader,
  NotificationMaintenanceStore,
  SenderInfoWriter,
} from '../application/notifications/ports.ts';
import {
  type SenderInfoService,
  StoreSenderInfoService,
} from '../application/notifications/sender-info-service.ts';
import {
  TokenUnsubscribeService,
  type UnsubscribeService,
} from '../application/notifications/unsubscribe-service.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { AccountWithdrawalSyncHandler } from '../infrastructure/notifications/account-withdrawal-sync-handler.ts';
import { D1NotificationMaintenanceStore } from '../infrastructure/notifications/d1-notification-maintenance-store.ts';
import { D1SenderInfoWriter } from '../infrastructure/notifications/d1-sender-info-writer.ts';
import { SuppressionDeliveryStatusReader } from '../infrastructure/notifications/delivery-status-reader.ts';

export const API_NOTIFICATIONS_PLATFORM_MODULE: AppModule<
  Hono<PlatformHonoEnv<Env>>
> = createNotificationsPlatformModule('api');

// 受信設定・送信者情報のストアと配信停止のトークンのサービス(API_NOTIFICATIONS_PLATFORM_MODULE)・利用者の連絡先(IDENTITY_PLATFORM_MODULE)・抑止の照会(EMAIL_PLATFORM_MODULE)・監査ログの記録(ADMIN_MODULE)は各モジュールの束縛を使う
export const NOTIFICATIONS_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'notifications',
  bindings: new ContainerModule(({ bind }) => {
    bind<DeliveryStatusReader>(NOTIFICATIONS_TYPES.DeliveryStatusReader).to(
      SuppressionDeliveryStatusReader,
    );
    bind<NotificationSettingsService>(
      NOTIFICATIONS_TYPES.NotificationSettingsService,
    ).to(StoreNotificationSettingsService);
    bind<UnsubscribeService>(NOTIFICATIONS_TYPES.UnsubscribeService).to(
      TokenUnsubscribeService,
    );
    bind<SenderInfoWriter>(NOTIFICATIONS_TYPES.SenderInfoWriter).to(
      D1SenderInfoWriter,
    );
    bind<SenderInfoService>(NOTIFICATIONS_TYPES.SenderInfoService).to(
      StoreSenderInfoService,
    );
    bind<UserLifecycleSyncHandler>(
      NOTIFICATIONS_TYPES.AccountWithdrawalSyncHandler,
    ).to(AccountWithdrawalSyncHandler);
    bind<NotificationMaintenanceStore>(
      NOTIFICATIONS_TYPES.NotificationMaintenanceStore,
    ).to(D1NotificationMaintenanceStore);
  }),
};
