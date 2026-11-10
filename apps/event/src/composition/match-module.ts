import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { MATCH_PLATFORM_TYPES } from '../../lib/core/match/identifiers.ts';
import {
  createMatchEventRegistry,
  type MatchEventHandler,
  type MatchEventRegistration,
} from '../../lib/core/match/match-events.ts';
import type { MatchEventStore } from '../../lib/core/match/ports.ts';
import type { RunMatchEventBody } from '../../lib/core/messaging/contracts/match.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMatchPlatformModule } from '../../lib/workers/match/match-platform-module.ts';
import { EVENT_MATCH_TYPES } from '../application/match/event-match-types.ts';
import { MatchEventRunner } from '../application/match/match-event-runner.ts';
import { QualifierOutcomeHandler } from '../application/match/qualifier-outcome-handler.ts';
import type { EventEnv } from './env-schema.ts';
import { MATCH_EVENT_HANDLERS } from './match-event-handlers.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export const EVENT_MATCH_PLATFORM_MODULE: EventAppModule =
  createMatchPlatformModule('event');

export interface EventMatchModuleOptions {
  readonly eventHandlers: readonly MatchEventRegistration[];
}

// 共通の束縛(EVENT_MATCH_PLATFORM_MODULE・PRODUCT_PLATFORM_MODULE)が登録されている前提で、マッチイベントの実行器と予選の結果の記録の処理を束縛する
export function createEventMatchModule(
  options: EventMatchModuleOptions,
): EventAppModule {
  // 名前・順序・種別の重複などの登録の誤りを、最初のメッセージではなくisolateの起動時に検出する
  const registry = createMatchEventRegistry(options.eventHandlers);
  return {
    name: 'event-match',
    bindings: new ContainerModule(({ bind }) => {
      bind<MatchEventHandler>(EVENT_MATCH_TYPES.QualifierOutcomeHandler).to(
        QualifierOutcomeHandler,
      );
      bind<MessageHandler<RunMatchEventBody>>(
        EVENT_MATCH_TYPES.MatchEventRunner,
      ).toDynamicValue(
        (context) =>
          new MatchEventRunner({
            store: context.get<MatchEventStore>(
              MATCH_PLATFORM_TYPES.MatchEventStore,
            ),
            registry,
            // 処理は受け取る各機能のモジュールが束縛するため、呼ばれた時点の処理単位のコンテナから引く
            resolver: {
              resolve: (registration) =>
                context.get<MatchEventHandler>(registration.handler),
            },
            clock: context.get<Clock>(PLATFORM_TYPES.Clock),
          }),
      );
    }),
  };
}

export const EVENT_MATCH_MODULE: EventAppModule = createEventMatchModule({
  eventHandlers: MATCH_EVENT_HANDLERS,
});
