import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createNotificationsPlatformModule } from '../../lib/workers/notifications/notifications-platform-module.ts';
import type { EventEnv } from './env-schema.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export const EVENT_NOTIFICATIONS_PLATFORM_MODULE: EventAppModule =
  createNotificationsPlatformModule('event');

// 受信設定・送信者情報のストアと配信停止のトークンのサービス・送信枠のストアと送り出しの依頼・異常の通知(EVENT_NOTIFICATIONS_PLATFORM_MODULE)はその束縛を使う。メールの送信者情報の取得口はemail-registrations.tsの登録をメールのモジュールが束縛する
export const EVENT_NOTIFICATIONS_MODULE: EventAppModule = {
  name: 'event-notifications',
};
