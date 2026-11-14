import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createNotificationsPlatformModule } from '../../lib/workers/notifications/notifications-platform-module.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import type { SlotCollector } from '../application/notifications/ports.ts';
import { EveningCollector } from '../infrastructure/notifications/evening-collector.ts';
import { MorningCollector } from '../infrastructure/notifications/morning-collector.ts';
import type { EventEnv } from './env-schema.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export const EVENT_NOTIFICATIONS_PLATFORM_MODULE: EventAppModule =
  createNotificationsPlatformModule('event');

// 受信設定と通知のストア(EVENT_NOTIFICATIONS_PLATFORM_MODULE)、マッチ・プロダクト・フォロワーの照会(各機能のプラットフォームのモジュール)が束縛されている前提で、夜と朝の枠の収集を束縛する。メールの送信者情報の取得口はemail-registrations.tsの登録をメールのモジュールが束縛する
export const EVENT_NOTIFICATIONS_MODULE: EventAppModule = {
  name: 'event-notifications',
  bindings: new ContainerModule(({ bind }) => {
    bind<SlotCollector>(EVENT_NOTIFICATIONS_TYPES.EveningCollector).to(
      EveningCollector,
    );
    bind<SlotCollector>(EVENT_NOTIFICATIONS_TYPES.MorningCollector).to(
      MorningCollector,
    );
  }),
};
