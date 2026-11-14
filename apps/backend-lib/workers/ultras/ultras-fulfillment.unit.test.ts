import { resetSync } from '@logtape/logtape';
import {
  CloudflareClient,
  type Event,
  getCurrentScope,
} from '@sentry/cloudflare';
import { afterEach, describe, expect, test } from 'bun:test';
import type { BatchItem } from 'drizzle-orm/batch';

import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import type {
  ActivationDispatcher,
  ActivationStore,
  SubscriptionRow,
  SubscriptionStore,
  UltrasActivationRow,
} from '../../core/ultras/ports.ts';
import { EMPTY_SUBSCRIPTION_SNAPSHOT } from '../../core/ultras/subscription-transition.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import type {
  ActivationStatements,
  SubscriptionStatements,
} from './statement-contracts.ts';
import { UltrasFulfillment } from './ultras-fulfillment.ts';

const USER_ID = '01JC0USER00000000000000001';
const PURCHASE_ID = '01JC0PRCH00000000000000001';
const OVERLAPPING_SUBSCRIPTION_ID = '01JC0SUBS00000000000000009';
const ACTIVATION_ID = '01JC0ACTV00000000000000001';
const STRIPE_SUBSCRIPTION_ID = 'sub_ultras_0000000000000001';
const OTHER_STRIPE_SUBSCRIPTION_ID = 'sub_ultras_0000000000000002';
const PAID_AT = new Date('2026-11-06T04:21:00.000Z');
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const MISSING_SUBSCRIPTION_MESSAGE =
  'Ultrasの購入に定期課金のIDが無いため、加入を有効にできませんでした';
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const EXPECTED_ACTIVATE_INPUT = Object.freeze({
  stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
  userId: USER_ID,
  purchaseId: PURCHASE_ID,
  startedAt: PAID_AT,
});

const EXPECTED_INSERT_INPUT = Object.freeze({
  userId: USER_ID,
  stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
  activatedAt: PAID_AT,
});

const PURCHASE: FulfillablePurchase = Object.freeze({
  purchaseId: PURCHASE_ID,
  userId: USER_ID,
  kind: 'ultras',
  targetId: null,
  relatedId: null,
  quantity: 1,
  amountTotal: 999,
  paymentRecordId: '01JC0PREC00000000000000001',
  paidAt: PAID_AT,
  stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
});

const OVERLAPPING_ROW: SubscriptionRow = Object.freeze({
  ...EMPTY_SUBSCRIPTION_SNAPSHOT,
  id: OVERLAPPING_SUBSCRIPTION_ID,
  stripeSubscriptionId: OTHER_STRIPE_SUBSCRIPTION_ID,
  userId: USER_ID,
  purchaseId: '01JC0PRCH00000000000000000',
  stripeStatus: 'active',
  startedAt: new Date('2026-10-01T00:00:00.000Z'),
});

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [attribute: string]: unknown;
}

type OverlapLookup = Parameters<
  SubscriptionStore['findEntitledOverlapping']
>[0];
type ActivateInput = Parameters<SubscriptionStatements['activate']>[0];
type InsertActivationInput = Parameters<
  ActivationStatements['insertIfAbsent']
>[0];

interface RecordingSubscriptionStore {
  readonly store: SubscriptionStore;
  readonly lookups: OverlapLookup[];
  readonly writes: string[];
}

interface RecordingActivationStore {
  readonly store: ActivationStore;
  readonly lookups: string[];
  readonly writes: string[];
}

interface RecordingSubscriptionStatements {
  readonly statements: SubscriptionStatements;
  readonly activated: ActivateInput[];
  readonly built: BatchItem<'sqlite'>[];
}

interface RecordingActivationStatements {
  readonly statements: ActivationStatements;
  readonly inserted: InsertActivationInput[];
  readonly built: BatchItem<'sqlite'>[];
}

interface RecordingDispatcher {
  readonly dispatcher: ActivationDispatcher;
  readonly dispatched: string[];
}

function unused(): never {
  throw new Error('このテストでは使わない操作です');
}

// 文の中身はD1の実装が受け持つため、どの契約のどの入力から作られた文かを識別できる印だけを返す
function statementMarker(name: string, input: unknown): BatchItem<'sqlite'> {
  return { marker: name, input } as unknown as BatchItem<'sqlite'>;
}

function createRecordingSubscriptionStore(
  overlapping?: SubscriptionRow,
): RecordingSubscriptionStore {
  const lookups: OverlapLookup[] = [];
  const writes: string[] = [];
  const store: SubscriptionStore = {
    findByStripeId: unused,
    findEntitledOverlapping: (input) => {
      lookups.push(input);
      return Promise.resolve(overlapping);
    },
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

function createRecordingActivationStore(
  row?: UltrasActivationRow,
): RecordingActivationStore {
  const lookups: string[] = [];
  const writes: string[] = [];
  const store: ActivationStore = {
    findById: unused,
    findByStripeId: (stripeSubscriptionId) => {
      lookups.push(stripeSubscriptionId);
      return Promise.resolve(row);
    },
    markDispatched: () => {
      writes.push('markDispatched');
      return Promise.resolve();
    },
    markCompleted: () => {
      writes.push('markCompleted');
      return Promise.resolve();
    },
    findUndispatched: unused,
    deleteCompletedBefore: () => {
      writes.push('deleteCompletedBefore');
      return Promise.resolve(0);
    },
  };
  return { store, lookups, writes };
}

function createRecordingSubscriptionStatements(): RecordingSubscriptionStatements {
  const activated: ActivateInput[] = [];
  const built: BatchItem<'sqlite'>[] = [];
  const statements: SubscriptionStatements = {
    upsertStripeState: unused,
    activate: (input) => {
      activated.push(input);
      const statement = statementMarker('activate', input);
      built.push(statement);
      return statement;
    },
    deleteByUser: unused,
  };
  return { statements, activated, built };
}

function createRecordingActivationStatements(): RecordingActivationStatements {
  const inserted: InsertActivationInput[] = [];
  const built: BatchItem<'sqlite'>[] = [];
  const statements: ActivationStatements = {
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

function createRecordingDispatcher(): RecordingDispatcher {
  const dispatched: string[] = [];
  const dispatcher: ActivationDispatcher = {
    dispatch: (activationId) => {
      dispatched.push(activationId);
      return Promise.resolve();
    },
  };
  return { dispatcher, dispatched };
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

function activationRowOf(
  overrides: Partial<UltrasActivationRow> = {},
): UltrasActivationRow {
  return {
    id: ACTIVATION_ID,
    userId: USER_ID,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    activatedAt: PAID_AT,
    dispatchedAt: null,
    completedAt: null,
    createdAt: PAID_AT,
    ...overrides,
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

function fulfillmentWith(parts: {
  readonly appName?: 'api' | 'event';
  readonly overlapping?: SubscriptionRow;
  readonly activation?: UltrasActivationRow;
}) {
  const subscriptions = createRecordingSubscriptionStore(parts.overlapping);
  const activations = createRecordingActivationStore(parts.activation);
  const subscriptionStatements = createRecordingSubscriptionStatements();
  const activationStatements = createRecordingActivationStatements();
  const dispatcher = createRecordingDispatcher();
  const fulfillment = new UltrasFulfillment({
    appName: parts.appName ?? 'api',
    subscriptions: subscriptions.store,
    subscriptionStatements: subscriptionStatements.statements,
    activations: activations.store,
    activationStatements: activationStatements.statements,
    dispatcher: dispatcher.dispatcher,
    ids: createSequentialIds(),
  });
  return {
    fulfillment,
    subscriptions,
    activations,
    subscriptionStatements,
    activationStatements,
    dispatcher,
  };
}

afterEach(() => {
  getCurrentScope().setClient(undefined);
  resetSync();
});

describe('UltrasFulfillment', () => {
  describe('prepare', () => {
    test('定期課金のIDが無い購入は、加入の重なりを照会せず文も作らずにineligibleで拒否し、購入のIDだけを添えたerrorのログと定型の文言のエラートラッキングの通知を1件出す', async () => {
      const events = installRecordingSentry();
      const logs = recordLogs();
      const {
        fulfillment,
        subscriptions,
        subscriptionStatements,
        activationStatements,
      } = fulfillmentWith({ overlapping: OVERLAPPING_ROW });

      const plan = await fulfillment.prepare({
        ...PURCHASE,
        stripeSubscriptionId: null,
      });

      expect(plan).toEqual({ kind: 'reject', reason: 'ineligible' });
      expect(subscriptions.lookups).toEqual([]);
      expect(subscriptionStatements.activated).toEqual([]);
      expect(activationStatements.inserted).toEqual([]);
      expect(logs).toMatchObject([
        {
          level: 'error',
          category: 'api.application.ultras',
          message: MISSING_SUBSCRIPTION_MESSAGE,
          purchaseId: PURCHASE_ID,
        },
      ]);
      expect(logs[0]).not.toHaveProperty('userId');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        level: 'error',
        logentry: { message: MISSING_SUBSCRIPTION_MESSAGE },
        fingerprint: ['ultras', 'fulfillment-missing-subscription'],
        tags: {
          ultras_incident: 'fulfillment-missing-subscription',
          purchase_id: PURCHASE_ID,
        },
      });
      expect(JSON.stringify(events[0])).not.toContain(USER_ID);
    });

    test('通知のタグの購入のIDは、ULIDの形でなければunknownに置き換える', async () => {
      const events = installRecordingSentry();
      recordLogs();
      const { fulfillment } = fulfillmentWith({});

      await fulfillment.prepare({
        ...PURCHASE,
        purchaseId: 'not-a-ulid',
        stripeSubscriptionId: null,
      });

      expect(events[0]?.tags?.purchase_id).toBe('unknown');
    });

    test('支払いの確定の時刻に別の加入の特典の継続期間が重なるなら、文を作らずにineligibleで拒否し、購入・定期課金・重なった加入のIDを添えたwarnのログを出す', async () => {
      const events = installRecordingSentry();
      const logs = recordLogs('event');
      const {
        fulfillment,
        subscriptions,
        subscriptionStatements,
        activationStatements,
      } = fulfillmentWith({ appName: 'event', overlapping: OVERLAPPING_ROW });

      const plan = await fulfillment.prepare(PURCHASE);

      expect(plan).toEqual({ kind: 'reject', reason: 'ineligible' });
      expect(subscriptions.lookups).toEqual([
        {
          userId: USER_ID,
          at: PAID_AT,
          excludeStripeId: STRIPE_SUBSCRIPTION_ID,
        },
      ]);
      expect(subscriptionStatements.activated).toEqual([]);
      expect(activationStatements.inserted).toEqual([]);
      expect(logs).toMatchObject([
        {
          level: 'warning',
          category: 'event.application.ultras',
          purchaseId: PURCHASE_ID,
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          subscriptionId: OVERLAPPING_SUBSCRIPTION_ID,
        },
      ]);
      expect(logs[0]).not.toHaveProperty('userId');
      expect(events).toEqual([]);
    });

    test('重なる加入が無ければ、有効化の文と知らせの行の文をこの順に返し、開始時刻と有効になった時刻を支払いの確定の時刻にし、IDは新しいULIDを使う', async () => {
      const logs = recordLogs();
      const { fulfillment, subscriptionStatements, activationStatements } =
        fulfillmentWith({});

      const plan = await fulfillment.prepare(PURCHASE);

      expect(plan.kind).toBe('fulfill');
      if (plan.kind !== 'fulfill') {
        return;
      }
      expect(plan.statements).toHaveLength(2);
      expect(plan.statements[0]).toBe(subscriptionStatements.built[0]);
      expect(plan.statements[1]).toBe(activationStatements.built[0]);
      expect(subscriptionStatements.activated).toEqual([
        {
          id: expect.stringMatching(ULID_PATTERN) as string,
          ...EXPECTED_ACTIVATE_INPUT,
        },
      ]);
      expect(activationStatements.inserted).toEqual([
        {
          id: expect.stringMatching(ULID_PATTERN) as string,
          ...EXPECTED_INSERT_INPUT,
        },
      ]);
      expect(subscriptionStatements.activated[0]?.id).not.toBe(
        activationStatements.inserted[0]?.id,
      );
      expect(logs).toEqual([]);
    });

    test('同じ購入で何度呼んでも、ストアの書き込みを呼ばず、生成するID以外は同じ判断を返す', async () => {
      const {
        fulfillment,
        subscriptions,
        activations,
        subscriptionStatements,
        activationStatements,
      } = fulfillmentWith({});

      const first = await fulfillment.prepare(PURCHASE);
      const second = await fulfillment.prepare(PURCHASE);

      expect(first.kind).toBe('fulfill');
      expect(second.kind).toBe('fulfill');
      expect(subscriptions.writes).toEqual([]);
      expect(activations.writes).toEqual([]);
      expect(subscriptions.lookups).toHaveLength(2);
      expect(subscriptionStatements.activated).toMatchObject([
        EXPECTED_ACTIVATE_INPUT,
        EXPECTED_ACTIVATE_INPUT,
      ]);
      expect(activationStatements.inserted).toMatchObject([
        EXPECTED_INSERT_INPUT,
        EXPECTED_INSERT_INPUT,
      ]);
      expect(subscriptionStatements.activated[0]?.id).not.toBe(
        subscriptionStatements.activated[1]?.id,
      );
    });
  });

  describe('afterCommit', () => {
    test('定期課金のIDで知らせの行を探し、未完了なら送り出し先にその行のIDを渡す', async () => {
      const logs = recordLogs();
      const { fulfillment, activations, dispatcher } = fulfillmentWith({
        activation: activationRowOf(),
      });

      await fulfillment.afterCommit(PURCHASE);

      expect(activations.lookups).toEqual([STRIPE_SUBSCRIPTION_ID]);
      expect(dispatcher.dispatched).toEqual([ACTIVATION_ID]);
      expect(activations.writes).toEqual([]);
      expect(logs).toEqual([]);
    });

    test('知らせの行が完了済みなら送り出さない', async () => {
      const logs = recordLogs();
      const { fulfillment, dispatcher } = fulfillmentWith({
        activation: activationRowOf({
          dispatchedAt: PAID_AT,
          completedAt: new Date('2026-11-06T04:22:00.000Z'),
        }),
      });

      await fulfillment.afterCommit(PURCHASE);

      expect(dispatcher.dispatched).toEqual([]);
      expect(logs).toEqual([]);
    });

    test('知らせの行が無ければ送り出さず、購入と定期課金のIDを添えたwarnのログを出す', async () => {
      const logs = recordLogs();
      const { fulfillment, dispatcher } = fulfillmentWith({});

      await fulfillment.afterCommit(PURCHASE);

      expect(dispatcher.dispatched).toEqual([]);
      expect(logs).toMatchObject([
        {
          level: 'warning',
          category: 'api.application.ultras',
          purchaseId: PURCHASE_ID,
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
        },
      ]);
    });

    test('定期課金のIDが無い購入では知らせの行を照会せず、送り出さない', async () => {
      const { fulfillment, activations, dispatcher } = fulfillmentWith({
        activation: activationRowOf(),
      });

      await fulfillment.afterCommit({
        ...PURCHASE,
        stripeSubscriptionId: null,
      });

      expect(activations.lookups).toEqual([]);
      expect(dispatcher.dispatched).toEqual([]);
    });
  });
});
