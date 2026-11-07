import {
  CloudflareClient,
  type Event,
  getCurrentScope,
} from '@sentry/cloudflare';
import { afterEach, describe, expect, test } from 'bun:test';
import type { BatchItem } from 'drizzle-orm/batch';

import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { SubscriptionChange } from '../../core/payments/purchase-kind-contract.ts';
import type {
  SubscriptionRow,
  SubscriptionStore,
  UltrasNotifier,
} from '../../core/ultras/ports.ts';
import { EMPTY_SUBSCRIPTION_SNAPSHOT } from '../../core/ultras/subscription-transition.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  PlanStateSink,
  ULTRAS_PLAN_STATE_SINK_NAME,
} from './plan-state-sink.ts';
import type {
  NoticeStatements,
  SubscriptionStatements,
} from './statement-contracts.ts';
import { noticePayloadOf } from './ultras-notifier.ts';

const USER_ID = '01JC0USER00000000000000001';
const PURCHASE_ID = '01JC0PRCH00000000000000001';
const SUBSCRIPTION_ID = '01JC0SUBS00000000000000001';
const STRIPE_SUBSCRIPTION_ID = 'sub_ultras_0000000000000001';
const STARTED_AT = new Date('2026-10-06T04:21:00.000Z');
const OCCURRED_AT = new Date('2026-11-06T04:21:00.000Z');
const CURRENT_PERIOD_END = new Date('2026-12-06T04:21:00.000Z');
// 課金期間の最後の瞬間(12月6日04:21Zの1ミリ秒前)が属するUTC-08:00の日付(12月5日)の終わり
const BENEFIT_ENDS_AT = new Date('2026-12-06T08:00:00.000Z');
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const UNEXPECTED_STATUS_MESSAGE =
  '本サービスの設定では届かないはずの定期課金の状態を受け取りました';
const SCHEDULED_END_MISSING_MESSAGE =
  '解約が予約された定期課金に終了の予定時刻が無く、特典の終了時刻を決められませんでした';
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const CHANGE: SubscriptionChange = Object.freeze({
  subscriptionId: STRIPE_SUBSCRIPTION_ID,
  userId: USER_ID,
  pseudonymousId: 'pseudonymous_0000000000000001',
  purchaseId: PURCHASE_ID,
  status: 'active',
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodEnd: CURRENT_PERIOD_END,
  endedAt: null,
  occurredAt: OCCURRED_AT,
});

const ACTIVATED_ROW: SubscriptionRow = Object.freeze({
  ...EMPTY_SUBSCRIPTION_SNAPSHOT,
  id: SUBSCRIPTION_ID,
  stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
  userId: USER_ID,
  purchaseId: PURCHASE_ID,
  stripeStatus: 'active',
  currentPeriodEnd: CURRENT_PERIOD_END,
  startedAt: STARTED_AT,
});

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [attribute: string]: unknown;
}

type UpsertInput = Parameters<SubscriptionStatements['upsertStripeState']>[0];
type InsertNoticeInput = Parameters<NoticeStatements['insertIfAbsent']>[0];

interface RecordingSubscriptionStore {
  readonly store: SubscriptionStore;
  readonly lookups: string[];
  readonly writes: string[];
}

interface RecordingSubscriptionStatements {
  readonly statements: SubscriptionStatements;
  readonly upserted: UpsertInput[];
  readonly built: BatchItem<'sqlite'>[];
}

interface RecordingNoticeStatements {
  readonly statements: NoticeStatements;
  readonly inserted: InsertNoticeInput[];
  readonly built: BatchItem<'sqlite'>[];
}

interface RecordingNotifier {
  readonly notifier: UltrasNotifier;
  readonly sentFor: string[];
}

function unused(): never {
  throw new Error('このテストでは使わない操作です');
}

// 文の中身はD1の実装が受け持つため、どの契約のどの入力から作られた文かを識別できる印だけを返す
function statementMarker(name: string, input: unknown): BatchItem<'sqlite'> {
  return { marker: name, input } as unknown as BatchItem<'sqlite'>;
}

function createRecordingSubscriptionStore(
  row?: SubscriptionRow,
): RecordingSubscriptionStore {
  const lookups: string[] = [];
  const writes: string[] = [];
  const store: SubscriptionStore = {
    findByStripeId: (stripeSubscriptionId) => {
      lookups.push(stripeSubscriptionId);
      return Promise.resolve(row);
    },
    findEntitledOverlapping: unused,
    findOverlapping: unused,
    findLatestActivated: unused,
    findCancellable: unused,
    markPendingCancellation: () => {
      writes.push('markPendingCancellation');
      return Promise.resolve();
    },
  };
  return { store, lookups, writes };
}

function createRecordingSubscriptionStatements(): RecordingSubscriptionStatements {
  const upserted: UpsertInput[] = [];
  const built: BatchItem<'sqlite'>[] = [];
  const statements: SubscriptionStatements = {
    upsertStripeState: (input) => {
      upserted.push(input);
      const statement = statementMarker('upsertStripeState', input);
      built.push(statement);
      return statement;
    },
    activate: unused,
    deleteByUser: unused,
  };
  return { statements, upserted, built };
}

function createRecordingNoticeStatements(): RecordingNoticeStatements {
  const inserted: InsertNoticeInput[] = [];
  const built: BatchItem<'sqlite'>[] = [];
  const statements: NoticeStatements = {
    insertIfAbsent: (input) => {
      inserted.push(input);
      const statement = statementMarker('insertIfAbsent', input);
      built.push(statement);
      return statement;
    },
    deleteByUser: unused,
  };
  return { statements, inserted, built };
}

function createRecordingNotifier(): RecordingNotifier {
  const sentFor: string[] = [];
  const notifier: UltrasNotifier = {
    sendPendingFor: (stripeSubscriptionId) => {
      sentFor.push(stripeSubscriptionId);
      return Promise.resolve();
    },
    send: unused,
  };
  return { notifier, sentFor };
}

function createSequentialIds(): IdGenerator {
  let count = 0;
  return {
    generate: () => {
      count += 1;
      return `01JC0GEN${String(count).padStart(18, '0')}`;
    },
  };
}

function recordLogs(appName: 'api' | 'event' = 'api'): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

function installRecordingSentry(): Event[] {
  const events: Event[] = [];
  const client = new CloudflareClient({
    dsn: TEST_DSN,
    integrations: [],
    stackParser: () => [],
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
    beforeSend: (event) => {
      events.push(event);
      return null;
    },
  });
  getCurrentScope().setClient(client);
  client.init();
  return events;
}

function sinkWith(parts: {
  readonly appName?: 'api' | 'event';
  readonly row?: SubscriptionRow;
}) {
  const subscriptions = createRecordingSubscriptionStore(parts.row);
  const subscriptionStatements = createRecordingSubscriptionStatements();
  const noticeStatements = createRecordingNoticeStatements();
  const notifier = createRecordingNotifier();
  const sink = new PlanStateSink({
    appName: parts.appName ?? 'api',
    subscriptions: subscriptions.store,
    subscriptionStatements: subscriptionStatements.statements,
    noticeStatements: noticeStatements.statements,
    notifier: notifier.notifier,
    ids: createSequentialIds(),
  });
  return {
    sink,
    subscriptions,
    subscriptionStatements,
    noticeStatements,
    notifier,
  };
}

afterEach(() => {
  getCurrentScope().setClient(undefined);
});

describe('ULTRAS_PLAN_STATE_SINK_NAME', () => {
  test('paymentsの受け取り口の登録名は<spec名>.<名詞句>の形である', () => {
    expect(ULTRAS_PLAN_STATE_SINK_NAME).toBe('ultras-subscription.plan-state');
  });
});

describe('PlanStateSink', () => {
  describe('statementsFor', () => {
    test('利用者に結び付かない変化では、加入を照会せず文を返さず、送り出しもログも行わない', async () => {
      const events = installRecordingSentry();
      const logs = recordLogs();
      const {
        sink,
        subscriptions,
        subscriptionStatements,
        noticeStatements,
        notifier,
      } = sinkWith({ row: ACTIVATED_ROW });

      const statements = await sink.statementsFor({ ...CHANGE, userId: null });

      expect(statements).toEqual([]);
      expect(subscriptions.lookups).toEqual([]);
      expect(subscriptionStatements.upserted).toEqual([]);
      expect(noticeStatements.inserted).toEqual([]);
      expect(notifier.sentFor).toEqual([]);
      expect(logs).toEqual([]);
      expect(events).toEqual([]);
    });

    test('有効な加入の行に支払いの失敗の再試行中の変化が届くと、再試行の開始時刻を記録した更新の文と、支払いの失敗のメールの依頼の行の文をこの順に返す', async () => {
      const events = installRecordingSentry();
      const logs = recordLogs();
      const { sink, subscriptions, subscriptionStatements, noticeStatements } =
        sinkWith({ row: ACTIVATED_ROW });

      const statements = await sink.statementsFor({
        ...CHANGE,
        status: 'past_due',
      });

      expect(subscriptions.lookups).toEqual([STRIPE_SUBSCRIPTION_ID]);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toBe(subscriptionStatements.built[0]);
      expect(statements[1]).toBe(noticeStatements.built[0]);
      expect(subscriptionStatements.upserted).toEqual([
        {
          row: {
            ...ACTIVATED_ROW,
            stripeStatus: 'past_due',
            pastDueSince: OCCURRED_AT,
          },
        },
      ]);
      expect(noticeStatements.inserted).toEqual([
        {
          id: expect.stringMatching(ULID_PATTERN) as string,
          userId: USER_ID,
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          kind: 'payment_failed',
          dedupeKey: `payment_failed:${STRIPE_SUBSCRIPTION_ID}:${String(OCCURRED_AT.getTime())}`,
          payload: noticePayloadOf({
            acceptedAt: OCCURRED_AT,
            benefitEndsAt: null,
          }),
        },
      ]);
      expect(noticeStatements.inserted[0]?.payload).toEqual({
        acceptedAt: OCCURRED_AT.toISOString(),
      });
      expect(logs).toEqual([]);
      expect(events).toEqual([]);
    });

    test('加入の行が無い定期課金の変化は、未有効の空の値から利用者と購入のIDを変化から写した行を新しいULIDで組み、Stripe側の値を保存する更新の文だけを返す', async () => {
      const logs = recordLogs();
      const { sink, subscriptionStatements, noticeStatements } = sinkWith({});

      const statements = await sink.statementsFor(CHANGE);

      expect(statements).toHaveLength(1);
      expect(statements[0]).toBe(subscriptionStatements.built[0]);
      expect(subscriptionStatements.upserted).toEqual([
        {
          row: {
            ...EMPTY_SUBSCRIPTION_SNAPSHOT,
            id: expect.stringMatching(ULID_PATTERN) as string,
            stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
            userId: USER_ID,
            purchaseId: PURCHASE_ID,
            stripeStatus: 'active',
            currentPeriodEnd: CURRENT_PERIOD_END,
            startedAt: null,
          },
        },
      ]);
      expect(noticeStatements.inserted).toEqual([]);
      expect(logs).toEqual([]);
    });

    test('加入の行が無いまま支払いの失敗の再試行中の変化が届いても、再試行の開始時刻とメールの依頼を持たずに保存する', async () => {
      const { sink, subscriptionStatements, noticeStatements } = sinkWith({});

      await sink.statementsFor({
        ...CHANGE,
        purchaseId: null,
        status: 'past_due',
      });

      expect(subscriptionStatements.upserted).toMatchObject([
        {
          row: {
            purchaseId: null,
            stripeStatus: 'past_due',
            pastDueSince: null,
            startedAt: null,
          },
        },
      ]);
      expect(noticeStatements.inserted).toEqual([]);
    });

    test('有効な加入に利用者による課金期間の末日の解約の予約が届くと、解約の操作と特典の終了時刻を記録した更新の文と、受付と終了の日時を載せた解約の受付のメールの依頼の行の文を返す', async () => {
      const events = installRecordingSentry();
      const logs = recordLogs();
      const { sink, subscriptionStatements, noticeStatements } = sinkWith({
        row: ACTIVATED_ROW,
      });

      const statements = await sink.statementsFor({
        ...CHANGE,
        cancelAtPeriodEnd: true,
      });

      expect(statements).toHaveLength(2);
      expect(subscriptionStatements.upserted).toEqual([
        {
          row: {
            ...ACTIVATED_ROW,
            cancelScheduled: true,
            benefitEndsAt: BENEFIT_ENDS_AT,
            canceledAt: OCCURRED_AT,
            cancellationSource: 'user',
          },
        },
      ]);
      expect(noticeStatements.inserted).toEqual([
        {
          id: expect.stringMatching(ULID_PATTERN) as string,
          userId: USER_ID,
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          kind: 'cancellation_accepted',
          dedupeKey: `cancellation_accepted:${STRIPE_SUBSCRIPTION_ID}:${String(OCCURRED_AT.getTime())}`,
          payload: {
            acceptedAt: OCCURRED_AT.toISOString(),
            benefitEndsAt: BENEFIT_ENDS_AT.toISOString(),
          },
        },
      ]);
      expect(logs).toEqual([]);
      expect(events).toEqual([]);
    });

    test('停止による解約を控えた加入に解約の予約が届くと、解約の操作の元を停止として記録し、解約の受付のメールの依頼は作らない', async () => {
      const { sink, subscriptionStatements, noticeStatements } = sinkWith({
        row: { ...ACTIVATED_ROW, pendingCancellationSource: 'suspension' },
      });

      const statements = await sink.statementsFor({
        ...CHANGE,
        cancelAtPeriodEnd: true,
      });

      expect(statements).toHaveLength(1);
      expect(subscriptionStatements.upserted).toMatchObject([
        {
          row: {
            cancelScheduled: true,
            canceledAt: OCCURRED_AT,
            cancellationSource: 'suspension',
            pendingCancellationSource: 'suspension',
          },
        },
      ]);
      expect(noticeStatements.inserted).toEqual([]);
    });

    test('届かないはずの未払いの状態は、終了として保存する更新の文を返したうえで、定期課金のIDと種類と状態だけを添えたwarnのログと、定型の文言と識別子の形のタグだけのエラートラッキングの通知を1件出す', async () => {
      const events = installRecordingSentry();
      const logs = recordLogs('event');
      const { sink, subscriptionStatements, noticeStatements } = sinkWith({
        appName: 'event',
        row: ACTIVATED_ROW,
      });

      const statements = await sink.statementsFor({
        ...CHANGE,
        status: 'unpaid',
        endedAt: OCCURRED_AT,
      });

      expect(statements).toHaveLength(1);
      expect(subscriptionStatements.upserted).toEqual([
        {
          row: {
            ...ACTIVATED_ROW,
            stripeStatus: 'unpaid',
            endedAt: OCCURRED_AT,
            benefitEndsAt: OCCURRED_AT,
            benefitEndFixed: true,
          },
        },
      ]);
      expect(noticeStatements.inserted).toEqual([]);
      expect(logs).toMatchObject([
        {
          level: 'warning',
          category: 'event.application.ultras',
          message: UNEXPECTED_STATUS_MESSAGE,
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          kind: 'unexpected_status',
          status: 'unpaid',
        },
      ]);
      expect(logs[0]).not.toHaveProperty('userId');
      expect(logs[0]).not.toHaveProperty('purchaseId');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        level: 'warning',
        logentry: { message: UNEXPECTED_STATUS_MESSAGE },
        fingerprint: ['ultras', 'unexpected-subscription-status'],
        tags: {
          ultras_incident: 'unexpected-subscription-status',
          stripe_subscription_id: STRIPE_SUBSCRIPTION_ID,
          stripe_status: 'unpaid',
        },
      });
      expect(JSON.stringify(events[0])).not.toContain(USER_ID);
      expect(JSON.stringify(events[0])).not.toContain(PURCHASE_ID);
    });

    test('解約の予約に終了の予定時刻が無い変化は、終了日時の無い解約の受付の依頼の文を返したうえで、warnのログと種類ごとの指紋のエラートラッキングの通知を出す', async () => {
      const events = installRecordingSentry();
      const logs = recordLogs();
      const { sink, noticeStatements } = sinkWith({ row: ACTIVATED_ROW });

      const statements = await sink.statementsFor({
        ...CHANGE,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: null,
      });

      expect(statements).toHaveLength(2);
      expect(noticeStatements.inserted).toMatchObject([
        {
          kind: 'cancellation_accepted',
          payload: { acceptedAt: OCCURRED_AT.toISOString() },
        },
      ]);
      expect(noticeStatements.inserted[0]?.payload).not.toHaveProperty(
        'benefitEndsAt',
      );
      expect(logs).toMatchObject([
        {
          level: 'warning',
          category: 'api.application.ultras',
          message: SCHEDULED_END_MISSING_MESSAGE,
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          kind: 'scheduled_end_missing',
          status: 'active',
        },
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        level: 'warning',
        logentry: { message: SCHEDULED_END_MISSING_MESSAGE },
        fingerprint: ['ultras', 'scheduled-end-missing'],
        tags: {
          ultras_incident: 'scheduled-end-missing',
          stripe_subscription_id: STRIPE_SUBSCRIPTION_ID,
        },
      });
      expect(events[0]?.tags).not.toHaveProperty('stripe_status');
    });

    test('通知のタグの定期課金のIDは、Stripeの定期課金のIDの形でなければunknownに置き換える', async () => {
      const events = installRecordingSentry();
      recordLogs();
      const { sink } = sinkWith({
        row: { ...ACTIVATED_ROW, stripeSubscriptionId: 'not-a-stripe-id' },
      });

      await sink.statementsFor({
        ...CHANGE,
        subscriptionId: 'not-a-stripe-id',
        status: 'paused',
      });

      expect(events[0]?.tags).toMatchObject({
        stripe_subscription_id: 'unknown',
        stripe_status: 'paused',
      });
    });

    test('同じ変化で何度呼んでも、ストアの書き込みも送り出しも行わず、生成するID以外は同じ文の入力を返す', async () => {
      const {
        sink,
        subscriptions,
        subscriptionStatements,
        noticeStatements,
        notifier,
      } = sinkWith({ row: ACTIVATED_ROW });
      const change = { ...CHANGE, status: 'past_due' as const };

      await sink.statementsFor(change);
      await sink.statementsFor(change);

      expect(subscriptions.writes).toEqual([]);
      expect(notifier.sentFor).toEqual([]);
      expect(subscriptions.lookups).toHaveLength(2);
      expect(subscriptionStatements.upserted[0]).toEqual(
        subscriptionStatements.upserted[1],
      );
      expect(noticeStatements.inserted).toHaveLength(2);
      expect(noticeStatements.inserted[0]?.dedupeKey).toBe(
        noticeStatements.inserted[1]?.dedupeKey,
      );
      expect(noticeStatements.inserted[0]?.id).not.toBe(
        noticeStatements.inserted[1]?.id,
      );
    });
  });

  describe('afterCommit', () => {
    test('確定した定期課金のIDの依頼待ちのメールの送り出しを1回だけ頼み、加入は照会しない', async () => {
      const logs = recordLogs();
      const { sink, subscriptions, notifier } = sinkWith({
        row: ACTIVATED_ROW,
      });

      await sink.afterCommit(CHANGE);

      expect(notifier.sentFor).toEqual([STRIPE_SUBSCRIPTION_ID]);
      expect(subscriptions.lookups).toEqual([]);
      expect(subscriptions.writes).toEqual([]);
      expect(logs).toEqual([]);
    });
  });
});
