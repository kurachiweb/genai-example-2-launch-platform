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
import { YEAR_TOURNAMENT_TYPES } from '../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearEntryStore,
} from '../../lib/core/year-tournament/ports.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { AccountEntryLossHandler as YearAccountEntryLossHandler } from '../application/year-tournament/account-entry-loss-handler.ts';
import { EntryUnlinkHandler as YearEntryUnlinkHandler } from '../application/year-tournament/entry-unlink-handler.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from '../application/year-tournament/event-year-tournament-types.ts';
import { ProductEntryLossHandler as YearProductEntryLossHandler } from '../application/year-tournament/product-entry-loss-handler.ts';
import { RoundProgressHandler as YearRoundProgressHandler } from '../application/year-tournament/round-progress-handler.ts';
import { WeekChampionEntryHandler } from '../application/year-tournament/week-champion-entry-handler.ts';
import { YearEntrySupplementProvider } from '../application/year-tournament/year-entry-supplement-provider.ts';
import { YearOpenEntryCheckoutExpiryHandler } from '../application/year-tournament/year-open-entry-checkout-expiry-handler.ts';
import { YearUltrasEntryExemptionHandler } from '../application/year-tournament/year-ultras-entry-exemption-handler.ts';
import type { EventEnv } from './env-schema.ts';

// 共通の束縛(createYearTournamentPlatformModule・createWeekTournamentPlatformModule・createTournamentPlatformModule、マッチ・プロダクト・決済の共通の束縛)が登録されている前提で、マッチイベント・ライフサイクル・Ultrasの知らせの処理と結果通知の追記を束縛する
export const EVENT_YEAR_TOURNAMENT_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-year-tournament',
  bindings: new ContainerModule(({ bind }) => {
    bind<MatchEventHandler>(
      EVENT_YEAR_TOURNAMENT_TYPES.WeekChampionEntryHandler,
    ).to(WeekChampionEntryHandler);
    bind<MatchEventHandler>(
      EVENT_YEAR_TOURNAMENT_TYPES.RoundProgressHandler,
    ).to(YearRoundProgressHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_YEAR_TOURNAMENT_TYPES.ProductEntryLossHandler,
    ).to(YearProductEntryLossHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_YEAR_TOURNAMENT_TYPES.EntryUnlinkHandler,
    ).to(YearEntryUnlinkHandler);
    bind<UserLifecycleAsyncHandler>(
      EVENT_YEAR_TOURNAMENT_TYPES.AccountEntryLossHandler,
    ).to(YearAccountEntryLossHandler);
    bind<UltrasActivationHandler>(
      EVENT_YEAR_TOURNAMENT_TYPES.YearUltrasEntryExemptionHandler,
    ).to(YearUltrasEntryExemptionHandler);
    bind<UltrasActivationHandler>(
      EVENT_YEAR_TOURNAMENT_TYPES.YearOpenEntryCheckoutExpiryHandler,
    ).to(YearOpenEntryCheckoutExpiryHandler);
    bind<ResultNoticeSupplementProvider>(
      EVENT_YEAR_TOURNAMENT_TYPES.YearEntrySupplementProvider,
    ).toDynamicValue(
      (context) =>
        new YearEntrySupplementProvider({
          store: context.get<YearEntryStore>(
            YEAR_TOURNAMENT_TYPES.YearEntryStore,
          ),
          calendar: context.get<YearCalendar>(
            YEAR_TOURNAMENT_TYPES.YearCalendar,
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
