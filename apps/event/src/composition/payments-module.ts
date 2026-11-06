import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type { StripeWebhookVerifier } from '../../lib/core/payments/ports.ts';
import type { RefundPaymentBody } from '../../lib/core/payments/refund-message.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createPaymentsPlatformModule } from '../../lib/workers/payments/payments-platform-module.ts';
import { StripeWebhookSignatureVerifier } from '../../lib/workers/payments/stripe-webhook-verifier.ts';
import { CustomerErasureHandler } from '../application/payments/customer-erasure-handler.ts';
import { EVENT_PAYMENTS_TYPES } from '../application/payments/event-payments-types.ts';
import { OpenCheckoutExpiryHandler } from '../application/payments/open-checkout-expiry-handler.ts';
import type { PaymentAccountDataEraser } from '../application/payments/payment-account-data-eraser.ts';
import type { RefundIncidentReporter } from '../application/payments/refund-incidents.ts';
import { RefundPaymentHandler } from '../application/payments/refund-payment-handler.ts';
import {
  SignedStripeWebhookReceiver,
  type StripeWebhookReceiver,
} from '../application/payments/stripe-webhook-receiver.ts';
import { D1PaymentAccountDataEraser } from '../infrastructure/payments/d1-payment-account-data-eraser.ts';
import { SentryRefundIncidentReporter } from '../infrastructure/payments/sentry-refund-incident-reporter.ts';
import { registerStripeWebhookRoute } from '../presentation/payments/stripe-webhook-route.ts';
import type { EventEnv } from './env-schema.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export const EVENT_PAYMENTS_PLATFORM_MODULE: EventAppModule =
  createPaymentsPlatformModule('event');

// 共通の束縛(EVENT_PAYMENTS_PLATFORM_MODULE)が登録されている前提で、Webhookの署名の検証と受け付け・返金の処理・2つの波及処理と経路を束縛する
export const EVENT_PAYMENTS_MODULE: EventAppModule = {
  name: 'event-payments',
  bindings: new ContainerModule(({ bind }) => {
    bind<StripeWebhookVerifier>(PAYMENTS_TYPES.StripeWebhookVerifier)
      .toDynamicValue(
        (context) =>
          new StripeWebhookSignatureVerifier({
            appName: 'event',
            webhookSecret: context.get<EventEnv>(PLATFORM_TYPES.Env)
              .STRIPE_WEBHOOK_SECRET,
          }),
      )
      .inSingletonScope();
    bind<StripeWebhookReceiver>(EVENT_PAYMENTS_TYPES.StripeWebhookReceiver).to(
      SignedStripeWebhookReceiver,
    );
    bind<RefundIncidentReporter>(
      EVENT_PAYMENTS_TYPES.RefundIncidentReporter,
    ).to(SentryRefundIncidentReporter);
    bind<MessageHandler<RefundPaymentBody>>(
      EVENT_PAYMENTS_TYPES.RefundPaymentHandler,
    ).to(RefundPaymentHandler);
    bind<PaymentAccountDataEraser>(
      EVENT_PAYMENTS_TYPES.PaymentAccountDataEraser,
    ).to(D1PaymentAccountDataEraser);
    bind<UserLifecycleAsyncHandler>(
      EVENT_PAYMENTS_TYPES.CustomerErasureHandler,
    ).to(CustomerErasureHandler);
    bind<UserLifecycleAsyncHandler>(
      EVENT_PAYMENTS_TYPES.OpenCheckoutExpiryHandler,
    ).to(OpenCheckoutExpiryHandler);
  }),
  routes: registerStripeWebhookRoute,
};
