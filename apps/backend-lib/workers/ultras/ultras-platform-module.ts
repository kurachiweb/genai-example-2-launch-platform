import { type Bind, ContainerModule, type ResolutionContext } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type { PriceCatalog } from '../../core/payments/ports.ts';
import type { PurchaseOfferPolicy } from '../../core/payments/purchase-kind-contract.ts';
import type { Clock } from '../../core/time/clock.ts';
import { ULTRAS_TYPES } from '../../core/ultras/identifiers.ts';
import type {
  ActivationDispatcher,
  ActivationStore,
  NoticeStore,
  SubscriptionStore,
  UltrasEntitlements,
  UltrasNotifier,
  UltrasPlanExport,
  UltrasPromotionFlagReader,
} from '../../core/ultras/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';
import type {
  PurchaseFulfillment,
  SubscriptionEventSink,
} from '../payments/fulfillment-contract.ts';
import { QueueActivationDispatcher } from './activation-dispatcher.ts';
import { D1ActivationStore } from './d1-activation-store.ts';
import { D1NoticeStore } from './d1-notice-store.ts';
import { D1PromotionFlagReader } from './d1-promotion-flag-reader.ts';
import { D1SubscriptionStore } from './d1-subscription-store.ts';
import { PlanStateSink } from './plan-state-sink.ts';
import type {
  ActivationStatements,
  NoticeStatements,
  SubscriptionStatements,
} from './statement-contracts.ts';
import { StoredUltrasEntitlements } from './ultras-entitlements.ts';
import { UltrasFulfillment } from './ultras-fulfillment.ts';
import { EmailUltrasNotifier } from './ultras-notifier.ts';
import { UltrasOfferPolicy } from './ultras-offer-policy.ts';
import { StoredUltrasPlanExport } from './ultras-plan-export.ts';

type AppName = LoggingOptions['appName'];

// メールに載せるプラン管理画面のURLの組み立てに使う環境の値
interface UltrasEnv {
  readonly CLIENT_SITE_ORIGIN: string;
}

// D1の実装は文を返さない操作と文の契約の両方を実装するため、2つの識別子を同じインスタンスへ解決する
function bindStores(bind: Bind): void {
  bind<SubscriptionStore>(ULTRAS_TYPES.SubscriptionStore)
    .to(D1SubscriptionStore)
    .inSingletonScope();
  bind<SubscriptionStatements>(ULTRAS_TYPES.SubscriptionStatements).toService(
    ULTRAS_TYPES.SubscriptionStore,
  );
  bind<ActivationStore>(ULTRAS_TYPES.ActivationStore)
    .to(D1ActivationStore)
    .inSingletonScope();
  bind<ActivationStatements>(ULTRAS_TYPES.ActivationStatements).toService(
    ULTRAS_TYPES.ActivationStore,
  );
  bind<NoticeStore>(ULTRAS_TYPES.NoticeStore)
    .to(D1NoticeStore)
    .inSingletonScope();
  bind<NoticeStatements>(ULTRAS_TYPES.NoticeStatements).toService(
    ULTRAS_TYPES.NoticeStore,
  );
  bind<UltrasPromotionFlagReader>(ULTRAS_TYPES.UltrasPromotionFlagReader)
    .to(D1PromotionFlagReader)
    .inSingletonScope();
}

function bindQueries(bind: Bind): void {
  bind<UltrasEntitlements>(ULTRAS_TYPES.UltrasEntitlements)
    .to(StoredUltrasEntitlements)
    .inSingletonScope();
  bind<UltrasPlanExport>(ULTRAS_TYPES.UltrasPlanExport)
    .to(StoredUltrasPlanExport)
    .inSingletonScope();
}

function bindNotifications(bind: Bind, appName: AppName): void {
  bind<ActivationDispatcher>(ULTRAS_TYPES.ActivationDispatcher)
    .toDynamicValue(
      (context) =>
        new QueueActivationDispatcher({
          appName,
          publisher: context.get<MessagePublisher>(
            PLATFORM_TYPES.MessagePublisher,
          ),
          activations: context.get<ActivationStore>(
            ULTRAS_TYPES.ActivationStore,
          ),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
        }),
    )
    .inSingletonScope();
  bind<UltrasNotifier>(ULTRAS_TYPES.UltrasNotifier)
    .toDynamicValue(
      (context) =>
        new EmailUltrasNotifier({
          appName,
          notices: context.get<NoticeStore>(ULTRAS_TYPES.NoticeStore),
          contacts: context.get<UserContactDirectory>(
            IDENTITY_PLATFORM_TYPES.UserContactDirectory,
          ),
          emails: context.get<EmailSender>(EMAIL_TYPES.EmailSender),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
          clientSiteOrigin: context.get<UltrasEnv>(PLATFORM_TYPES.Env)
            .CLIENT_SITE_ORIGIN,
        }),
    )
    .inSingletonScope();
}

function offerPolicyOf(
  context: ResolutionContext,
  appName: AppName,
): UltrasOfferPolicy {
  return new UltrasOfferPolicy({
    appName,
    flags: context.get<UltrasPromotionFlagReader>(
      ULTRAS_TYPES.UltrasPromotionFlagReader,
    ),
    entitlements: context.get<UltrasEntitlements>(
      ULTRAS_TYPES.UltrasEntitlements,
    ),
    prices: context.get<PriceCatalog>(PAYMENTS_TYPES.PriceCatalog),
  });
}

function fulfillmentOf(
  context: ResolutionContext,
  appName: AppName,
): UltrasFulfillment {
  return new UltrasFulfillment({
    appName,
    subscriptions: context.get<SubscriptionStore>(
      ULTRAS_TYPES.SubscriptionStore,
    ),
    subscriptionStatements: context.get<SubscriptionStatements>(
      ULTRAS_TYPES.SubscriptionStatements,
    ),
    activations: context.get<ActivationStore>(ULTRAS_TYPES.ActivationStore),
    activationStatements: context.get<ActivationStatements>(
      ULTRAS_TYPES.ActivationStatements,
    ),
    dispatcher: context.get<ActivationDispatcher>(
      ULTRAS_TYPES.ActivationDispatcher,
    ),
    ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
  });
}

function planStateSinkOf(
  context: ResolutionContext,
  appName: AppName,
): PlanStateSink {
  return new PlanStateSink({
    appName,
    subscriptions: context.get<SubscriptionStore>(
      ULTRAS_TYPES.SubscriptionStore,
    ),
    subscriptionStatements: context.get<SubscriptionStatements>(
      ULTRAS_TYPES.SubscriptionStatements,
    ),
    noticeStatements: context.get<NoticeStatements>(
      ULTRAS_TYPES.NoticeStatements,
    ),
    notifier: context.get<UltrasNotifier>(ULTRAS_TYPES.UltrasNotifier),
    ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
  });
}

// paymentsの登録箇所(purchase-kind-registrations.ts)が指す購入の可否・権利の付与・定期課金の受け取り口の識別子を束縛する
function bindPaymentsPorts(bind: Bind, appName: AppName): void {
  bind<PurchaseOfferPolicy>(ULTRAS_TYPES.UltrasOfferPolicy)
    .toDynamicValue((context) => offerPolicyOf(context, appName))
    .inSingletonScope();
  bind<PurchaseFulfillment>(ULTRAS_TYPES.UltrasFulfillment)
    .toDynamicValue((context) => fulfillmentOf(context, appName))
    .inSingletonScope();
  bind<SubscriptionEventSink>(ULTRAS_TYPES.PlanStateSink)
    .toDynamicValue((context) => planStateSinkOf(context, appName))
    .inSingletonScope();
}

// paymentsの反映が両アプリで動くため、apiとeventの束縛の一覧の両方へそれぞれのアプリ名で加える
export function createUltrasPlatformModule(
  appName: AppName,
): Omit<AppModule, 'routes'> {
  return {
    name: 'ultras-platform',
    bindings: new ContainerModule(({ bind }) => {
      bindStores(bind);
      bindQueries(bind);
      bindNotifications(bind, appName);
      bindPaymentsPorts(bind, appName);
    }),
  };
}
