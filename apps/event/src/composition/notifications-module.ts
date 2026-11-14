import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import {
  createResultNoticeSupplementRegistry,
  type ResultNoticeSupplementProvider,
  type ResultNoticeSupplementRegistration,
} from '../../lib/core/notifications/result-notice-supplements.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createNotificationsPlatformModule } from '../../lib/workers/notifications/notifications-platform-module.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import type {
  SlotCollector,
  SupplementSource,
} from '../application/notifications/ports.ts';
import { EveningCollector } from '../infrastructure/notifications/evening-collector.ts';
import { MorningCollector } from '../infrastructure/notifications/morning-collector.ts';
import { RegisteredSupplementSource } from '../infrastructure/notifications/registered-supplement-source.ts';
import type { EventEnv } from './env-schema.ts';
import { RESULT_NOTICE_SUPPLEMENTS } from './result-notice-supplements.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export const EVENT_NOTIFICATIONS_PLATFORM_MODULE: EventAppModule =
  createNotificationsPlatformModule('event');

export interface EventNotificationsModuleOptions {
  readonly resultNoticeSupplements: readonly ResultNoticeSupplementRegistration[];
}

// 受信設定と通知のストア(EVENT_NOTIFICATIONS_PLATFORM_MODULE)、マッチ・プロダクト・フォロワーの照会(各機能のプラットフォームのモジュール)が束縛されている前提で、夜と朝の枠の収集と結果の追記の取得を束縛する。メールの送信者情報の取得口はemail-registrations.tsの登録をメールのモジュールが束縛する
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
    }),
  };
}

export const EVENT_NOTIFICATIONS_MODULE: EventAppModule =
  createEventNotificationsModule({
    resultNoticeSupplements: RESULT_NOTICE_SUPPLEMENTS,
  });
