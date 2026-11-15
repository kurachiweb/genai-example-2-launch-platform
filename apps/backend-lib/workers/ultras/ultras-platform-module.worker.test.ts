import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { type Container, ContainerModule } from 'inversify';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';

import { ultrasActivations } from '../../../db/schema/ultras/ultras-activations.ts';
import { ultrasNotices } from '../../../db/schema/ultras/ultras-notices.ts';
import { ultrasSubscriptions } from '../../../db/schema/ultras/ultras-subscriptions.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import { ULTRAS_PAYMENT_FAILED_KIND } from '../../core/email/kinds/ultras.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type {
  PaymentReflector,
  ReflectionOutcome,
  StripeCheckoutSessionSnapshot,
  StripeGateway,
  StripeSubscriptionSnapshot,
} from '../../core/payments/ports.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../core/payments/refund-message.ts';
import type { Clock } from '../../core/time/clock.ts';
import { ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE } from '../../core/ultras/activation-message.ts';
import { ULTRAS_TYPES } from '../../core/ultras/identifiers.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import { EMAIL_PLATFORM_MODULE } from '../email/email-platform-module.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { IDENTITY_PLATFORM_MODULE } from '../identity/identity-platform-module.ts';
import { emailOf } from '../identity/testing/identity-store-fixtures.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { createPaymentsPlatformModule } from '../payments/payments-platform-module.ts';
import {
  createRecordingSender,
  insertPurchase,
  minutesAfterT0,
  NOW,
  OCCURRED_AT,
  readRefundRows,
  type RecordingSender,
  sessionIdOf,
  snapshotOf,
} from '../payments/testing/checkout-reflection-harness.ts';
import { createFakeStripeGateway } from '../payments/testing/fake-stripe-gateway.ts';
import {
  invoiceIdOf,
  ownerMetadataOf,
  subscriptionOf,
} from '../payments/testing/payment-reflector-harness.ts';
import {
  clearPaymentTables,
  readPurchaseRow,
} from '../payments/testing/payment-store-fixtures.ts';
import { QueueActivationDispatcher } from './activation-dispatcher.ts';
import { D1ActivationStore } from './d1-activation-store.ts';
import { D1NoticeStore } from './d1-notice-store.ts';
import { D1PromotionFlagReader } from './d1-promotion-flag-reader.ts';
import { D1SubscriptionStore } from './d1-subscription-store.ts';
import { PlanStateSink } from './plan-state-sink.ts';
import {
  db,
  insertUser,
  purchaseIdOf,
  readActivationIds,
  readActivationRow,
  readNoticeIds,
  readNoticeRow,
  readSubscriptionRow,
  stripeSubscriptionIdOf,
  userIdOf,
} from './testing/ultras-store-fixtures.ts';
import { StoredUltrasEntitlements } from './ultras-entitlements.ts';
import { UltrasFulfillment } from './ultras-fulfillment.ts';
import { EmailUltrasNotifier } from './ultras-notifier.ts';
import { UltrasOfferPolicy } from './ultras-offer-policy.ts';
import { StoredUltrasPlanExport } from './ultras-plan-export.ts';
import { createUltrasPlatformModule } from './ultras-platform-module.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

interface Harness {
  readonly container: Container;
  readonly reflector: PaymentReflector;
  readonly queue: RecordingQueue;
  readonly emails: RecordingSender;
}

interface HarnessOptions {
  readonly appName?: LoggingOptions['appName'];
  readonly gateway?: StripeGateway;
}

const ULTRAS_PLATFORM_MODULE = createUltrasPlatformModule('api');

const MINUTES_PER_DAY = 24 * 60;

// 課金期間の終了(12月1日0:00Z)の最後の瞬間が属するUTC-08:00の日付(11月30日)の終わり
const PERIOD_END = minutesAfterT0(30 * MINUTES_PER_DAY);
const BENEFIT_ENDS_AT = new Date('2026-12-01T08:00:00.000Z');

const FIXED_CLOCK: Clock = { now: () => NOW };

const PLAN_URL = new URL('/settings/plan', env.CLIENT_SITE_ORIGIN).href;

function createRecordingQueue(): RecordingQueue {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

// Stripeへ通信せず、メールの依頼を記録し、支払いの確定の時刻を固定するため、共通の束縛のうち3つだけを差し替える
function overridesOf(
  gateway: StripeGateway,
  emails: RecordingSender,
): Pick<AppModule, 'bindings'> {
  return {
    bindings: new ContainerModule(({ rebind }) => {
      rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toConstantValue(
        gateway,
      );
      rebind<EmailSender>(EMAIL_TYPES.EmailSender).toConstantValue(
        emails.sender,
      );
      rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(FIXED_CLOCK);
    }),
  };
}

function createHarness(options: HarnessOptions = {}): Harness {
  const appName = options.appName ?? 'api';
  const queue = createRecordingQueue();
  const emails = createRecordingSender();
  const container = createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: queue.queue },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: `correlation-ultras-platform-${appName}`,
        clientIp: undefined,
      },
    },
    [
      EMAIL_PLATFORM_MODULE,
      IDENTITY_PLATFORM_MODULE,
      createPaymentsPlatformModule(appName),
      createUltrasPlatformModule(appName),
      overridesOf(options.gateway ?? createFakeStripeGateway(), emails),
    ],
  );
  return {
    container,
    reflector: container.get<PaymentReflector>(PAYMENTS_TYPES.PaymentReflector),
    queue,
    emails,
  };
}

function ultrasSessionOf(index: number): StripeCheckoutSessionSnapshot {
  return snapshotOf(index, {
    invoiceId: invoiceIdOf(index),
    subscriptionId: stripeSubscriptionIdOf(index),
    metadata: ownerMetadataOf(index, 'ultras'),
  });
}

function ultrasSubscriptionOf(
  index: number,
  overrides: Partial<StripeSubscriptionSnapshot> = {},
): StripeSubscriptionSnapshot {
  return subscriptionOf(index, {
    id: stripeSubscriptionIdOf(index),
    metadata: ownerMetadataOf(index, 'ultras'),
    ...overrides,
  });
}

function gatewayReturning(
  subscription: StripeSubscriptionSnapshot,
): StripeGateway {
  return createFakeStripeGateway({
    retrieveSubscription: () => Promise.resolve(subscription),
  });
}

function activate(harness: Harness, index: number): Promise<ReflectionOutcome> {
  return harness.reflector.reflectCheckoutSnapshot(
    ultrasSessionOf(index),
    OCCURRED_AT,
  );
}

function reflectSubscription(
  harness: Harness,
  index: number,
  minutes: number,
): Promise<ReflectionOutcome> {
  return harness.reflector.reflect({
    kind: 'subscription',
    subscriptionId: stripeSubscriptionIdOf(index),
    occurredAt: minutesAfterT0(minutes),
  });
}

function activationMessagesOf(
  ...queues: readonly RecordingQueue[]
): QueueEnvelope[] {
  return queues.flatMap(({ sent }) =>
    sent.filter(
      ({ type }) => type === ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type,
    ),
  );
}

function paymentFailedEmailsOf(emails: RecordingSender) {
  return emails.sent.filter(
    ({ kind }) => kind.name === ULTRAS_PAYMENT_FAILED_KIND.name,
  );
}

function currentPlanOf(harness: Harness) {
  return harness.container
    .get<UltrasEntitlements>(ULTRAS_TYPES.UltrasEntitlements)
    .currentPlan(userIdOf(1), NOW);
}

function soleIdOf(ids: readonly string[], label: string): string {
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    throw new Error(`${label}の行が1つではありません: ${String(ids.length)}件`);
  }
  return id;
}

// paymentsの表とultrasの表の両方が利用者を参照するため、ultrasの行を先に消してからpaymentsの行と利用者を消す
beforeEach(async () => {
  await db.batch([
    db.delete(ultrasNotices),
    db.delete(ultrasActivations),
    db.delete(ultrasSubscriptions),
  ]);
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('createUltrasPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられ、経路を持たない', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      ULTRAS_PLATFORM_MODULE,
      createUltrasPlatformModule('event'),
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(ULTRAS_PLATFORM_MODULE.name).toBe('ultras-platform');
    expect('routes' in ULTRAS_PLATFORM_MODULE).toBe(false);
  });

  test.each([
    ['SubscriptionStore', 'SubscriptionStatements', D1SubscriptionStore],
    ['ActivationStore', 'ActivationStatements', D1ActivationStore],
    ['NoticeStore', 'NoticeStatements', D1NoticeStore],
  ] as const)(
    '文を返さない操作の%sと文を返す操作の%sは同じD1の実装のインスタンスに解決される',
    (operations, statements, implementation) => {
      const { container } = createHarness();

      const resolved = container.get(ULTRAS_TYPES[operations]);

      expect(resolved).toBeInstanceOf(implementation);
      expect(container.get(ULTRAS_TYPES[statements])).toBe(resolved);
    },
  );

  test('処理単位のコンテナから機能フラグ・特典の判定・エクスポート・送り出し・メールの依頼と、paymentsの3つの口の実装を解決する', () => {
    const { container } = createHarness();

    expect(
      container.get(ULTRAS_TYPES.UltrasPromotionFlagReader),
    ).toBeInstanceOf(D1PromotionFlagReader);
    expect(container.get(ULTRAS_TYPES.UltrasEntitlements)).toBeInstanceOf(
      StoredUltrasEntitlements,
    );
    expect(container.get(ULTRAS_TYPES.UltrasPlanExport)).toBeInstanceOf(
      StoredUltrasPlanExport,
    );
    expect(container.get(ULTRAS_TYPES.ActivationDispatcher)).toBeInstanceOf(
      QueueActivationDispatcher,
    );
    expect(container.get(ULTRAS_TYPES.UltrasNotifier)).toBeInstanceOf(
      EmailUltrasNotifier,
    );
    expect(container.get(ULTRAS_TYPES.UltrasOfferPolicy)).toBeInstanceOf(
      UltrasOfferPolicy,
    );
    expect(container.get(ULTRAS_TYPES.UltrasFulfillment)).toBeInstanceOf(
      UltrasFulfillment,
    );
    expect(container.get(ULTRAS_TYPES.PlanStateSink)).toBeInstanceOf(
      PlanStateSink,
    );
  });

  test('1つの処理単位では同じインスタンスを使い回し、処理単位をまたいで共有しない', () => {
    const first = createHarness().container;
    const second = createHarness().container;

    expect(first.get(ULTRAS_TYPES.UltrasFulfillment)).toBe(
      first.get(ULTRAS_TYPES.UltrasFulfillment),
    );
    expect(first.get(ULTRAS_TYPES.SubscriptionStore)).toBe(
      first.get(ULTRAS_TYPES.SubscriptionStore),
    );
    expect(first.get(ULTRAS_TYPES.UltrasFulfillment)).not.toBe(
      second.get(ULTRAS_TYPES.UltrasFulfillment),
    );
  });
});

describe('paymentsの反映を通した加入の有効化', () => {
  test('ultrasの決済セッションの完了で加入が有効になり、知らせの行が1つでき、確定後に送り出しが1回依頼される', async () => {
    const harness = createHarness();
    await insertPurchase(1, { kind: 'ultras' });

    const outcome = await activate(harness, 1);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readSubscriptionRow(stripeSubscriptionIdOf(1))).toMatchObject({
      userId: userIdOf(1),
      purchaseId: purchaseIdOf(1),
      stripeStatus: 'active',
      startedAt: NOW,
      benefitEndsAt: null,
    });
    const activationId = soleIdOf(await readActivationIds(), '知らせ');
    expect(await readActivationRow(activationId)).toMatchObject({
      userId: userIdOf(1),
      stripeSubscriptionId: stripeSubscriptionIdOf(1),
      activatedAt: NOW,
      dispatchedAt: NOW,
      completedAt: null,
    });
    expect(activationMessagesOf(harness.queue)).toEqual([
      expect.objectContaining({
        type: ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type,
        body: { activationId },
      }),
    ]);
    await expect(currentPlanOf(harness)).resolves.toEqual({
      status: 'active',
      startedAt: NOW,
      currentPeriodEndsAt: null,
      benefitEndsAt: null,
      canceledAt: null,
    });
  });

  test('return_urlとWebhookから同時に反映しても、加入の有効化・知らせの行・送り出しは1回だけになる', async () => {
    await insertPurchase(1, { kind: 'ultras' });
    const session = ultrasSessionOf(1);
    const returnUrl = createHarness({ appName: 'api' });
    const webhook = createHarness({
      appName: 'event',
      gateway: createFakeStripeGateway({
        retrieveCheckoutSession: () => Promise.resolve(session),
      }),
    });

    const outcomes = await Promise.all([
      returnUrl.reflector.reflectCheckoutSnapshot(session, NOW),
      webhook.reflector.reflect({
        kind: 'checkout_session',
        sessionId: sessionIdOf(1),
        occurredAt: OCCURRED_AT,
      }),
    ]);

    expect(outcomes).toContainEqual({
      kind: 'applied',
      purchaseStatus: 'fulfilled',
    });
    expect(outcomes).toContainEqual({
      kind: 'already_applied',
      purchaseStatus: 'fulfilled',
    });
    expect(await readSubscriptionRow(stripeSubscriptionIdOf(1))).toMatchObject({
      startedAt: NOW,
    });
    expect(await readActivationIds()).toHaveLength(1);
    expect(activationMessagesOf(returnUrl.queue, webhook.queue)).toHaveLength(
      1,
    );
  });

  test('特典の継続期間内の利用者の2つ目の加入は権利を付与できない購入として拒否され、paymentsの返金の依頼ができる', async () => {
    const harness = createHarness();
    await insertPurchase(1, { kind: 'ultras' });
    await insertPurchase(2, { kind: 'ultras' });
    await activate(harness, 1);

    const outcome = await activate(harness, 2);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'rejected' });
    expect(await readPurchaseRow(purchaseIdOf(2))).toMatchObject({
      status: 'rejected',
      rejectionReason: 'ineligible',
    });
    expect(
      await readSubscriptionRow(stripeSubscriptionIdOf(2)),
    ).toBeUndefined();
    expect(await readActivationIds()).toHaveLength(1);
    const refunds = await readRefundRows();
    expect(refunds).toEqual([
      expect.objectContaining({
        purchaseId: purchaseIdOf(2),
        reason: 'ineligible',
      }),
    ]);
    expect(
      harness.queue.sent.filter(
        ({ type }) => type === PAYMENTS_REFUND_MESSAGE.type,
      ),
    ).toEqual([
      expect.objectContaining({ body: { refundRequestId: refunds[0]?.id } }),
    ]);
  });

  test('同じ利用者の2つの加入の支払いの確定が同時に反映されても、1つだけが有効になりもう一方は拒否される', async () => {
    await insertPurchase(1, { kind: 'ultras' });
    await insertPurchase(2, { kind: 'ultras' });
    const first = createHarness();
    const second = createHarness();

    const outcomes = await Promise.all([
      activate(first, 1),
      activate(second, 2),
    ]);

    expect(outcomes).toContainEqual({
      kind: 'applied',
      purchaseStatus: 'fulfilled',
    });
    expect(outcomes).toContainEqual({
      kind: 'applied',
      purchaseStatus: 'rejected',
    });
    const rows = [
      await readSubscriptionRow(stripeSubscriptionIdOf(1)),
      await readSubscriptionRow(stripeSubscriptionIdOf(2)),
    ].filter((row) => row !== undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startedAt: NOW, benefitEndsAt: null });
    expect(await readActivationIds()).toHaveLength(1);
    expect(activationMessagesOf(first.queue, second.queue)).toHaveLength(1);
    expect(await readRefundRows()).toHaveLength(1);
  });
});

describe('paymentsの反映を通した定期課金の状態の変化', () => {
  test('定期課金の更新の通知が有効化の前に届いても、Stripe側の値が保存され有効化の後の加入状態に反映される', async () => {
    const harness = createHarness({
      gateway: gatewayReturning(
        ultrasSubscriptionOf(1, {
          cancelAtPeriodEnd: true,
          currentPeriodEnd: PERIOD_END,
        }),
      ),
    });
    await insertPurchase(1, { kind: 'ultras' });

    expect(await reflectSubscription(harness, 1, 25)).toEqual({
      kind: 'applied',
    });

    expect(await readSubscriptionRow(stripeSubscriptionIdOf(1))).toMatchObject({
      userId: userIdOf(1),
      purchaseId: purchaseIdOf(1),
      stripeStatus: 'active',
      cancelScheduled: true,
      currentPeriodEnd: PERIOD_END,
      benefitEndsAt: BENEFIT_ENDS_AT,
      startedAt: null,
      canceledAt: null,
    });
    await expect(currentPlanOf(harness)).resolves.toBeNull();

    expect(await activate(harness, 1)).toEqual({
      kind: 'applied',
      purchaseStatus: 'fulfilled',
    });

    expect(await readSubscriptionRow(stripeSubscriptionIdOf(1))).toMatchObject({
      startedAt: NOW,
      cancelScheduled: true,
      currentPeriodEnd: PERIOD_END,
      benefitEndsAt: BENEFIT_ENDS_AT,
      canceledAt: null,
    });
    await expect(currentPlanOf(harness)).resolves.toEqual({
      status: 'canceled',
      startedAt: NOW,
      currentPeriodEndsAt: PERIOD_END,
      benefitEndsAt: BENEFIT_ENDS_AT,
      canceledAt: null,
    });
    expect(await readActivationIds()).toHaveLength(1);
    expect(await readNoticeIds()).toEqual([]);
  });

  test('支払いの失敗への変化で依頼待ちのメールの行ができ、確定後にメールの送信が1回依頼され、再試行中の次の変化では依頼し直さない', async () => {
    const harness = createHarness({
      gateway: gatewayReturning(
        ultrasSubscriptionOf(1, {
          status: 'past_due',
          currentPeriodEnd: PERIOD_END,
        }),
      ),
    });
    await insertPurchase(1, { kind: 'ultras' });
    await activate(harness, 1);

    expect(await reflectSubscription(harness, 1, 40)).toEqual({
      kind: 'applied',
    });

    const noticeIds = await readNoticeIds();
    expect(
      await readNoticeRow(soleIdOf(noticeIds, 'メールの依頼')),
    ).toMatchObject({
      userId: userIdOf(1),
      stripeSubscriptionId: stripeSubscriptionIdOf(1),
      kind: 'payment_failed',
      status: 'requested',
      finishedAt: NOW,
    });
    expect(paymentFailedEmailsOf(harness.emails)).toEqual([
      {
        kind: ULTRAS_PAYMENT_FAILED_KIND,
        to: emailOf(1),
        input: { nickname: '利用者1', planUrl: PLAN_URL },
      },
    ]);
    expect(await readSubscriptionRow(stripeSubscriptionIdOf(1))).toMatchObject({
      stripeStatus: 'past_due',
      pastDueSince: minutesAfterT0(40),
    });
    await expect(currentPlanOf(harness)).resolves.toMatchObject({
      status: 'past_due',
    });

    expect(await reflectSubscription(harness, 1, 41)).toEqual({
      kind: 'applied',
    });

    expect(await readNoticeIds()).toEqual(noticeIds);
    expect(paymentFailedEmailsOf(harness.emails)).toHaveLength(1);
  });
});
