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
import type { DeliveryStatusReader } from '../application/notifications/ports.ts';
import { SuppressionDeliveryStatusReader } from '../infrastructure/notifications/delivery-status-reader.ts';

export const API_NOTIFICATIONS_PLATFORM_MODULE: AppModule<
  Hono<PlatformHonoEnv<Env>>
> = createNotificationsPlatformModule('api');

// 受信設定のストア(API_NOTIFICATIONS_PLATFORM_MODULE)・利用者の連絡先(IDENTITY_PLATFORM_MODULE)・抑止の照会(EMAIL_PLATFORM_MODULE)は各基盤のモジュールの束縛を使う
export const NOTIFICATIONS_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'notifications',
  bindings: new ContainerModule(({ bind }) => {
    bind<DeliveryStatusReader>(NOTIFICATIONS_TYPES.DeliveryStatusReader).to(
      SuppressionDeliveryStatusReader,
    );
    bind<NotificationSettingsService>(
      NOTIFICATIONS_TYPES.NotificationSettingsService,
    ).to(StoreNotificationSettingsService);
  }),
};
