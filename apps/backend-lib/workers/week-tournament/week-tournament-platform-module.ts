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
import type {
  WeekAwardExport,
  WeekChampionDirectory,
  WeekDrawService,
  WeekEntryFollowUp,
  WeekEntryRegistrar,
  WeekNotificationPublisher,
  WeekProgressionService,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { PurchaseFulfillment } from '../payments/fulfillment-contract.ts';
import { D1WeekAwardExport } from './d1-week-award-export.ts';
import { D1WeekChampionDirectory } from './d1-week-champion-directory.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import { WeekTournamentDrawService } from './week-draw-service.ts';
import { WeekEntryRefundFollowUp } from './week-entry-follow-up.ts';
import { WeekEntryFulfillment } from './week-entry-fulfillment.ts';
import { WeekEntryOfferPolicy } from './week-entry-offer-policy.ts';
import { QualifierWeekEntryRegistrar } from './week-entry-registrar.ts';
import { WeekTournamentNotificationPublisher } from './week-notification-publisher.ts';
import { WeekTournamentProgressionService } from './week-progression-service.ts';

type AppName = LoggingOptions['appName'];

// 返金の知らせのメールに載せる決済履歴のURLの組み立てに使う環境の値
interface WeekTournamentEnv {
  readonly CLIENT_SITE_ORIGIN: string;
}

const storeOf = (context: ResolutionContext): WeekTournamentStore =>
  context.get<WeekTournamentStore>(WEEK_TOURNAMENT_TYPES.WeekTournamentStore);

const productsOf = (context: ResolutionContext): ProductDirectory =>
  context.get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory);

const entitlementsOf = (context: ResolutionContext): UltrasEntitlements =>
  context.get<UltrasEntitlements>(ULTRAS_TYPES.UltrasEntitlements);

const matchesOf = (context: ResolutionContext): MatchDirectory =>
  context.get<MatchDirectory>(MATCH_PLATFORM_TYPES.MatchDirectory);

function bindQueries(bind: Bind): void {
  bind<WeekTournamentStore>(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    .to(D1WeekTournamentStore)
    .inSingletonScope();
  bind<WeekChampionDirectory>(WEEK_TOURNAMENT_TYPES.WeekChampionDirectory)
    .to(D1WeekChampionDirectory)
    .inSingletonScope();
  bind<WeekAwardExport>(WEEK_TOURNAMENT_TYPES.WeekAwardExport)
    .to(D1WeekAwardExport)
    .inSingletonScope();
}

// paymentsの登録箇所(purchase-kind-registrations.ts)が指す購入の可否と参加資格の付与の識別子を束縛する
function bindPaymentsPorts(bind: Bind): void {
  bind<PurchaseOfferPolicy>(WEEK_TOURNAMENT_TYPES.WeekEntryOfferPolicy)
    .toDynamicValue(
      (context) =>
        new WeekEntryOfferPolicy(
          storeOf(context),
          productsOf(context),
          entitlementsOf(context),
        ),
    )
    .inSingletonScope();
  bind<PurchaseFulfillment>(WEEK_TOURNAMENT_TYPES.WeekEntryFulfillment)
    .toDynamicValue(
      (context) =>
        new WeekEntryFulfillment(storeOf(context), productsOf(context)),
    )
    .inSingletonScope();
}

function bindEntries(bind: Bind, appName: AppName): void {
  bind<WeekEntryRegistrar>(WEEK_TOURNAMENT_TYPES.WeekEntryRegistrar)
    .toDynamicValue(
      (context) =>
        new QualifierWeekEntryRegistrar(
          storeOf(context),
          entitlementsOf(context),
          context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
          appName,
        ),
    )
    .inSingletonScope();
  bind<WeekEntryFollowUp>(WEEK_TOURNAMENT_TYPES.WeekEntryFollowUp)
    .toDynamicValue(
      (context) =>
        new WeekEntryRefundFollowUp({
          appName,
          store: storeOf(context),
          refunds: context.get<PaymentRefunds>(PAYMENTS_TYPES.PaymentRefunds),
          contacts: context.get<UserContactDirectory>(
            IDENTITY_PLATFORM_TYPES.UserContactDirectory,
          ),
          emails: context.get<EmailSender>(EMAIL_TYPES.EmailSender),
          clientSiteOrigin: context.get<WeekTournamentEnv>(PLATFORM_TYPES.Env)
            .CLIENT_SITE_ORIGIN,
        }),
    )
    .inSingletonScope();
}

function bindTournamentServices(bind: Bind, appName: AppName): void {
  bind<WeekNotificationPublisher>(
    WEEK_TOURNAMENT_TYPES.WeekNotificationPublisher,
  )
    .toDynamicValue(
      (context) =>
        new WeekTournamentNotificationPublisher(
          storeOf(context),
          matchesOf(context),
          context.get<NotificationEventPublisher>(
            NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher,
          ),
          appName,
        ),
    )
    .inSingletonScope();
  bind<WeekProgressionService>(WEEK_TOURNAMENT_TYPES.WeekProgressionService)
    .toDynamicValue(
      (context) =>
        new WeekTournamentProgressionService(
          storeOf(context),
          context.get<BracketProgression>(
            TOURNAMENT_PLATFORM_TYPES.BracketProgression,
          ),
          context.get<WeekNotificationPublisher>(
            WEEK_TOURNAMENT_TYPES.WeekNotificationPublisher,
          ),
          appName,
        ),
    )
    .inSingletonScope();
  bind<WeekDrawService>(WEEK_TOURNAMENT_TYPES.WeekDrawService)
    .toDynamicValue(
      (context) =>
        new WeekTournamentDrawService({
          appName,
          store: storeOf(context),
          registrar: context.get<WeekEntryRegistrar>(
            WEEK_TOURNAMENT_TYPES.WeekEntryRegistrar,
          ),
          matches: matchesOf(context),
          products: productsOf(context),
          entitlements: entitlementsOf(context),
          bracketDraw: context.get<BracketDraw>(
            TOURNAMENT_PLATFORM_TYPES.BracketDraw,
          ),
          progression: context.get<WeekProgressionService>(
            WEEK_TOURNAMENT_TYPES.WeekProgressionService,
          ),
          followUp: context.get<WeekEntryFollowUp>(
            WEEK_TOURNAMENT_TYPES.WeekEntryFollowUp,
          ),
        }),
    )
    .inSingletonScope();
}

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。部品はマッチ・トーナメント・決済・Ultras・通知・プロダクト・利用者・メールの共通の束縛が同じコンテナにある前提で組み立て、アプリの名前はログのカテゴリの先頭になる
export function createWeekTournamentPlatformModule(
  appName: AppName,
): Omit<AppModule, 'routes'> {
  return {
    name: 'week-tournament-platform',
    bindings: new ContainerModule(({ bind }) => {
      bindQueries(bind);
      bindPaymentsPorts(bind);
      bindEntries(bind, appName);
      bindTournamentServices(bind, appName);
    }),
  };
}
