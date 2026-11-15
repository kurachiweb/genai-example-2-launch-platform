import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import {
  createUltrasActivationRegistry,
  type UltrasActivationHandler,
  type UltrasActivationHandlerRegistration,
} from '../../lib/core/ultras/activation-contract.ts';
import type { RunActivationHandlersBody } from '../../lib/core/ultras/activation-message.ts';
import { ULTRAS_TYPES } from '../../lib/core/ultras/identifiers.ts';
import type { ActivationStore } from '../../lib/core/ultras/ports.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createUltrasPlatformModule } from '../../lib/workers/ultras/ultras-platform-module.ts';
import { EVENT_ULTRAS_TYPES } from '../application/ultras/event-ultras-types.ts';
import { RunActivationHandlersHandler } from '../application/ultras/run-activation-handlers-handler.ts';
import { SubscriptionCancellationHandler } from '../application/ultras/subscription-cancellation-handler.ts';
import { SubscriptionErasureHandler } from '../application/ultras/subscription-erasure-handler.ts';
import type { UltrasAccountDataEraser } from '../application/ultras/ultras-account-data-eraser.ts';
import { D1UltrasAccountDataEraser } from '../infrastructure/ultras/d1-ultras-account-data-eraser.ts';
import type { EventEnv } from './env-schema.ts';
import { ULTRAS_ACTIVATION_HANDLERS } from './ultras-activation-handlers.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export interface EventUltrasModuleOptions {
  readonly activationHandlers: readonly UltrasActivationHandlerRegistration[];
}

// 共通の束縛は決済(EVENT_PAYMENTS_PLATFORM_MODULE)・メール・利用者の共通の束縛を使う
export const EVENT_ULTRAS_PLATFORM_MODULE: EventAppModule =
  createUltrasPlatformModule('event');

// 共通の束縛(EVENT_ULTRAS_PLATFORM_MODULE)が登録されている前提で、加入が有効になった知らせの処理と、退会・停止の解約と物理削除の波及処理を束縛する
export function createEventUltrasModule(
  options: EventUltrasModuleOptions,
): EventAppModule {
  // 名前・順序の重複などの登録の誤りを、最初のメッセージではなくisolateの起動時に検出する
  const registry = createUltrasActivationRegistry(options.activationHandlers);
  return {
    name: 'event-ultras',
    bindings: new ContainerModule(({ bind }) => {
      bind<MessageHandler<RunActivationHandlersBody>>(
        EVENT_ULTRAS_TYPES.RunActivationHandlersHandler,
      ).toDynamicValue(
        (context) =>
          new RunActivationHandlersHandler({
            activations: context.get<ActivationStore>(
              ULTRAS_TYPES.ActivationStore,
            ),
            registry,
            // 知らせの処理は受け取る各機能のモジュールが束縛するため、呼ばれた時点の処理単位のコンテナから引く
            resolver: {
              resolve: (registration) =>
                context.get<UltrasActivationHandler>(registration.handler),
            },
            clock: context.get<Clock>(PLATFORM_TYPES.Clock),
          }),
      );
      bind<UltrasAccountDataEraser>(
        EVENT_ULTRAS_TYPES.UltrasAccountDataEraser,
      ).to(D1UltrasAccountDataEraser);
      bind<UserLifecycleAsyncHandler>(
        EVENT_ULTRAS_TYPES.SubscriptionCancellationHandler,
      ).to(SubscriptionCancellationHandler);
      bind<UserLifecycleAsyncHandler>(
        EVENT_ULTRAS_TYPES.SubscriptionErasureHandler,
      ).to(SubscriptionErasureHandler);
    }),
  };
}

export const EVENT_ULTRAS_MODULE: EventAppModule = createEventUltrasModule({
  activationHandlers: ULTRAS_ACTIVATION_HANDLERS,
});
