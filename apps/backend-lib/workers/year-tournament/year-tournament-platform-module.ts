import { type Bind, ContainerModule, type ResolutionContext } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
import type { MatchDirectory } from '../../core/match/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../core/notifications/identifiers.ts';
import type { NotificationEventPublisher } from '../../core/notifications/notification-event-contract.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type { PaymentRefunds } from '../../core/payments/ports.ts';
import type { PurchaseOfferPolicy } from '../../core/payments/purchase-kind-contract.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type {
  BracketDraw,
  BracketProgression,
} from '../../core/tournament/ports.ts';
import { ULTRAS_TYPES } from '../../core/ultras/identifiers.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../core/week-tournament/identifiers.ts';
import type { WeekChampionDirectory } from '../../core/week-tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../core/year-tournament/identifiers.ts';
import type {
  YearAwardExport,
  YearCalendar,
  YearDrawService,
  YearEntryFollowUp,
  YearEntryRegistrar,
  YearEntryStore,
  YearNotificationPublisher,
  YearProgressionService,
  YearTournamentStore,
} from '../../core/year-tournament/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { PurchaseFulfillment } from '../payments/fulfillment-contract.ts';
import { D1YearAwardExport } from './d1-year-award-export.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import { D1YearTournamentStore } from './d1-year-tournament-store.ts';
import { YearTournamentCalendar } from './year-calendar.ts';
import { YearTournamentDrawService } from './year-draw-service.ts';
import { YearEntryRefundFollowUp } from './year-entry-follow-up.ts';
import { YearEntryFulfillment } from './year-entry-fulfillment.ts';
import { YearEntryOfferPolicy } from './year-entry-offer-policy.ts';
import { ChampionYearEntryRegistrar } from './year-entry-registrar.ts';
import { YearTournamentNotificationPublisher } from './year-notification-publisher.ts';
import { YearTournamentProgressionService } from './year-progression-service.ts';

type AppName = LoggingOptions['appName'];

// 返金の知らせのメールに載せる決済履歴のURLの組み立てに使う環境の値
interface YearTournamentEnv {
  readonly CLIENT_SITE_ORIGIN: string;
}

const tournamentsOf = (context: ResolutionContext): YearTournamentStore =>
  context.get<YearTournamentStore>(YEAR_TOURNAMENT_TYPES.YearTournamentStore);

const entriesOf = (context: ResolutionContext): YearEntryStore =>
  context.get<YearEntryStore>(YEAR_TOURNAMENT_TYPES.YearEntryStore);

const calendarOf = (context: ResolutionContext): YearCalendar =>
  context.get<YearCalendar>(YEAR_TOURNAMENT_TYPES.YearCalendar);

const productsOf = (context: ResolutionContext): ProductDirectory =>
  context.get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory);

const entitlementsOf = (context: ResolutionContext): UltrasEntitlements =>
  context.get<UltrasEntitlements>(ULTRAS_TYPES.UltrasEntitlements);

const matchesOf = (context: ResolutionContext): MatchDirectory =>
  context.get<MatchDirectory>(MATCH_PLATFORM_TYPES.MatchDirectory);

function bindQueries(bind: Bind): void {
  bind<YearTournamentStore>(YEAR_TOURNAMENT_TYPES.YearTournamentStore)
    .to(D1YearTournamentStore)
    .inSingletonScope();
  bind<YearEntryStore>(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    .to(D1YearEntryStore)
    .inSingletonScope();
  bind<YearAwardExport>(YEAR_TOURNAMENT_TYPES.YearAwardExport)
    .to(D1YearAwardExport)
    .inSingletonScope();
  bind<YearCalendar>(YEAR_TOURNAMENT_TYPES.YearCalendar)
    .toDynamicValue(
      (context) => new YearTournamentCalendar(tournamentsOf(context)),
    )
    .inSingletonScope();
}

// paymentsの登録箇所(purchase-kind-registrations.ts)が指す購入の可否と参加資格の付与の識別子を束縛する
function bindPaymentsPorts(bind: Bind): void {
  bind<PurchaseOfferPolicy>(YEAR_TOURNAMENT_TYPES.YearEntryOfferPolicy)
    .toDynamicValue(
      (context) =>
        new YearEntryOfferPolicy(
          entriesOf(context),
          calendarOf(context),
          productsOf(context),
          entitlementsOf(context),
        ),
    )
    .inSingletonScope();
  bind<PurchaseFulfillment>(YEAR_TOURNAMENT_TYPES.YearEntryFulfillment)
    .toDynamicValue(
      (context) =>
        new YearEntryFulfillment(
          entriesOf(context),
          calendarOf(context),
          productsOf(context),
        ),
    )
    .inSingletonScope();
}

function bindEntries(bind: Bind, appName: AppName): void {
  bind<YearEntryRegistrar>(YEAR_TOURNAMENT_TYPES.YearEntryRegistrar)
    .toDynamicValue(
      (context) =>
        new ChampionYearEntryRegistrar({
          appName,
          champions: context.get<WeekChampionDirectory>(
            WEEK_TOURNAMENT_TYPES.WeekChampionDirectory,
          ),
          matches: matchesOf(context),
          entitlements: entitlementsOf(context),
          calendar: calendarOf(context),
          store: entriesOf(context),
          ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
        }),
    )
    .inSingletonScope();
  bind<YearEntryFollowUp>(YEAR_TOURNAMENT_TYPES.YearEntryFollowUp)
    .toDynamicValue(
      (context) =>
        new YearEntryRefundFollowUp({
          appName,
          store: entriesOf(context),
          calendar: calendarOf(context),
          refunds: context.get<PaymentRefunds>(PAYMENTS_TYPES.PaymentRefunds),
          contacts: context.get<UserContactDirectory>(
            IDENTITY_PLATFORM_TYPES.UserContactDirectory,
          ),
          emails: context.get<EmailSender>(EMAIL_TYPES.EmailSender),
          clientSiteOrigin: context.get<YearTournamentEnv>(PLATFORM_TYPES.Env)
            .CLIENT_SITE_ORIGIN,
        }),
    )
    .inSingletonScope();
}

function bindTournamentServices(bind: Bind, appName: AppName): void {
  bind<YearNotificationPublisher>(
    YEAR_TOURNAMENT_TYPES.YearNotificationPublisher,
  )
    .toDynamicValue(
      (context) =>
        new YearTournamentNotificationPublisher(
          tournamentsOf(context),
          matchesOf(context),
          context.get<NotificationEventPublisher>(
            NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher,
          ),
          appName,
        ),
    )
    .inSingletonScope();
  bind<YearProgressionService>(YEAR_TOURNAMENT_TYPES.YearProgressionService)
    .toDynamicValue(
      (context) =>
        new YearTournamentProgressionService(
          tournamentsOf(context),
          entriesOf(context),
          context.get<BracketProgression>(
            TOURNAMENT_PLATFORM_TYPES.BracketProgression,
          ),
          context.get<YearNotificationPublisher>(
            YEAR_TOURNAMENT_TYPES.YearNotificationPublisher,
          ),
          appName,
        ),
    )
    .inSingletonScope();
  bind<YearDrawService>(YEAR_TOURNAMENT_TYPES.YearDrawService)
    .toDynamicValue(
      (context) =>
        new YearTournamentDrawService({
          appName,
          tournaments: tournamentsOf(context),
          entries: entriesOf(context),
          registrar: context.get<YearEntryRegistrar>(
            YEAR_TOURNAMENT_TYPES.YearEntryRegistrar,
          ),
          products: productsOf(context),
          entitlements: entitlementsOf(context),
          bracketDraw: context.get<BracketDraw>(
            TOURNAMENT_PLATFORM_TYPES.BracketDraw,
          ),
          progression: context.get<YearProgressionService>(
            YEAR_TOURNAMENT_TYPES.YearProgressionService,
          ),
          followUp: context.get<YearEntryFollowUp>(
            YEAR_TOURNAMENT_TYPES.YearEntryFollowUp,
          ),
        }),
    )
    .inSingletonScope();
}

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。部品はWeekトーナメント・マッチ・トーナメント・決済・Ultras・通知・プロダクト・利用者・メールの共通の束縛が同じコンテナにある前提で組み立て、アプリの名前はログのカテゴリの先頭になる
export function createYearTournamentPlatformModule(
  appName: AppName,
): Omit<AppModule, 'routes'> {
  return {
    name: 'year-tournament-platform',
    bindings: new ContainerModule(({ bind }) => {
      bindQueries(bind);
      bindPaymentsPorts(bind);
      bindEntries(bind, appName);
      bindTournamentServices(bind, appName);
    }),
  };
}
