import type { Hono } from 'hono';
import { type Bind, ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PurchaseOfferPolicy } from '../../lib/core/payments/purchase-kind-contract.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createPaymentsPlatformModule } from '../../lib/workers/payments/payments-platform-module.ts';
import {
  type CheckoutConsentRecorder,
  StoreCheckoutConsentRecorder,
} from '../application/payments/checkout-consent-recorder.ts';
import type {
  CheckoutPurchaseWriter,
  CheckoutStartLimits,
  PurchaseOfferPolicyResolver,
} from '../application/payments/checkout-ports.ts';
import {
  type CheckoutReader,
  StripeCheckoutReader,
} from '../application/payments/checkout-reader.ts';
import {
  type CheckoutReturnConfirmer,
  StripeCheckoutReturnConfirmer,
} from '../application/payments/checkout-return-confirmer.ts';
import {
  type CheckoutStarter,
  StripeCheckoutStarter,
} from '../application/payments/checkout-starter.ts';
import { CheckoutReconciliationJob } from '../application/payments/jobs/checkout-reconciliation-job.ts';
import { PaymentHistoryRetentionJob } from '../application/payments/jobs/payment-history-retention-job.ts';
import type { PaymentsJobIncidentReporter } from '../application/payments/jobs/payments-job-incidents.ts';
import { PendingCheckoutSweepJob } from '../application/payments/jobs/pending-checkout-sweep-job.ts';
import {
  type PaymentHistoryReader,
  StorePaymentHistoryReader,
} from '../application/payments/payment-history-reader.ts';
import { API_PAYMENTS_TYPES } from '../application/payments/payments-types.ts';
import { CounterCheckoutStartLimits } from '../infrastructure/payments/counter-checkout-start-limits.ts';
import { D1CheckoutPurchaseWriter } from '../infrastructure/payments/d1-checkout-purchase-writer.ts';
import { SentryPaymentsJobIncidentReporter } from '../infrastructure/payments/sentry-payments-job-incident-reporter.ts';

function bindPorts(bind: Bind): void {
  bind<CheckoutStartLimits>(API_PAYMENTS_TYPES.CheckoutStartLimits).to(
    CounterCheckoutStartLimits,
  );
  bind<CheckoutPurchaseWriter>(API_PAYMENTS_TYPES.CheckoutPurchaseWriter).to(
    D1CheckoutPurchaseWriter,
  );
  // 購入の可否の口は購入種別を受け持つ各機能のモジュールが束縛するため、呼ばれた時点の処理単位のコンテナから引く
  bind<PurchaseOfferPolicyResolver>(
    API_PAYMENTS_TYPES.PurchaseOfferPolicyResolver,
  ).toDynamicValue((context) => ({
    resolve: (identifier) => context.get<PurchaseOfferPolicy>(identifier),
  }));
  bind<PaymentsJobIncidentReporter>(
    API_PAYMENTS_TYPES.PaymentsJobIncidentReporter,
  ).to(SentryPaymentsJobIncidentReporter);
}

function bindUseCases(bind: Bind): void {
  bind<CheckoutStarter>(API_PAYMENTS_TYPES.CheckoutStarter).to(
    StripeCheckoutStarter,
  );
  bind<CheckoutReader>(API_PAYMENTS_TYPES.CheckoutReader).to(
    StripeCheckoutReader,
  );
  bind<CheckoutConsentRecorder>(API_PAYMENTS_TYPES.CheckoutConsentRecorder).to(
    StoreCheckoutConsentRecorder,
  );
  bind<CheckoutReturnConfirmer>(API_PAYMENTS_TYPES.CheckoutReturnConfirmer).to(
    StripeCheckoutReturnConfirmer,
  );
  bind<PaymentHistoryReader>(API_PAYMENTS_TYPES.PaymentHistoryReader).to(
    StorePaymentHistoryReader,
  );
}

function bindJobs(bind: Bind): void {
  bind<ScheduledJobHandler>(API_PAYMENTS_TYPES.CheckoutReconciliationJob).to(
    CheckoutReconciliationJob,
  );
  bind<ScheduledJobHandler>(API_PAYMENTS_TYPES.PendingCheckoutSweepJob).to(
    PendingCheckoutSweepJob,
  );
  bind<ScheduledJobHandler>(API_PAYMENTS_TYPES.PaymentHistoryRetentionJob).to(
    PaymentHistoryRetentionJob,
  );
}

export const API_PAYMENTS_PLATFORM_MODULE: AppModule<
  Hono<PlatformHonoEnv<Env>>
> = createPaymentsPlatformModule('api');

// 共通の束縛(API_PAYMENTS_PLATFORM_MODULE)・利用者の確認(IDENTITY_PLATFORM_TYPES)・厳密カウンタとキー付きハッシュ(PLATFORM_TYPES)は他のモジュールの束縛を使う
export const API_PAYMENTS_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'payments',
  bindings: new ContainerModule(({ bind }) => {
    bindPorts(bind);
    bindUseCases(bind);
    bindJobs(bind);
  }),
};
