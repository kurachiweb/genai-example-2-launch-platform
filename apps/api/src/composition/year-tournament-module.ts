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
import type { TrophySource } from '../application/tournament/trophy-source.ts';
import type {
  YearFinalDateWriter,
  YearTournamentIncidentReporter,
} from '../application/year-tournament/ports.ts';
import {
  DirectoryYearBoardReader,
  type YearBoardReader,
} from '../application/year-tournament/year-board-reader.ts';
import {
  DirectoryYearBracketReader,
  type YearBracketReader,
} from '../application/year-tournament/year-bracket-reader.ts';
import {
  DefaultYearEntryCheckout,
  type YearEntryCheckout,
} from '../application/year-tournament/year-entry-checkout.ts';
import {
  DirectoryYearEntryPanelReader,
  type YearEntryPanelReader,
} from '../application/year-tournament/year-entry-panel-reader.ts';
import {
  DefaultYearFinalDateService,
  type YearFinalDateService,
} from '../application/year-tournament/year-final-date-service.ts';
import { YearLaunchSummarySource } from '../application/year-tournament/year-launch-summary-source.ts';
import { YearProductLockSource } from '../application/year-tournament/year-product-lock-source.ts';
import { YearRelaunchConditionSource } from '../application/year-tournament/year-relaunch-condition-source.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../application/year-tournament/year-tournament-api-types.ts';
import {
  YearEntryFollowUpJob,
  YearEveningBracketJob,
} from '../application/year-tournament/year-tournament-jobs.ts';
import { YearTrophySource } from '../application/year-tournament/year-trophy-source.ts';
import { D1YearFinalDateWriter } from '../infrastructure/year-tournament/d1-year-final-date-writer.ts';
import { SentryYearTournamentIncidentReporter } from '../infrastructure/year-tournament/sentry-year-tournament-incident-reporter.ts';

// Yearトーナメント・Weekトーナメント・ブラケットの共通の束縛、マッチ・プロダクト・決済・Ultras・管理者の束縛と、
// 通知のモジュールだけが持つ夜の枠の送り出しの入口(NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate)は他のモジュールの束縛を使う
export const YEAR_TOURNAMENT_API_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  {
    name: 'api-year-tournament',
    bindings: new ContainerModule(({ bind }) => {
      bind<ScheduledJobHandler>(YEAR_TOURNAMENT_API_TYPES.EveningBracketJob).to(
        YearEveningBracketJob,
      );
      bind<ScheduledJobHandler>(YEAR_TOURNAMENT_API_TYPES.EntryFollowUpJob).to(
        YearEntryFollowUpJob,
      );
      bind<YearTournamentIncidentReporter>(
        YEAR_TOURNAMENT_API_TYPES.YearTournamentIncidentReporter,
      ).to(SentryYearTournamentIncidentReporter);
      bind<YearBoardReader>(YEAR_TOURNAMENT_API_TYPES.YearBoardReader).to(
        DirectoryYearBoardReader,
      );
      bind<YearBracketReader>(YEAR_TOURNAMENT_API_TYPES.YearBracketReader).to(
        DirectoryYearBracketReader,
      );
      bind<YearEntryPanelReader>(
        YEAR_TOURNAMENT_API_TYPES.YearEntryPanelReader,
      ).to(DirectoryYearEntryPanelReader);
      bind<YearEntryCheckout>(YEAR_TOURNAMENT_API_TYPES.YearEntryCheckout).to(
        DefaultYearEntryCheckout,
      );
      bind<YearFinalDateService>(
        YEAR_TOURNAMENT_API_TYPES.YearFinalDateService,
      ).to(DefaultYearFinalDateService);
      bind<YearFinalDateWriter>(
        YEAR_TOURNAMENT_API_TYPES.YearFinalDateWriter,
      ).to(D1YearFinalDateWriter);
      bind<RelaunchConditionSource>(
        YEAR_TOURNAMENT_API_TYPES.YearRelaunchConditionSource,
      ).to(YearRelaunchConditionSource);
      bind<ProductLockSource>(
        YEAR_TOURNAMENT_API_TYPES.YearProductLockSource,
      ).to(YearProductLockSource);
      bind<LaunchSummarySource>(
        YEAR_TOURNAMENT_API_TYPES.YearLaunchSummarySource,
      ).to(YearLaunchSummarySource);
      bind<TrophySource>(YEAR_TOURNAMENT_API_TYPES.YearTrophySource).to(
        YearTrophySource,
      );
    }),
  };
