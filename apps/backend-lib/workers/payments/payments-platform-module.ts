import { type Bind, ContainerModule, type ResolutionContext } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type {
  CustomerDirectory,
  CustomerStore,
  OpenCheckoutExpirer,
  PaymentHistoryExport,
  PaymentRecordStore,
  PaymentReflector,
  PaymentRefunds,
  PaymentRevenueReport,
  PriceCatalog,
  PriceSnapshotStore,
  PurchaseNotifier,
  PurchaseStore,
  RefundStore,
  StripeGateway,
  StripeObjectStore,
} from '../../core/payments/ports.ts';
import type {
  PaymentsEnv,
  PurchaseKindRegistry,
  PurchaseOfferPolicy,
} from '../../core/payments/purchase-kind-contract.ts';
import {
  assertSubscriptionEventSinkNames,
  createPurchaseKindRegistry,
} from '../../core/payments/purchase-kind-registry.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';
import {
  type CheckoutSessionReflection,
  StripeCheckoutSessionReflection,
} from './checkout-session-reflection.ts';
import { D1CustomerStore } from './d1-customer-store.ts';
import { D1PaymentRecordStore } from './d1-payment-record-store.ts';
import { D1PaymentRevenueReport } from './d1-payment-revenue-report.ts';
import { D1PriceSnapshotStore } from './d1-price-snapshot-store.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { D1RefundStore } from './d1-refund-store.ts';
import { D1StripeObjectStore } from './d1-stripe-object-store.ts';
import type {
  PurchaseFulfillment,
  PurchaseKindRegistration,
  SubscriptionEventSink,
} from './fulfillment-contract.ts';
import { D1GuardedBatch } from './guarded-batch.ts';
import { StripeOpenCheckoutExpirer } from './open-checkout-expirer.ts';
import {
  type PaymentOwnerResolver,
  StripePaymentOwnerResolver,
} from './payment-owner-resolver.ts';
import { StoredPaymentHistoryExport } from './payment-history-export.ts';
import { StripePaymentReflector } from './payment-reflector.ts';
import { D1PaymentRefunds } from './payment-refunds.ts';
import { StripePriceCatalog } from './price-catalog.ts';
import {
  PURCHASE_KIND_REGISTRATIONS,
  SUBSCRIPTION_EVENT_SINKS,
} from './purchase-kind-registrations.ts';
import { EmailPurchaseNotifier } from './purchase-notifier.ts';
import {
  SmokePurchaseFulfillment,
  SmokePurchaseOfferPolicy,
} from './smoke-purchase.ts';
import type {
  CustomerStatements,
  GuardedBatch,
  PaymentRecordStatements,
  PaymentRefundStatements,
  PurchaseStatements,
  RefundStatements,
  StripeObjectStatements,
} from './statement-contracts.ts';
import { createStripeClient } from './stripe-client.ts';
import { StripeApiGateway } from './stripe-gateway.ts';

// 購入種別と受け取り口の登録の誤りを、最初の処理単位ではなくisolateの起動時に検出する
const PURCHASE_KIND_REGISTRY = createPurchaseKindRegistry(
  PURCHASE_KIND_REGISTRATIONS,
);
assertSubscriptionEventSinkNames(SUBSCRIPTION_EVENT_SINKS);

function paymentsEnvOf(context: ResolutionContext): PaymentsEnv {
  return context.get<PaymentsEnv>(PLATFORM_TYPES.Env);
}

function checkoutSessionReflectionOf(
  context: ResolutionContext,
  appName: LoggingOptions['appName'],
): CheckoutSessionReflection {
  return new StripeCheckoutSessionReflection({
    appName,
    db: context.get<Database>(PLATFORM_TYPES.Database),
    env: paymentsEnvOf(context),
    gateway: context.get<StripeGateway>(PAYMENTS_TYPES.StripeGateway),
    purchases: context.get<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore),
    purchaseStatements: context.get<PurchaseStatements>(
      PAYMENTS_TYPES.PurchaseStatements,
    ),
    records: context.get<PaymentRecordStore>(PAYMENTS_TYPES.PaymentRecordStore),
    recordStatements: context.get<PaymentRecordStatements>(
      PAYMENTS_TYPES.PaymentRecordStatements,
    ),
    guardedBatch: context.get<GuardedBatch>(PAYMENTS_TYPES.GuardedBatch),
    registry: context.get<PurchaseKindRegistry<PurchaseKindRegistration>>(
      PAYMENTS_TYPES.PurchaseKindRegistry,
    ),
    resolveFulfillment: (identifier) =>
      context.get<PurchaseFulfillment>(identifier),
    refunds: context.get<PaymentRefunds>(PAYMENTS_TYPES.PaymentRefunds),
    refundStatements: context.get<PaymentRefundStatements>(
      PAYMENTS_TYPES.PaymentRefundStatements,
    ),
    notifier: context.get<PurchaseNotifier>(PAYMENTS_TYPES.PurchaseNotifier),
    ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
    clock: context.get<Clock>(PLATFORM_TYPES.Clock),
  });
}

function paymentReflectorOf(
  context: ResolutionContext,
  appName: LoggingOptions['appName'],
): PaymentReflector {
  return new StripePaymentReflector({
    appName,
    db: context.get<Database>(PLATFORM_TYPES.Database),
    gateway: context.get<StripeGateway>(PAYMENTS_TYPES.StripeGateway),
    checkout: context.get<CheckoutSessionReflection>(
      PAYMENTS_TYPES.CheckoutSessionReflection,
    ),
    owners: context.get<PaymentOwnerResolver>(
      PAYMENTS_TYPES.PaymentOwnerResolver,
    ),
    purchases: context.get<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore),
    recordStatements: context.get<PaymentRecordStatements>(
      PAYMENTS_TYPES.PaymentRecordStatements,
    ),
    refunds: context.get<RefundStore>(PAYMENTS_TYPES.RefundStore),
    refundStatements: context.get<RefundStatements>(
      PAYMENTS_TYPES.RefundStatements,
    ),
    stripeObjects: context.get<StripeObjectStore>(
      PAYMENTS_TYPES.StripeObjectStore,
    ),
    stripeObjectStatements: context.get<StripeObjectStatements>(
      PAYMENTS_TYPES.StripeObjectStatements,
    ),
    guardedBatch: context.get<GuardedBatch>(PAYMENTS_TYPES.GuardedBatch),
    subscriptionSinks: SUBSCRIPTION_EVENT_SINKS,
    resolveSink: (identifier) => context.get<SubscriptionEventSink>(identifier),
    notifier: context.get<PurchaseNotifier>(PAYMENTS_TYPES.PurchaseNotifier),
    ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
    clock: context.get<Clock>(PLATFORM_TYPES.Clock),
  });
}

function bindStores(bind: Bind): void {
  bind<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore)
    .to(D1PurchaseStore)
    .inSingletonScope();
  bind<PurchaseStatements>(PAYMENTS_TYPES.PurchaseStatements).toService(
    PAYMENTS_TYPES.PurchaseStore,
  );
  bind<PaymentRecordStore>(PAYMENTS_TYPES.PaymentRecordStore)
    .to(D1PaymentRecordStore)
    .inSingletonScope();
  bind<PaymentRecordStatements>(
    PAYMENTS_TYPES.PaymentRecordStatements,
  ).toService(PAYMENTS_TYPES.PaymentRecordStore);
  bind<RefundStore>(PAYMENTS_TYPES.RefundStore)
    .to(D1RefundStore)
    .inSingletonScope();
  bind<RefundStatements>(PAYMENTS_TYPES.RefundStatements).toService(
    PAYMENTS_TYPES.RefundStore,
  );
  bind<CustomerStore>(PAYMENTS_TYPES.CustomerStore)
    .to(D1CustomerStore)
    .inSingletonScope();
  bind<CustomerDirectory>(PAYMENTS_TYPES.CustomerDirectory).toService(
    PAYMENTS_TYPES.CustomerStore,
  );
  bind<CustomerStatements>(PAYMENTS_TYPES.CustomerStatements).toService(
    PAYMENTS_TYPES.CustomerStore,
  );
  bind<StripeObjectStore>(PAYMENTS_TYPES.StripeObjectStore)
    .to(D1StripeObjectStore)
    .inSingletonScope();
  bind<StripeObjectStatements>(PAYMENTS_TYPES.StripeObjectStatements).toService(
    PAYMENTS_TYPES.StripeObjectStore,
  );
  bind<PriceSnapshotStore>(PAYMENTS_TYPES.PriceSnapshotStore)
    .to(D1PriceSnapshotStore)
    .inSingletonScope();
  bind<GuardedBatch>(PAYMENTS_TYPES.GuardedBatch)
    .to(D1GuardedBatch)
    .inSingletonScope();
}

function bindPurchaseKinds(bind: Bind): void {
  bind<PurchaseKindRegistry<PurchaseKindRegistration>>(
    PAYMENTS_TYPES.PurchaseKindRegistry,
  ).toConstantValue(PURCHASE_KIND_REGISTRY);
  bind<PurchaseOfferPolicy>(PAYMENTS_TYPES.SmokePurchaseOffer).toConstantValue(
    new SmokePurchaseOfferPolicy(),
  );
  bind<PurchaseFulfillment>(
    PAYMENTS_TYPES.SmokePurchaseFulfillment,
  ).toConstantValue(new SmokePurchaseFulfillment());
}

function bindStripe(bind: Bind, appName: LoggingOptions['appName']): void {
  bind<StripeGateway>(PAYMENTS_TYPES.StripeGateway)
    .toDynamicValue((context) => {
      const env = paymentsEnvOf(context);
      return new StripeApiGateway({
        appName,
        client: createStripeClient({ appName, apiKey: env.STRIPE_API_KEY }),
        clientSiteOrigin: env.CLIENT_SITE_ORIGIN,
      });
    })
    .inSingletonScope();
  bind<PaymentOwnerResolver>(PAYMENTS_TYPES.PaymentOwnerResolver)
    .toDynamicValue(
      (context) =>
        new StripePaymentOwnerResolver({
          appName,
          gateway: context.get<StripeGateway>(PAYMENTS_TYPES.StripeGateway),
          purchases: context.get<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore),
        }),
    )
    .inSingletonScope();
}

function bindReflection(bind: Bind, appName: LoggingOptions['appName']): void {
  bind<CheckoutSessionReflection>(PAYMENTS_TYPES.CheckoutSessionReflection)
    .toDynamicValue((context) => checkoutSessionReflectionOf(context, appName))
    .inSingletonScope();
  bind<PaymentReflector>(PAYMENTS_TYPES.PaymentReflector)
    .toDynamicValue((context) => paymentReflectorOf(context, appName))
    .inSingletonScope();
  bind<OpenCheckoutExpirer>(PAYMENTS_TYPES.OpenCheckoutExpirer)
    .toDynamicValue(
      (context) =>
        new StripeOpenCheckoutExpirer({
          appName,
          gateway: context.get<StripeGateway>(PAYMENTS_TYPES.StripeGateway),
          purchases: context.get<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore),
          reflection: context.get<CheckoutSessionReflection>(
            PAYMENTS_TYPES.CheckoutSessionReflection,
          ),
          ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
        }),
    )
    .inSingletonScope();
}

function bindRefundsAndNotices(
  bind: Bind,
  appName: LoggingOptions['appName'],
): void {
  bind<PaymentRefunds>(PAYMENTS_TYPES.PaymentRefunds)
    .toDynamicValue(
      (context) =>
        new D1PaymentRefunds({
          appName,
          db: context.get<Database>(PLATFORM_TYPES.Database),
          purchases: context.get<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore),
          refunds: context.get<RefundStore>(PAYMENTS_TYPES.RefundStore),
          refundStatements: context.get<RefundStatements>(
            PAYMENTS_TYPES.RefundStatements,
          ),
          publisher: context.get<MessagePublisher>(
            PLATFORM_TYPES.MessagePublisher,
          ),
          ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
        }),
    )
    .inSingletonScope();
  bind<PaymentRefundStatements>(
    PAYMENTS_TYPES.PaymentRefundStatements,
  ).toService(PAYMENTS_TYPES.PaymentRefunds);
  bind<PurchaseNotifier>(PAYMENTS_TYPES.PurchaseNotifier)
    .toDynamicValue(
      (context) =>
        new EmailPurchaseNotifier({
          appName,
          purchases: context.get<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore),
          refunds: context.get<RefundStore>(PAYMENTS_TYPES.RefundStore),
          contacts: context.get<UserContactDirectory>(
            IDENTITY_PLATFORM_TYPES.UserContactDirectory,
          ),
          emails: context.get<EmailSender>(EMAIL_TYPES.EmailSender),
          clientSiteOrigin: paymentsEnvOf(context).CLIENT_SITE_ORIGIN,
        }),
    )
    .inSingletonScope();
}

function bindQueries(bind: Bind, appName: LoggingOptions['appName']): void {
  bind<PriceCatalog>(PAYMENTS_TYPES.PriceCatalog)
    .toDynamicValue(
      (context) =>
        new StripePriceCatalog({
          appName,
          gateway: context.get<StripeGateway>(PAYMENTS_TYPES.StripeGateway),
          snapshots: context.get<PriceSnapshotStore>(
            PAYMENTS_TYPES.PriceSnapshotStore,
          ),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
        }),
    )
    .inSingletonScope();
  bind<PaymentHistoryExport>(PAYMENTS_TYPES.PaymentHistoryExport)
    .toDynamicValue(
      (context) =>
        new StoredPaymentHistoryExport({
          records: context.get<PaymentRecordStore>(
            PAYMENTS_TYPES.PaymentRecordStore,
          ),
        }),
    )
    .inSingletonScope();
  bind<PaymentRevenueReport>(PAYMENTS_TYPES.PaymentRevenueReport)
    .toDynamicValue(
      (context) =>
        new D1PaymentRevenueReport({
          appName,
          db: context.get<Database>(PLATFORM_TYPES.Database),
        }),
    )
    .inSingletonScope();
}

// Webhookの署名の検証はイベントサーバーだけが使うため、イベントサーバーの決済のモジュールが束縛する。後続specの購入種別のofferとfulfillmentの識別子は、その購入種別を受け持つ機能のモジュールが束縛する
export function createPaymentsPlatformModule(
  appName: LoggingOptions['appName'],
): Omit<AppModule, 'routes'> {
  return {
    name: 'payments-platform',
    bindings: new ContainerModule(({ bind }) => {
      bindStores(bind);
      bindPurchaseKinds(bind);
      bindStripe(bind, appName);
      bindReflection(bind, appName);
      bindRefundsAndNotices(bind, appName);
      bindQueries(bind, appName);
    }),
  };
}
