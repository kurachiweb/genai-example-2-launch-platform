import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { MatchEventHandler } from '../../lib/core/match/match-events.ts';
import type { ResultNoticeSupplementProvider } from '../../lib/core/notifications/result-notice-supplements.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type { ProductLifecycleAsyncHandler } from '../../lib/core/product/product-lifecycle.ts';
import type { ProductDirectory } from '../../lib/core/product/ports.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type { UltrasActivationHandler } from '../../lib/core/ultras/activation-contract.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../lib/core/week-tournament/identifiers.ts';
import type { WeekTournamentStore } from '../../lib/core/week-tournament/ports.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { AccountEntryLossHandler } from '../application/week-tournament/account-entry-loss-handler.ts';
import { EntryUnlinkHandler } from '../application/week-tournament/entry-unlink-handler.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { ProductEntryLossHandler } from '../application/week-tournament/product-entry-loss-handler.ts';
import { QualifierEntryHandler } from '../application/week-tournament/qualifier-entry-handler.ts';
import { RoundProgressHandler } from '../application/week-tournament/round-progress-handler.ts';
import { WeekEntrySupplementProvider } from '../application/week-tournament/week-entry-supplement-provider.ts';
import { WeekOpenEntryCheckoutExpiryHandler } from '../application/week-tournament/week-open-entry-checkout-expiry-handler.ts';
import { WeekUltrasEntryExemptionHandler } from '../application/week-tournament/week-ultras-entry-exemption-handler.ts';
import type { EventEnv } from './env-schema.ts';

// 共通の束縛(createWeekTournamentPlatformModule・createTournamentPlatformModule、マッチ・プロダクト・決済の共通の束縛)が登録されている前提で、マッチイベント・ライフサイクル・Ultrasの知らせの処理と結果通知の追記を束縛する
export const EVENT_WEEK_TOURNAMENT_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-week-tournament',
  bindings: new ContainerModule(({ bind }) => {
    bind<MatchEventHandler>(
      EVENT_WEEK_TOURNAMENT_TYPES.QualifierEntryHandler,
    ).to(QualifierEntryHandler);
    bind<MatchEventHandler>(
      EVENT_WEEK_TOURNAMENT_TYPES.RoundProgressHandler,
    ).to(RoundProgressHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_WEEK_TOURNAMENT_TYPES.ProductEntryLossHandler,
    ).to(ProductEntryLossHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_WEEK_TOURNAMENT_TYPES.EntryUnlinkHandler,
    ).to(EntryUnlinkHandler);
    bind<UserLifecycleAsyncHandler>(
      EVENT_WEEK_TOURNAMENT_TYPES.AccountEntryLossHandler,
    ).to(AccountEntryLossHandler);
    bind<UltrasActivationHandler>(
      EVENT_WEEK_TOURNAMENT_TYPES.WeekUltrasEntryExemptionHandler,
    ).to(WeekUltrasEntryExemptionHandler);
    bind<UltrasActivationHandler>(
      EVENT_WEEK_TOURNAMENT_TYPES.WeekOpenEntryCheckoutExpiryHandler,
    ).to(WeekOpenEntryCheckoutExpiryHandler);
    bind<ResultNoticeSupplementProvider>(
      EVENT_WEEK_TOURNAMENT_TYPES.WeekEntrySupplementProvider,
    ).toDynamicValue(
      (context) =>
        new WeekEntrySupplementProvider({
          store: context.get<WeekTournamentStore>(
            WEEK_TOURNAMENT_TYPES.WeekTournamentStore,
          ),
          products: context.get<ProductDirectory>(
            PRODUCT_PLATFORM_TYPES.ProductDirectory,
          ),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
          clientSiteOrigin: context.get<EventEnv>(PLATFORM_TYPES.Env)
            .CLIENT_SITE_ORIGIN,
        }),
    );
  }),
};
