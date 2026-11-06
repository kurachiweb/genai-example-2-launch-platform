import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import {
  type PurchaseRecord,
  type RefundRequestRecord,
  type StripeCheckoutSessionSnapshot,
  StripeUnavailableError,
} from '../../../../lib/core/payments/ports.ts';
import { createCronRegistry } from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  HOUR_MS,
  sessionSnapshotOf,
} from '../../../../test/support/payments-checkout-fakes.ts';
import {
  clockByCalls,
  createIncidentRecorder,
  createJobIds,
  createJobLogCapture,
  createJobNotifier,
  createJobPaymentRefunds,
  createJobReflector,
  createJobSessionGateway,
  InMemoryJobPurchases,
  InMemoryJobRefunds,
  jobContextAt,
  jobPurchaseOf,
  type JobReflection,
  jobRefundOf,
  MINUTE_MS,
  type NoticeBehavior,
  type NoticeCalls,
  RUN_CLOCK,
  RUN_CLOCK_TIME,
  type SessionBehavior,
  sessionIdOf,
  SWEEP_TIME,
} from '../../../../test/support/payments-job-fakes.ts';
import { API_PAYMENTS_TYPES } from '../payments-types.ts';
import type { PaymentsJobIncidentReporter } from './payments-job-incidents.ts';
import {
  PENDING_CHECKOUT_SWEEP_JOB_DEFINITION,
  PENDING_NOTICE_LIMIT,
  PendingCheckoutSweepJob,
  STALE_CHECKOUT_LIMIT,
  STALE_CHECKOUT_TIME_LIMIT_MS,
  STALLED_REFUND_LIMIT,
  UNDISPATCHED_REFUND_LIMIT,
} from './pending-checkout-sweep-job.ts';

const CRON = '21 12 * * *';

const ONE_HOUR_BEFORE = new Date(SWEEP_TIME.getTime() - HOUR_MS);

const TEN_MINUTES_BEFORE = new Date(SWEEP_TIME.getTime() - 10 * MINUTE_MS);

const ONE_DAY_BEFORE = new Date(SWEEP_TIME.getTime() - 24 * HOUR_MS);

const logs = createJobLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

const expiredSnapshot = (sessionId: string): StripeCheckoutSessionSnapshot =>
  sessionSnapshotOf({ id: sessionId, status: 'expired', clientSecret: null });

function staleOf(
  serial: number,
  overrides: Partial<PurchaseRecord> = {},
): PurchaseRecord {
  return jobPurchaseOf(serial, {
    deadlineAt: null,
    acceptUntil: null,
    fulfillableUntil: null,
    expiresAt: new Date(ONE_HOUR_BEFORE.getTime() - MINUTE_MS),
    ...overrides,
  });
}

function confirmationPendingOf(
  serial: number,
  overrides: Partial<PurchaseRecord> = {},
): PurchaseRecord {
  return jobPurchaseOf(serial, {
    status: 'fulfilled',
    confirmationEmailStatus: 'pending',
    reflectedAt: new Date(TEN_MINUTES_BEFORE.getTime() - MINUTE_MS),
    ...overrides,
  });
}

function noticePendingOf(
  serial: number,
  overrides: Partial<RefundRequestRecord> = {},
): RefundRequestRecord {
  return jobRefundOf(serial, {
    status: 'succeeded',
    noticeStatus: 'pending',
    dispatchedAt: new Date(TEN_MINUTES_BEFORE.getTime() - HOUR_MS),
    updatedAt: new Date(TEN_MINUTES_BEFORE.getTime() - MINUTE_MS),
    ...overrides,
  });
}

interface SweepSetup {
  readonly purchases?: readonly PurchaseRecord[];
  readonly refunds?: readonly RefundRequestRecord[];
  readonly sessions?: ReadonlyMap<string, SessionBehavior>;
  readonly dispatchFailures?: ReadonlyMap<string, Error>;
  readonly notices?: ReadonlyMap<string, NoticeBehavior>;
  readonly timeOf?: (callCount: number) => Date;
}

function setup(options: SweepSetup = {}) {
  const purchases = new InMemoryJobPurchases(options.purchases);
  const refunds = new InMemoryJobRefunds(options.refunds);
  const gatewayCalls: string[] = [];
  const reflections: JobReflection[] = [];
  const dispatched: string[] = [];
  const redispatched: string[] = [];
  const noticeCalls: NoticeCalls = { purchases: [], refunds: [] };
  const recorder = createIncidentRecorder();
  const clock =
    options.timeOf === undefined
      ? RUN_CLOCK
      : clockByCalls(gatewayCalls, options.timeOf);
  const job = new PendingCheckoutSweepJob(
    purchases.store(),
    refunds.store(),
    createJobSessionGateway(
      gatewayCalls,
      options.sessions ?? new Map(),
      expiredSnapshot,
    ),
    createJobReflector(purchases, reflections),
    createJobPaymentRefunds(
      refunds,
      dispatched,
      options.dispatchFailures,
      redispatched,
    ),
    createJobNotifier(purchases, refunds, noticeCalls, options.notices),
    clock,
    createJobIds(),
    recorder.reporter,
  );
  return {
    job,
    purchases,
    refunds,
    gatewayCalls,
    reflections,
    dispatched,
    redispatched,
    noticeCalls,
    incidents: recorder.incidents,
  };
}

const run = (job: PendingCheckoutSweepJob) =>
  job.run(jobContextAt(SWEEP_TIME, CRON));

const EMPTY_SUMMARY = {
  reconciliation: {
    targets: 0,
    applied: 0,
    unchanged: 0,
    failed: 0,
    stopped: 0,
  },
  refunds: { targets: 0, failed: 0 },
  stalledRefunds: { targets: 0, redispatched: 0, failed: 0 },
  notices: { targets: 0, requested: 0, failed: 0 },
};

describe('PENDING_CHECKOUT_SWEEP_JOB_DEFINITION', () => {
  test('業務時刻4:21・order 400で日次の確認のジョブを登録する定義である', () => {
    expect(PENDING_CHECKOUT_SWEEP_JOB_DEFINITION).toEqual({
      name: 'payments.pending-checkout-sweep',
      at: { hour: 4, minute: 21 },
      order: 400,
      handler: API_PAYMENTS_TYPES.PendingCheckoutSweepJob,
    });
  });

  test('ジョブの定義の検証を通り、4:21の起動の式21 12 * * *で動く', () => {
    const registry = createCronRegistry([
      PENDING_CHECKOUT_SWEEP_JOB_DEFINITION,
    ]);

    expect(registry.cronExpressions()).toEqual([CRON]);
  });
});

describe('PendingCheckoutSweepJob', () => {
  test('有効期限を1時間過ぎた購入を最大200件、作成から10分経った未送信の返金を最大100件、送信から24時間経った依頼中の返金を最大100件、反映・返金の成功から10分経った依頼待ちのメールを最大100件ずつ探す', async () => {
    const { job, purchases, refunds } = setup();

    await run(job);

    expect([
      STALE_CHECKOUT_LIMIT,
      UNDISPATCHED_REFUND_LIMIT,
      STALLED_REFUND_LIMIT,
      PENDING_NOTICE_LIMIT,
    ]).toEqual([200, 100, 100, 100]);
    expect(refunds.queries.stalled).toEqual([
      { dispatchedBefore: ONE_DAY_BEFORE, limit: 100 },
    ]);
    expect(purchases.queries.staleOpen).toEqual([
      { expiredBefore: ONE_HOUR_BEFORE, limit: 200 },
    ]);
    expect(refunds.queries.undispatched).toEqual([
      { createdBefore: TEN_MINUTES_BEFORE, limit: 100 },
    ]);
    expect(purchases.queries.pendingConfirmations).toEqual([
      { reflectedBefore: TEN_MINUTES_BEFORE, limit: 100 },
    ]);
    expect(refunds.queries.pendingNotices).toEqual([
      { updatedBefore: TEN_MINUTES_BEFORE, limit: 100 },
    ]);
    expect(logs.of('pending-checkout-sweep')).toEqual([
      { level: 'info', properties: EMPTY_SUMMARY },
    ]);
  });

  test('有効期限を1時間以上過ぎた未完了の購入をStripeの状態と突合し、支払い済みは確定・それ以外は失効にする', async () => {
    const paid = staleOf(1);
    const expired = staleOf(2, { status: 'superseded' });
    const notYet = staleOf(3, { expiresAt: ONE_HOUR_BEFORE });
    const { job, purchases, gatewayCalls, reflections } = setup({
      purchases: [paid, expired, notYet],
      sessions: new Map<string, SessionBehavior>([
        [
          sessionIdOf(1),
          {
            kind: 'snapshot',
            snapshot: sessionSnapshotOf({
              id: sessionIdOf(1),
              status: 'complete',
              paymentStatus: 'paid',
              clientSecret: null,
            }),
          },
        ],
      ]),
    });

    await run(job);

    expect(gatewayCalls).toEqual([
      `retrieve:${sessionIdOf(1)}`,
      `retrieve:${sessionIdOf(2)}`,
    ]);
    expect(reflections.map(({ occurredAt }) => occurredAt)).toEqual([
      RUN_CLOCK_TIME,
      RUN_CLOCK_TIME,
    ]);
    expect(purchases.statuses()).toEqual({
      [paid.id]: 'fulfilled',
      [expired.id]: 'expired',
      [notYet.id]: 'open',
    });
  });

  test('突合に失敗した購入を通知し、残りの購入と返金・メールの確認を続ける', async () => {
    const failure = new StripeUnavailableError('Stripeに接続できません');
    const unreachable = staleOf(1);
    const reachable = staleOf(2);
    const refund = jobRefundOf(1, {
      createdAt: new Date(TEN_MINUTES_BEFORE.getTime() - 1),
    });
    const { job, purchases, dispatched, incidents } = setup({
      purchases: [unreachable, reachable],
      refunds: [refund],
      sessions: new Map<string, SessionBehavior>([
        [sessionIdOf(1), { kind: 'error', error: failure }],
      ]),
    });

    await run(job);

    expect(purchases.statuses()).toEqual({
      [unreachable.id]: 'open',
      [reachable.id]: 'expired',
    });
    expect(dispatched).toEqual([refund.id]);
    expect(incidents).toEqual([
      {
        kind: 'reconciliation-failed',
        job: 'payments.pending-checkout-sweep',
        purchaseId: unreachable.id,
        error: failure,
      },
    ]);
  });

  test('作成から10分以上経っても送信していない返金の依頼だけを送り直し、送信に失敗した依頼を通知して残りを続ける', async () => {
    const dispatchError = new Error('D1に書き込めません');
    const overdue = jobRefundOf(1);
    const failing = jobRefundOf(2);
    const recent = jobRefundOf(3, { createdAt: TEN_MINUTES_BEFORE });
    const sent = jobRefundOf(4, {
      dispatchedAt: new Date(SWEEP_TIME.getTime() - HOUR_MS),
    });
    const { job, refunds, dispatched, incidents } = setup({
      refunds: [overdue, failing, recent, sent],
      dispatchFailures: new Map([[failing.id, dispatchError]]),
    });

    await run(job);

    expect(dispatched).toEqual([overdue.id, failing.id]);
    expect(refunds.get(overdue.id)?.dispatchedAt).toEqual(RUN_CLOCK_TIME);
    expect(refunds.get(recent.id)?.dispatchedAt).toBeNull();
    expect(incidents).toEqual([
      {
        kind: 'refund-dispatch-failed',
        job: 'payments.pending-checkout-sweep',
        refundRequestId: failing.id,
        error: dispatchError,
      },
    ]);
    expect(logs.of('pending-checkout-sweep').at(-1)?.properties).toEqual({
      ...EMPTY_SUMMARY,
      refunds: { targets: 2, failed: 1 },
    });
  });

  test('送信から24時間以上経っても依頼中のままの返金の依頼を送り直し、送り直した依頼のIDをまとめて知らせ、送り直せなかった依頼を通知する', async () => {
    const redispatchError = new Error('Queueに送れません');
    const stalled = jobRefundOf(1, {
      dispatchedAt: new Date(ONE_DAY_BEFORE.getTime() - 1),
    });
    const failing = jobRefundOf(2, {
      dispatchedAt: new Date(ONE_DAY_BEFORE.getTime() - HOUR_MS),
    });
    const recent = jobRefundOf(3, { dispatchedAt: ONE_DAY_BEFORE });
    const submitted = jobRefundOf(4, {
      status: 'submitted',
      dispatchedAt: new Date(ONE_DAY_BEFORE.getTime() - HOUR_MS),
    });
    const { job, refunds, dispatched, redispatched, incidents } = setup({
      refunds: [stalled, failing, recent, submitted],
      dispatchFailures: new Map([[failing.id, redispatchError]]),
    });

    await run(job);

    expect(redispatched).toEqual([failing.id, stalled.id]);
    expect(dispatched).toEqual([]);
    expect(refunds.get(stalled.id)?.dispatchedAt).toEqual(RUN_CLOCK_TIME);
    expect(refunds.get(recent.id)?.dispatchedAt).toEqual(ONE_DAY_BEFORE);
    expect(incidents).toEqual([
      {
        kind: 'refund-dispatch-failed',
        job: 'payments.pending-checkout-sweep',
        refundRequestId: failing.id,
        error: redispatchError,
      },
      {
        kind: 'refund-redispatched',
        job: 'payments.pending-checkout-sweep',
        refundRequestIds: [stalled.id],
      },
    ]);
    expect(logs.of('pending-checkout-sweep').at(-1)?.properties).toEqual({
      ...EMPTY_SUMMARY,
      stalledRefunds: { targets: 2, redispatched: 1, failed: 1 },
    });
  });

  test('送り直した返金の依頼が無ければ、送り直しの知らせを送らない', async () => {
    const { job, incidents } = setup({
      refunds: [jobRefundOf(1, { dispatchedAt: ONE_DAY_BEFORE })],
    });

    await run(job);

    expect(incidents).toEqual([]);
  });

  test('突合はジョブの開始から30秒ちょうどまで続け、過ぎたら残りの購入を止めて残った件数を知らせ、返金とメールの確認を続ける', async () => {
    const stale = [1, 2, 3, 4].map((serial) =>
      staleOf(serial, {
        expiresAt: new Date(
          ONE_HOUR_BEFORE.getTime() - (5 - serial) * MINUTE_MS,
        ),
      }),
    );
    const refund = jobRefundOf(1);
    const notice = noticePendingOf(2);
    const { job, purchases, gatewayCalls, dispatched, noticeCalls, incidents } =
      setup({
        purchases: stale,
        refunds: [refund, notice],
        // 開始と1件目の前は開始の時刻、2件目の前は15秒後、3件目の前は上限ちょうど、4件目の前は上限の1ms後
        timeOf: (callCount) =>
          new Date(
            RUN_CLOCK_TIME.getTime() +
              Math.min(callCount, 2) * (STALE_CHECKOUT_TIME_LIMIT_MS / 2) +
              (callCount >= 3 ? 1 : 0),
          ),
      });

    await run(job);

    expect(STALE_CHECKOUT_TIME_LIMIT_MS).toBe(30_000);
    expect(gatewayCalls).toEqual(
      [1, 2, 3].map((serial) => `retrieve:${sessionIdOf(serial)}`),
    );
    expect(purchases.get(stale[3]?.id ?? '')?.status).toBe('open');
    expect(incidents).toEqual([
      {
        kind: 'reconciliation-time-limit-reached',
        job: 'payments.pending-checkout-sweep',
        remaining: 1,
      },
    ]);
    expect(dispatched).toEqual([refund.id]);
    expect(noticeCalls.refunds).toEqual([notice.id]);
    expect(
      logs.of('pending-checkout-sweep').at(-1)?.properties.reconciliation,
    ).toEqual({ targets: 4, applied: 3, unchanged: 0, failed: 0, stopped: 1 });
  });

  test('依頼待ちのまま10分以上経った購入確認メールと自動返金の通知を依頼し、依頼済みのメールを依頼しない', async () => {
    const confirmation = confirmationPendingOf(1);
    const requested = confirmationPendingOf(2, {
      confirmationEmailStatus: 'requested',
    });
    const recentConfirmation = confirmationPendingOf(3, {
      reflectedAt: TEN_MINUTES_BEFORE,
    });
    const notice = noticePendingOf(1);
    const requestedNotice = noticePendingOf(2, { noticeStatus: 'requested' });
    const { job, purchases, refunds, noticeCalls, incidents } = setup({
      purchases: [confirmation, requested, recentConfirmation],
      refunds: [notice, requestedNotice],
    });

    await run(job);

    expect(noticeCalls).toEqual({
      purchases: [confirmation.id],
      refunds: [notice.id],
    });
    expect(purchases.get(confirmation.id)?.confirmationEmailStatus).toBe(
      'requested',
    );
    expect(purchases.get(recentConfirmation.id)?.confirmationEmailStatus).toBe(
      'pending',
    );
    expect(refunds.get(notice.id)?.noticeStatus).toBe('requested');
    expect(incidents).toEqual([]);
    expect(logs.of('pending-checkout-sweep').at(-1)?.properties).toEqual({
      ...EMPTY_SUMMARY,
      notices: { targets: 2, requested: 2, failed: 0 },
    });
  });

  test('依頼できず依頼待ちのまま残ったメールを、購入IDと返金の依頼のIDをまとめて1回で通知し、残りの依頼を続ける', async () => {
    const sendFailed = confirmationPendingOf(1);
    const throwing = confirmationPendingOf(2);
    const fine = confirmationPendingOf(3);
    const failedNotice = noticePendingOf(1);
    const { job, purchases, incidents } = setup({
      purchases: [sendFailed, throwing, fine],
      refunds: [failedNotice],
      notices: new Map<string, NoticeBehavior>([
        [sendFailed.id, 'failed'],
        [throwing.id, new Error('D1に接続できません')],
        [failedNotice.id, 'failed'],
      ]),
    });

    await run(job);

    expect(purchases.get(fine.id)?.confirmationEmailStatus).toBe('requested');
    expect(incidents).toEqual([
      {
        kind: 'notice-request-failed',
        job: 'payments.pending-checkout-sweep',
        purchaseIds: [sendFailed.id, throwing.id],
        refundRequestIds: [failedNotice.id],
      },
    ]);
    expect(logs.of('pending-checkout-sweep').at(-1)?.properties).toEqual({
      ...EMPTY_SUMMARY,
      notices: { targets: 4, requested: 1, failed: 3 },
    });
  });

  test('入力を組み立てられず対象外になったメールは、依頼できなかったメールとして知らせず、翌日の依頼し直しの対象にならない', async () => {
    const unbuildable = confirmationPendingOf(1);
    const unbuildableNotice = noticePendingOf(1);
    const { job, purchases, refunds, noticeCalls, incidents } = setup({
      purchases: [unbuildable],
      refunds: [unbuildableNotice],
      notices: new Map<string, NoticeBehavior>([
        [unbuildable.id, 'skipped'],
        [unbuildableNotice.id, 'skipped'],
      ]),
    });

    await run(job);
    await run(job);

    expect(purchases.get(unbuildable.id)?.confirmationEmailStatus).toBe(
      'skipped',
    );
    expect(refunds.get(unbuildableNotice.id)?.noticeStatus).toBe('skipped');
    expect(noticeCalls).toEqual({
      purchases: [unbuildable.id],
      refunds: [unbuildableNotice.id],
    });
    expect(incidents).toEqual([]);
    expect(logs.of('pending-checkout-sweep').at(-1)?.properties).toEqual(
      EMPTY_SUMMARY,
    );
  });

  test('上限の件数だけを処理し、残りを翌日の起動に任せる', async () => {
    const stale = Array.from({ length: 201 }, (_, index) =>
      staleOf(index + 1, {
        expiresAt: new Date(
          ONE_HOUR_BEFORE.getTime() - (index + 1) * MINUTE_MS,
        ),
      }),
    );
    const undispatched = Array.from({ length: 101 }, (_, index) =>
      jobRefundOf(index + 1),
    );
    const { job, gatewayCalls, dispatched } = setup({
      purchases: stale,
      refunds: undispatched,
    });

    await run(job);

    expect(gatewayCalls).toHaveLength(200);
    expect(gatewayCalls).not.toContain(`retrieve:${sessionIdOf(1)}`);
    expect(dispatched).toHaveLength(100);
  });

  test('2回実行しても購入・返金・メールの状態は1回目の結果と変わらず、2回目は送り直しと依頼をしない', async () => {
    const stale = staleOf(1);
    const refund = jobRefundOf(1);
    const confirmation = confirmationPendingOf(2);
    const notice = noticePendingOf(2);
    const { job, purchases, refunds, gatewayCalls, dispatched, noticeCalls } =
      setup({
        purchases: [stale, confirmation],
        refunds: [refund, notice],
      });

    await run(job);
    const afterFirst = {
      purchases: [stale.id, confirmation.id].map((id) => purchases.get(id)),
      refunds: [refund.id, notice.id].map((id) => refunds.get(id)),
    };
    await run(job);

    expect({
      purchases: [stale.id, confirmation.id].map((id) => purchases.get(id)),
      refunds: [refund.id, notice.id].map((id) => refunds.get(id)),
    }).toEqual(afterFirst);
    expect(afterFirst.purchases.map((purchase) => purchase?.status)).toEqual([
      'expired',
      'fulfilled',
    ]);
    expect(gatewayCalls).toHaveLength(1);
    expect(dispatched).toEqual([refund.id]);
    expect(noticeCalls).toEqual({
      purchases: [confirmation.id],
      refunds: [notice.id],
    });
  });

  test('対象の検索に失敗したら例外をそのまま定期実行の記録へ投げる', async () => {
    const failure = new Error('D1に接続できません');
    const purchases = new InMemoryJobPurchases();
    const refunds = new InMemoryJobRefunds();
    const recorder = createIncidentRecorder();
    const job = new PendingCheckoutSweepJob(
      { ...purchases.store(), findStaleOpen: () => Promise.reject(failure) },
      refunds.store(),
      createJobSessionGateway([], new Map(), expiredSnapshot),
      createJobReflector(purchases, []),
      createJobPaymentRefunds(refunds, []),
      createJobNotifier(purchases, refunds, { purchases: [], refunds: [] }),
      RUN_CLOCK,
      createJobIds(),
      recorder.reporter,
    );

    expect(await run(job).catch((error: unknown) => error)).toBe(failure);
  });

  test('DIコンテナから共通の契約の識別子で依存を受け取って解決できる', async () => {
    const purchases = new InMemoryJobPurchases([staleOf(1)]);
    const refunds = new InMemoryJobRefunds([jobRefundOf(1)]);
    const dispatched: string[] = [];
    const container = new Container();
    container
      .bind(PAYMENTS_TYPES.PurchaseStore)
      .toConstantValue(purchases.store());
    container.bind(PAYMENTS_TYPES.RefundStore).toConstantValue(refunds.store());
    container
      .bind(PAYMENTS_TYPES.StripeGateway)
      .toConstantValue(createJobSessionGateway([], new Map(), expiredSnapshot));
    container
      .bind(PAYMENTS_TYPES.PaymentReflector)
      .toConstantValue(createJobReflector(purchases, []));
    container
      .bind(PAYMENTS_TYPES.PaymentRefunds)
      .toConstantValue(createJobPaymentRefunds(refunds, dispatched));
    container
      .bind(PAYMENTS_TYPES.PurchaseNotifier)
      .toConstantValue(
        createJobNotifier(purchases, refunds, { purchases: [], refunds: [] }),
      );
    container.bind(PLATFORM_TYPES.Clock).toConstantValue(RUN_CLOCK);
    container.bind(PLATFORM_TYPES.IdGenerator).toConstantValue(createJobIds());
    container
      .bind<PaymentsJobIncidentReporter>(
        API_PAYMENTS_TYPES.PaymentsJobIncidentReporter,
      )
      .toConstantValue(createIncidentRecorder().reporter);
    container
      .bind(API_PAYMENTS_TYPES.PendingCheckoutSweepJob)
      .to(PendingCheckoutSweepJob);

    await container
      .get<PendingCheckoutSweepJob>(API_PAYMENTS_TYPES.PendingCheckoutSweepJob)
      .run(jobContextAt(SWEEP_TIME, CRON));

    expect(purchases.statuses()).toEqual({ [staleOf(1).id]: 'expired' });
    expect(dispatched).toEqual([jobRefundOf(1).id]);
  });
});
