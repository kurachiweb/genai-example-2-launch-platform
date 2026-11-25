import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import type {
  LaunchSummarySource,
  ProductLockSource,
  RelaunchConditionSource,
} from '../application/product/decision-sources.ts';
import {
  type ProductTrophyReader,
  SourcedProductTrophyReader,
} from '../application/tournament/product-trophy-reader.ts';
import {
  type RegisteredTrophySource,
  resolveTrophySources,
  type TrophySource,
} from '../application/tournament/trophy-source.ts';
import type { WeekTournamentIncidentReporter } from '../application/week-tournament/ports.ts';
import {
  DirectoryWeekBoardReader,
  type WeekBoardReader,
} from '../application/week-tournament/week-board-reader.ts';
import {
  DirectoryWeekBracketReader,
  type WeekBracketReader,
} from '../application/week-tournament/week-bracket-reader.ts';
import {
  DefaultWeekEntryCheckout,
  type WeekEntryCheckout,
} from '../application/week-tournament/week-entry-checkout.ts';
import {
  DirectoryWeekEntryPanelReader,
  type WeekEntryPanelReader,
} from '../application/week-tournament/week-entry-panel-reader.ts';
import { WeekLaunchSummarySource } from '../application/week-tournament/week-launch-summary-source.ts';
import { WeekProductLockSource } from '../application/week-tournament/week-product-lock-source.ts';
import { WeekRelaunchConditionSource } from '../application/week-tournament/week-relaunch-condition-source.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../application/week-tournament/week-tournament-api-types.ts';
import {
  EntryFollowUpJob,
  EveningBracketJob,
} from '../application/week-tournament/week-tournament-jobs.ts';
import { WeekTrophySource } from '../application/week-tournament/week-trophy-source.ts';
import { SentryWeekTournamentIncidentReporter } from '../infrastructure/week-tournament/sentry-week-tournament-incident-reporter.ts';
import { resolverOf } from './container-resolver.ts';
import { TOURNAMENT_TROPHY_SOURCES } from './tournament-trophy-sources.ts';

// Weekトーナメントとブラケットの共通の束縛(createWeekTournamentPlatformModule・createTournamentPlatformModule)、
// マッチ・プロダクト・決済・Ultrasの束縛と、通知のモジュールだけが持つ夜の枠の送り出しの入口(NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate)は他のモジュールの束縛を使う
export const WEEK_TOURNAMENT_API_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  {
    name: 'api-week-tournament',
    bindings: new ContainerModule(({ bind }) => {
      bind<ScheduledJobHandler>(WEEK_TOURNAMENT_API_TYPES.EveningBracketJob).to(
        EveningBracketJob,
      );
      bind<ScheduledJobHandler>(WEEK_TOURNAMENT_API_TYPES.EntryFollowUpJob).to(
        EntryFollowUpJob,
      );
      bind<WeekTournamentIncidentReporter>(
        WEEK_TOURNAMENT_API_TYPES.WeekTournamentIncidentReporter,
      ).to(SentryWeekTournamentIncidentReporter);
      bind<WeekBoardReader>(WEEK_TOURNAMENT_API_TYPES.WeekBoardReader).to(
        DirectoryWeekBoardReader,
      );
      bind<WeekBracketReader>(WEEK_TOURNAMENT_API_TYPES.WeekBracketReader).to(
        DirectoryWeekBracketReader,
      );
      bind<WeekEntryPanelReader>(
        WEEK_TOURNAMENT_API_TYPES.WeekEntryPanelReader,
      ).to(DirectoryWeekEntryPanelReader);
      bind<WeekEntryCheckout>(WEEK_TOURNAMENT_API_TYPES.WeekEntryCheckout).to(
        DefaultWeekEntryCheckout,
      );
      bind<RelaunchConditionSource>(
        WEEK_TOURNAMENT_API_TYPES.WeekRelaunchConditionSource,
      ).to(WeekRelaunchConditionSource);
      bind<ProductLockSource>(
        WEEK_TOURNAMENT_API_TYPES.WeekProductLockSource,
      ).to(WeekProductLockSource);
      bind<LaunchSummarySource>(
        WEEK_TOURNAMENT_API_TYPES.WeekLaunchSummarySource,
      ).to(WeekLaunchSummarySource);
      bind<TrophySource>(WEEK_TOURNAMENT_API_TYPES.WeekTrophySource).to(
        WeekTrophySource,
      );
      bind<readonly RegisteredTrophySource[]>(
        WEEK_TOURNAMENT_API_TYPES.TrophySources,
      ).toDynamicValue((context) =>
        resolveTrophySources(TOURNAMENT_TROPHY_SOURCES, resolverOf(context)),
      );
      bind<ProductTrophyReader>(
        WEEK_TOURNAMENT_API_TYPES.ProductTrophyReader,
      ).to(SourcedProductTrophyReader);
    }),
  };
