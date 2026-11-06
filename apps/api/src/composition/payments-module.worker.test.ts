import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';

import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type { PurchaseOfferPolicy } from '../../lib/core/payments/purchase-kind-contract.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createPaymentsPlatformModule } from '../../lib/workers/payments/payments-platform-module.ts';
import { StoreCheckoutConsentRecorder } from '../application/payments/checkout-consent-recorder.ts';
import type { PurchaseOfferPolicyResolver } from '../application/payments/checkout-ports.ts';
import { StripeCheckoutReader } from '../application/payments/checkout-reader.ts';
import { StripeCheckoutReturnConfirmer } from '../application/payments/checkout-return-confirmer.ts';
import { StripeCheckoutStarter } from '../application/payments/checkout-starter.ts';
import { CheckoutReconciliationJob } from '../application/payments/jobs/checkout-reconciliation-job.ts';
import { PaymentHistoryRetentionJob } from '../application/payments/jobs/payment-history-retention-job.ts';
import { PendingCheckoutSweepJob } from '../application/payments/jobs/pending-checkout-sweep-job.ts';
import { StorePaymentHistoryReader } from '../application/payments/payment-history-reader.ts';
import { API_PAYMENTS_TYPES } from '../application/payments/payments-types.ts';
import { CounterCheckoutStartLimits } from '../infrastructure/payments/counter-checkout-start-limits.ts';
import { D1CheckoutPurchaseWriter } from '../infrastructure/payments/d1-checkout-purchase-writer.ts';
import { SentryPaymentsJobIncidentReporter } from '../infrastructure/payments/sentry-payments-job-incident-reporter.ts';
import { MODULES } from './modules.ts';
import { API_PAYMENTS_MODULE } from './payments-module.ts';

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-api-payments-module',
        clientIp: undefined,
      },
    },
    [...MODULES, createPaymentsPlatformModule('api'), API_PAYMENTS_MODULE],
  );
}

afterAll(() => {
  resetSync();
});

describe('API_PAYMENTS_MODULE', () => {
  test.each([
    ['CheckoutStartLimits', CounterCheckoutStartLimits],
    ['CheckoutPurchaseWriter', D1CheckoutPurchaseWriter],
    ['PaymentsJobIncidentReporter', SentryPaymentsJobIncidentReporter],
    ['CheckoutStarter', StripeCheckoutStarter],
    ['CheckoutReader', StripeCheckoutReader],
    ['CheckoutConsentRecorder', StoreCheckoutConsentRecorder],
    ['CheckoutReturnConfirmer', StripeCheckoutReturnConfirmer],
    ['PaymentHistoryReader', StorePaymentHistoryReader],
    ['CheckoutReconciliationJob', CheckoutReconciliationJob],
    ['PendingCheckoutSweepJob', PendingCheckoutSweepJob],
    ['PaymentHistoryRetentionJob', PaymentHistoryRetentionJob],
  ] as const)(
    '共通の束縛と合わせた処理単位のコンテナから%sを解決する',
    (name, implementation) => {
      const container = createContainer();

      expect(container.get(API_PAYMENTS_TYPES[name])).toBeInstanceOf(
        implementation,
      );
    },
  );

  test('購入の可否の口の解決は、購入種別の登録の識別子を処理単位のコンテナから引く', () => {
    const container = createContainer();

    const policy = container
      .get<PurchaseOfferPolicyResolver>(
        API_PAYMENTS_TYPES.PurchaseOfferPolicyResolver,
      )
      .resolve(PAYMENTS_TYPES.SmokePurchaseOffer);

    expect(policy).toBe(
      container.get<PurchaseOfferPolicy>(PAYMENTS_TYPES.SmokePurchaseOffer),
    );
  });
});
