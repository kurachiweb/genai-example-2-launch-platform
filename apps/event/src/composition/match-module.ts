import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import { MATCH_PLATFORM_TYPES } from '../../lib/core/match/identifiers.ts';
import {
  createMatchEventRegistry,
  type MatchEventHandler,
  type MatchEventRegistration,
} from '../../lib/core/match/match-events.ts';
import type { MatchEventStore } from '../../lib/core/match/ports.ts';
import type { RunMatchEventBody } from '../../lib/core/messaging/contracts/match.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import type { ProductLifecycleAsyncHandler } from '../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMatchPlatformModule } from '../../lib/workers/match/match-platform-module.ts';
import {
  AccountDecisionFollowUpHandler,
  ProductDecisionFollowUpHandler,
} from '../application/match/decision-follow-up-handlers.ts';
import { EntryUnlinkHandler } from '../application/match/entry-unlink-handler.ts';
import { EVENT_MATCH_TYPES } from '../application/match/event-match-types.ts';
import { MatchEventRunner } from '../application/match/match-event-runner.ts';
import type { MatchPurgeStore } from '../application/match/ports.ts';
import { QualifierOutcomeHandler } from '../application/match/qualifier-outcome-handler.ts';
import { UpvoteErasureHandler } from '../application/match/upvote-erasure-handler.ts';
import { D1MatchPurgeStore } from '../infrastructure/match/d1-match-purge-store.ts';
import type { EventEnv } from './env-schema.ts';
import { MATCH_EVENT_HANDLERS } from './match-event-handlers.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export const EVENT_MATCH_PLATFORM_MODULE: EventAppModule =
  createMatchPlatformModule('event');

export interface EventMatchModuleOptions {
  readonly eventHandlers: readonly MatchEventRegistration[];
}

// 共通の束縛(EVENT_MATCH_PLATFORM_MODULE・PRODUCT_PLATFORM_MODULE)が登録されている前提で、マッチイベントの実行器と予選の結果の記録の処理、ユーザー・プロダクトのライフサイクルの登録口から呼ばれる即時の終了の後続の処理と、Upvoteの物理削除・マッチ記録の紐付けの解除の処理とそのストアを束縛する
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
      bind<UserLifecycleAsyncHandler>(
        EVENT_MATCH_TYPES.AccountDecisionFollowUpHandler,
      ).to(AccountDecisionFollowUpHandler);
      bind<ProductLifecycleAsyncHandler>(
        EVENT_MATCH_TYPES.ProductDecisionFollowUpHandler,
      ).to(ProductDecisionFollowUpHandler);
      bind<MatchPurgeStore>(EVENT_MATCH_TYPES.MatchPurgeStore).to(
        D1MatchPurgeStore,
      );
      bind<UserLifecycleAsyncHandler>(
        EVENT_MATCH_TYPES.UpvoteErasureHandler,
      ).to(UpvoteErasureHandler);
      bind<ProductLifecycleAsyncHandler>(
        EVENT_MATCH_TYPES.EntryUnlinkHandler,
      ).to(EntryUnlinkHandler);
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
