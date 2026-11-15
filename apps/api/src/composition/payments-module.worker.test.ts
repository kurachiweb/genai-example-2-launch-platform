import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type { PurchaseOfferPolicy } from '../../lib/core/payments/purchase-kind-contract.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearPaymentTables } from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
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
import * as mainModule from '../index.ts';
import { MODULES } from './modules.ts';

interface LoggedObject {
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
}

// 業務日付2026-11-02の業務時刻23:40と、翌業務日付の業務時刻4:21
const RECONCILIATION_TIME = new Date(Date.UTC(2026, 10, 3, 7, 40));
const DAILY_TIME = new Date(Date.UTC(2026, 10, 3, 12, 21));

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
    MODULES,
  );
}

function recordLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args[0] as LoggedObject);
    });
  }
  return logs;
}

async function runScheduled(
  cron: string,
  scheduledTime: Date,
): Promise<readonly JobSummary[]> {
  const logs = recordLogs();
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();

  await scheduled(
    createScheduledController({ cron, scheduledTime: scheduledTime.getTime() }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const summary = logs.find(
    ({ message }) => message === '定期実行を終えました',
  );
  return (summary?.['jobs'] ?? []) as readonly JobSummary[];
}

beforeEach(async () => {
  await clearPaymentTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのモジュールの一覧への決済の登録', () => {
  test('共通の束縛・APIサーバーの決済の束縛と、通知の部品が使うメール・利用者の共通の束縛を1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'payments-platform',
      'payments',
      'email-platform',
      'identity-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

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
    'モジュールの一覧の処理単位のコンテナから%sを解決する',
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

describe('決済のジョブの定期実行', () => {
  test('23:40の起動(40 7 * * *)で、突合のジョブがマッチの確定より先に束縛から解決されて成功する', async () => {
    const jobs = await runScheduled('40 7 * * *', RECONCILIATION_TIME);

    expect(jobs).toEqual([
      expect.objectContaining({
        name: 'payments.checkout-reconciliation',
        result: 'succeeded',
      }),
      expect.objectContaining({
        name: 'match-engine.match-settlement',
        result: 'succeeded',
      }),
    ]);
  });

  test('4:21の起動(21 12 * * *)で、日次の確認と7年の削除のジョブが束縛から解決されて成功する', async () => {
    const jobs = await runScheduled('21 12 * * *', DAILY_TIME);

    expect(jobs.filter(({ name }) => name.startsWith('payments.'))).toEqual([
      expect.objectContaining({
        name: 'payments.pending-checkout-sweep',
        result: 'succeeded',
      }),
      expect.objectContaining({
        name: 'payments.history-retention',
        result: 'succeeded',
      }),
    ]);
  });
});
