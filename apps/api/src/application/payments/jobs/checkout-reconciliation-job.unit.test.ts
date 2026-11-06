import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import {
  type PurchaseRecord,
  type StripeCheckoutSessionSnapshot,
  StripeNotFoundError,
  StripeUnavailableError,
} from '../../../../lib/core/payments/ports.ts';
import { ADVANCEABLE_FROM } from '../../../../lib/core/payments/purchase-rules.ts';
import { createCronRegistry } from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  HOUR_MS,
  sessionSnapshotOf,
} from '../../../../test/support/payments-checkout-fakes.ts';
import {
  createIncidentRecorder,
  createJobIds,
  createJobLogCapture,
  createJobReflector,
  createJobSessionGateway,
  InMemoryJobPurchases,
  jobContextAt,
  type JobReflection,
  jobPurchaseOf,
  MINUTE_MS,
  RECONCILIATION_TIME,
  RUN_CLOCK,
  RUN_CLOCK_TIME,
  type SessionBehavior,
  sessionIdOf,
} from '../../../../test/support/payments-job-fakes.ts';
import { API_PAYMENTS_TYPES } from '../payments-types.ts';
import {
  CHECKOUT_RECONCILIATION_JOB_DEFINITION,
  CHECKOUT_RECONCILIATION_LIMIT,
  CheckoutReconciliationJob,
} from './checkout-reconciliation-job.ts';
import type { PaymentsJobIncidentReporter } from './payments-job-incidents.ts';

const CRON = '40 7 * * *';

const DAY_MS = 24 * HOUR_MS;

// 月曜日23:35の決済期限
const DEADLINE = new Date(RECONCILIATION_TIME.getTime() - 5 * MINUTE_MS);

const logs = createJobLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

const expiredSnapshot = (sessionId: string): StripeCheckoutSessionSnapshot =>
  sessionSnapshotOf({ id: sessionId, status: 'expired', clientSecret: null });

const paidSnapshot = (sessionId: string): StripeCheckoutSessionSnapshot =>
  sessionSnapshotOf({
    id: sessionId,
    status: 'complete',
    paymentStatus: 'paid',
    clientSecret: null,
    paymentIntentId: `pi_test_${sessionId}`,
    paymentIntentStatus: 'succeeded',
  });

function reconcilableOf(
  serial: number,
  overrides: Partial<PurchaseRecord> = {},
): PurchaseRecord {
  return jobPurchaseOf(serial, {
    deadlineAt: DEADLINE,
    expiresAt: new Date(DEADLINE.getTime() - 30 * MINUTE_MS),
    ...overrides,
  });
}

function setup(
  purchases: readonly PurchaseRecord[],
  options: {
    readonly sessions?: ReadonlyMap<string, SessionBehavior>;
    readonly reflectionFailures?: ReadonlyMap<string, Error>;
  } = {},
) {
  const store = new InMemoryJobPurchases(purchases);
  const gatewayCalls: string[] = [];
  const reflections: JobReflection[] = [];
  const recorder = createIncidentRecorder();
  const job = new CheckoutReconciliationJob(
    store.store(),
    createJobSessionGateway(
      gatewayCalls,
      options.sessions ?? new Map(),
      expiredSnapshot,
    ),
    createJobReflector(store, reflections, options.reflectionFailures),
    RUN_CLOCK,
    createJobIds(),
    recorder.reporter,
  );
  return {
    job,
    store,
    gatewayCalls,
    reflections,
    incidents: recorder.incidents,
  };
}

const run = (job: CheckoutReconciliationJob) =>
  job.run(jobContextAt(RECONCILIATION_TIME, CRON));

describe('CHECKOUT_RECONCILIATION_JOB_DEFINITION', () => {
  test('業務時刻23:40・order 10で突合のジョブを登録する定義である', () => {
    expect(CHECKOUT_RECONCILIATION_JOB_DEFINITION).toEqual({
      name: 'payments.checkout-reconciliation',
      at: { hour: 23, minute: 40 },
      order: 10,
      handler: API_PAYMENTS_TYPES.CheckoutReconciliationJob,
    });
  });

  test('ジョブの定義の検証を通り、23:40の起動の式40 7 * * *で最初に動く', () => {
    const registry = createCronRegistry([
      CHECKOUT_RECONCILIATION_JOB_DEFINITION,
    ]);

    expect(registry.cronExpressions()).toEqual([CRON]);
    expect(registry.jobsFor(CRON)).toEqual([
      CHECKOUT_RECONCILIATION_JOB_DEFINITION,
    ]);
  });
});

describe('CheckoutReconciliationJob', () => {
  test('決済期限が実行時刻以前かつ24時間以内の未完了・処理中・置き換え済みの購入を最大200件で探す', async () => {
    const { job, store } = setup([]);

    await run(job);

    expect(CHECKOUT_RECONCILIATION_LIMIT).toBe(200);
    expect(store.queries.reconcilable).toEqual([
      {
        deadlineFrom: new Date(RECONCILIATION_TIME.getTime() - DAY_MS),
        deadlineTo: RECONCILIATION_TIME,
        limit: 201,
      },
    ]);
  });

  test('範囲の両端を含め、範囲の外・完了済み・決済セッションの無い購入を突合しない', async () => {
    const atDeadlineTo = reconcilableOf(1, { deadlineAt: RECONCILIATION_TIME });
    const atDeadlineFrom = reconcilableOf(2, {
      deadlineAt: new Date(RECONCILIATION_TIME.getTime() - DAY_MS),
      status: 'processing',
    });
    const superseded = reconcilableOf(3, { status: 'superseded' });
    const purchases = [
      atDeadlineTo,
      atDeadlineFrom,
      superseded,
      reconcilableOf(4, {
        deadlineAt: new Date(RECONCILIATION_TIME.getTime() + 1),
      }),
      reconcilableOf(5, {
        deadlineAt: new Date(RECONCILIATION_TIME.getTime() - DAY_MS - 1),
      }),
      reconcilableOf(6, { status: 'fulfilled' }),
      reconcilableOf(7, { stripeCheckoutSessionId: null }),
    ];
    const { job, gatewayCalls } = setup(purchases);

    await run(job);

    expect(gatewayCalls.toSorted()).toEqual(
      [1, 2, 3].map((serial) => `retrieve:${sessionIdOf(serial)}`).toSorted(),
    );
  });

  test('購入ごとに決済セッションを取得して反映し、支払い済みは確定・失効と未払いは失効になる', async () => {
    const paid = reconcilableOf(1);
    const expired = reconcilableOf(2);
    const unpaid = reconcilableOf(3, { status: 'processing' });
    const { job, store, gatewayCalls, reflections, incidents } = setup(
      [paid, expired, unpaid],
      {
        sessions: new Map<string, SessionBehavior>([
          [
            sessionIdOf(1),
            { kind: 'snapshot', snapshot: paidSnapshot(sessionIdOf(1)) },
          ],
          [
            sessionIdOf(3),
            {
              kind: 'snapshot',
              snapshot: sessionSnapshotOf({
                id: sessionIdOf(3),
                status: 'complete',
                paymentStatus: 'unpaid',
                paymentIntentStatus: 'requires_payment_method',
              }),
            },
          ],
        ]),
      },
    );

    await run(job);

    expect(gatewayCalls).toEqual(
      [1, 2, 3].map((serial) => `retrieve:${sessionIdOf(serial)}`),
    );
    expect(reflections).toEqual(
      [1, 2, 3].map((serial) => ({
        sessionId: sessionIdOf(serial),
        occurredAt: RUN_CLOCK_TIME,
      })),
    );
    expect(store.statuses()).toEqual({
      [paid.id]: 'fulfilled',
      [expired.id]: 'expired',
      [unpaid.id]: 'expired',
    });
    expect(incidents).toEqual([]);
    expect(logs.of('checkout-reconciliation')).toEqual([
      {
        level: 'info',
        properties: {
          targets: 3,
          applied: 3,
          unchanged: 0,
          failed: 0,
          limitReached: false,
        },
      },
    ]);
  });

  test('Stripeに到達できない購入と反映に失敗した購入を購入IDとジョブの名前で通知し、残りの購入の突合を続ける', async () => {
    const unreachableError = new StripeUnavailableError(
      'Stripeに接続できません',
    );
    const reflectionError = new Error('D1に書き込めません');
    const purchases = [1, 2, 3, 4].map((serial) => reconcilableOf(serial));
    const { job, store, gatewayCalls, incidents } = setup(purchases, {
      sessions: new Map<string, SessionBehavior>([
        [sessionIdOf(1), { kind: 'error', error: unreachableError }],
      ]),
      reflectionFailures: new Map([[sessionIdOf(3), reflectionError]]),
    });

    await run(job);

    expect(gatewayCalls).toHaveLength(4);
    expect(store.statuses()).toEqual({
      [purchases[0]?.id ?? '']: 'open',
      [purchases[1]?.id ?? '']: 'expired',
      [purchases[2]?.id ?? '']: 'open',
      [purchases[3]?.id ?? '']: 'expired',
    });
    expect(incidents).toEqual([
      {
        kind: 'reconciliation-failed',
        job: 'payments.checkout-reconciliation',
        purchaseId: purchases[0]?.id ?? '',
        error: unreachableError,
      },
      {
        kind: 'reconciliation-failed',
        job: 'payments.checkout-reconciliation',
        purchaseId: purchases[2]?.id ?? '',
        error: reflectionError,
      },
    ]);
    expect(logs.of('checkout-reconciliation').at(-1)).toEqual({
      level: 'info',
      properties: {
        targets: 4,
        applied: 2,
        unchanged: 0,
        failed: 2,
        limitReached: false,
      },
    });
  });

  test('Stripeに決済セッションが無い購入は失効へ前進させてwarnを残し、失敗として知らせず、翌日の突合の対象にしない', async () => {
    const missing = reconcilableOf(1, { status: 'processing' });
    const fine = reconcilableOf(2);
    const { job, store, gatewayCalls, incidents } = setup([missing, fine], {
      sessions: new Map<string, SessionBehavior>([
        [
          sessionIdOf(1),
          {
            kind: 'error',
            error: new StripeNotFoundError('No such checkout session'),
          },
        ],
      ]),
    });

    await run(job);

    expect(store.advances).toEqual([
      {
        purchaseId: missing.id,
        to: 'expired',
        from: ADVANCEABLE_FROM.expired,
        nextToken: createJobIds().generate(),
        patch: { lastEventAt: RUN_CLOCK_TIME },
      },
    ]);
    expect(store.statuses()).toEqual({
      [missing.id]: 'expired',
      [fine.id]: 'expired',
    });
    expect(incidents).toEqual([]);
    expect(logs.of('checkout-expiry')).toEqual([
      {
        level: 'warning',
        properties: { purchaseId: missing.id, sessionId: sessionIdOf(1) },
      },
    ]);
    expect(logs.of('checkout-reconciliation').at(-1)).toEqual({
      level: 'info',
      properties: {
        targets: 2,
        applied: 2,
        unchanged: 0,
        failed: 0,
        limitReached: false,
      },
    });

    await run(job);

    expect(gatewayCalls).toEqual([
      `retrieve:${sessionIdOf(1)}`,
      `retrieve:${sessionIdOf(2)}`,
    ]);
  });

  test('Stripeに決済セッションが無い購入が既に前進の元の状態でなければ、変えずに未変更として数える', async () => {
    const missing = reconcilableOf(1);
    const store = new InMemoryJobPurchases([missing]);
    const recorder = createIncidentRecorder();
    const purchases = store.store();
    const job = new CheckoutReconciliationJob(
      {
        ...purchases,
        // 取得から前進までの間に、Webhookの反映が先に確定させた場合
        advanceAlone: (input) => {
          store.update(missing.id, { status: 'fulfilled' });
          return purchases.advanceAlone(input);
        },
      },
      createJobSessionGateway(
        [],
        new Map<string, SessionBehavior>([
          [
            sessionIdOf(1),
            {
              kind: 'error',
              error: new StripeNotFoundError('No such checkout session'),
            },
          ],
        ]),
        expiredSnapshot,
      ),
      createJobReflector(store, []),
      RUN_CLOCK,
      createJobIds(),
      recorder.reporter,
    );

    await run(job);

    expect(store.statuses()).toEqual({ [missing.id]: 'fulfilled' });
    expect(recorder.incidents).toEqual([]);
    expect(logs.of('checkout-reconciliation').at(-1)?.properties).toEqual({
      targets: 1,
      applied: 0,
      unchanged: 1,
      failed: 0,
      limitReached: false,
    });
  });

  test('対象が200件を超えたら古い決済期限の順に200件だけ突合し、残りがある旨をwarnで記録する', async () => {
    const purchases = Array.from({ length: 201 }, (_, index) =>
      reconcilableOf(index + 1, {
        deadlineAt: new Date(DEADLINE.getTime() - (201 - index) * MINUTE_MS),
      }),
    );
    const { job, gatewayCalls, store } = setup(purchases);

    await run(job);

    expect(gatewayCalls).toHaveLength(200);
    expect(gatewayCalls).not.toContain(`retrieve:${sessionIdOf(201)}`);
    expect(store.get(purchases[200]?.id ?? '')?.status).toBe('open');
    expect(logs.of('checkout-reconciliation')).toEqual([
      { level: 'warning', properties: { limit: 200 } },
      {
        level: 'info',
        properties: {
          targets: 200,
          applied: 200,
          unchanged: 0,
          failed: 0,
          limitReached: true,
        },
      },
    ]);
  });

  test('対象の検索に失敗したら例外をそのまま定期実行の記録へ投げる', async () => {
    const failure = new Error('D1に接続できません');
    const store = new InMemoryJobPurchases();
    const recorder = createIncidentRecorder();
    const purchases = store.store();
    const job = new CheckoutReconciliationJob(
      { ...purchases, findReconcilable: () => Promise.reject(failure) },
      createJobSessionGateway([], new Map(), expiredSnapshot),
      createJobReflector(store, []),
      RUN_CLOCK,
      createJobIds(),
      recorder.reporter,
    );

    expect(await run(job).catch((error: unknown) => error)).toBe(failure);
    expect(recorder.incidents).toEqual([]);
  });

  test('2回実行しても購入の状態は1回目の結果と変わらず、2回目は確定済みの購入を取得しない', async () => {
    const purchases = [1, 2].map((serial) => reconcilableOf(serial));
    const { job, store, gatewayCalls } = setup(purchases, {
      sessions: new Map<string, SessionBehavior>([
        [
          sessionIdOf(1),
          { kind: 'snapshot', snapshot: paidSnapshot(sessionIdOf(1)) },
        ],
      ]),
    });

    await run(job);
    const afterFirst = store.statuses();
    await run(job);

    expect(store.statuses()).toEqual(afterFirst);
    expect(afterFirst).toEqual({
      [purchases[0]?.id ?? '']: 'fulfilled',
      [purchases[1]?.id ?? '']: 'expired',
    });
    expect(gatewayCalls).toHaveLength(2);
  });

  test('DIコンテナから共通の契約の識別子で依存を受け取って解決できる', async () => {
    const store = new InMemoryJobPurchases([reconcilableOf(1)]);
    const recorder = createIncidentRecorder();
    const container = new Container();
    container.bind(PAYMENTS_TYPES.PurchaseStore).toConstantValue(store.store());
    container
      .bind(PAYMENTS_TYPES.StripeGateway)
      .toConstantValue(createJobSessionGateway([], new Map(), expiredSnapshot));
    container
      .bind(PAYMENTS_TYPES.PaymentReflector)
      .toConstantValue(createJobReflector(store, []));
    container.bind(PLATFORM_TYPES.Clock).toConstantValue(RUN_CLOCK);
    container.bind(PLATFORM_TYPES.IdGenerator).toConstantValue(createJobIds());
    container
      .bind<PaymentsJobIncidentReporter>(
        API_PAYMENTS_TYPES.PaymentsJobIncidentReporter,
      )
      .toConstantValue(recorder.reporter);
    container
      .bind(API_PAYMENTS_TYPES.CheckoutReconciliationJob)
      .to(CheckoutReconciliationJob);

    await container
      .get<CheckoutReconciliationJob>(
        API_PAYMENTS_TYPES.CheckoutReconciliationJob,
      )
      .run(jobContextAt(RECONCILIATION_TIME, CRON));

    expect(store.statuses()).toEqual({ [reconcilableOf(1).id]: 'expired' });
  });
});
