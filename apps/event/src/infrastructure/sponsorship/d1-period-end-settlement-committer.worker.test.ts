import { resetSync } from '@logtape/logtape';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { createUlidGenerator } from '../../../lib/core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../../lib/core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../../lib/core/payments/refund-message.ts';
import type { SponsorshipRecord } from '../../../lib/core/sponsorship/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { createMessagePublisher } from '../../../lib/workers/messaging/queue-publisher.ts';
import { D1PurchaseStore } from '../../../lib/workers/payments/d1-purchase-store.ts';
import { D1RefundStore } from '../../../lib/workers/payments/d1-refund-store.ts';
import { D1PaymentRefunds } from '../../../lib/workers/payments/payment-refunds.ts';
import { D1DisplayStopStore } from '../../../lib/workers/sponsorship/d1-display-stop-store.ts';
import { D1SponsorshipStore } from '../../../lib/workers/sponsorship/d1-sponsorship-store.ts';
import {
  D1RefundSettlement,
  type RefundSettlement,
} from '../../../lib/workers/sponsorship/refund-settlement.ts';
import {
  clearSponsorshipTables,
  createSequentialSponsorshipIds,
  db,
  insertDisplayStops,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorshipPurchase,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  productIdOf,
  readSponsorshipRow,
  sponsorshipIdOf,
  sponsorshipPurchaseIdOf,
  terminatedColumnsOf,
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import type { PeriodEndSettlementCommitter } from '../../application/sponsorship/ports.ts';
import { D1PeriodEndSettlementCommitter } from './d1-period-end-settlement-committer.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER = 1;

const PURCHASE_ID = sponsorshipPurchaseIdOf(1);

const DISPLAY_STOP_KEY = `sponsorship:${PURCHASE_ID}:sponsorship_display_stopped`;

// 基準時刻の2026-11-25 0:07
const SETTLED_AT = new Date('2026-11-25T08:07:00.000Z');

// 11-10〜11-16の7日間・7,000セント(1日1,000セント)
const ENDED_PERIOD = Object.freeze({
  startsOn: '2026-11-10',
  endsOn: '2026-11-16',
  days: 7,
});

const clock: Clock = { now: () => NOW };

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

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

let queue: RecordingQueue = createRecordingQueue();

function createSettlement(): RefundSettlement {
  const ids = createUlidGenerator(clock);
  const refundStore = new D1RefundStore(db);
  const refunds = new D1PaymentRefunds({
    appName: 'event',
    db,
    purchases: new D1PurchaseStore(db),
    refunds: refundStore,
    refundStatements: refundStore,
    publisher: createMessagePublisher(
      queue.queue,
      MESSAGE_CONTRACTS,
      ids,
      clock,
    ),
    ids,
    clock,
  });
  return new D1RefundSettlement({
    appName: 'event',
    displayStops: new D1DisplayStopStore(db),
    refundStatements: refunds,
    refunds,
  });
}

function createCommitter(): PeriodEndSettlementCommitter {
  return new D1PeriodEndSettlementCommitter(db, createSettlement());
}

async function readRecord(): Promise<SponsorshipRecord> {
  const record = await new D1SponsorshipStore(
    db,
    createSequentialSponsorshipIds(),
  ).findById(sponsorshipIdOf(1));
  if (record === undefined) {
    throw new Error('申込が見つからない');
  }
  return record;
}

async function readRefundRows(): Promise<
  (typeof paymentRefunds.$inferSelect)[]
> {
  return db
    .select()
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.requestKey));
}

function refundMessagesOf(sent: readonly QueueEnvelope[]): QueueEnvelope[] {
  return sent.filter(({ type }) => type === PAYMENTS_REFUND_MESSAGE.type);
}

// 11-12 10:00から11-14 0:00ちょうどまで非公開(11-12・11-13の2日)
async function arrange(refundedAmount = 0): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
  await insertSponsorships([
    {
      index: 1,
      owner: OWNER,
      product: 1,
      columns: paidColumnsOf(1, ENDED_PERIOD),
    },
  ]);
  await insertSponsorshipPurchase({ index: 1, owner: OWNER, refundedAmount });
  await insertDisplayStops([
    {
      index: 1,
      subject: { kind: 'product', productId: productIdOf(1) },
      startedAt: new Date('2026-11-12T18:00:00.000Z'),
      endedAt: new Date('2026-11-14T08:00:00.000Z'),
    },
  ]);
}

async function clearDisplayStops(): Promise<void> {
  await new D1DisplayStopStore(db).deleteSubject({
    kind: 'product',
    productId: productIdOf(1),
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearSponsorshipTables();
  queue = createRecordingQueue();
});

afterAll(() => {
  resetSync();
});

describe('D1PeriodEndSettlementCommitter', () => {
  test('申込の表示停止の返金の列と返金の依頼の行をそろって確定し、確定の後に依頼を送って結果を返す', async () => {
    await arrange();

    const result = await createCommitter().settle(
      await readRecord(),
      SETTLED_AT,
    );

    const [refund, ...others] = await readRefundRows();
    expect(others).toEqual([]);
    expect(refund).toMatchObject({
      purchaseId: PURCHASE_ID,
      requestKey: DISPLAY_STOP_KEY,
      amount: 2_000,
      reason: 'sponsorship_display_stopped',
      dispatchedAt: NOW,
    });
    expect(result).toStrictEqual({
      kind: 'settled',
      displayStop: {
        kind: 'display_stop',
        days: 2,
        amount: 2_000,
        status: 'requested',
        refundRequestId: refund?.id,
      },
    });
    expect(await readSponsorshipRow(1)).toMatchObject({
      stopRefundStatus: 'requested',
      stopRefundDays: 2,
      stopRefundAmount: 2_000,
      stopRefundRequestId: refund?.id,
      endNotice: 'none',
      updatedAt: SETTLED_AT,
    });
    expect(refundMessagesOf(queue.sent).map(({ body }) => body)).toStrictEqual([
      { refundRequestId: refund?.id },
    ]);
  });

  test('表示停止が無い広告は依頼の行を作らず、返金不要として確定する', async () => {
    await arrange();
    await clearDisplayStops();

    const result = await createCommitter().settle(
      await readRecord(),
      SETTLED_AT,
    );

    expect(result).toMatchObject({
      kind: 'settled',
      displayStop: { status: 'not_needed', days: 0, amount: 0 },
    });
    expect(await readRefundRows()).toEqual([]);
    expect(await readSponsorshipRow(1)).toMatchObject({
      stopRefundStatus: 'not_needed',
      stopRefundDays: 0,
      stopRefundAmount: 0,
    });
    expect(queue.sent).toEqual([]);
  });

  test('同じ読み取りの記録で2回精算すると、2回目は条件の崩れで取り消して返金の依頼を増やさない', async () => {
    await arrange();
    const record = await readRecord();
    const committer = createCommitter();
    await committer.settle(record, SETTLED_AT);
    const sentAfterFirst = queue.sent.length;

    const second = await committer.settle(record, SETTLED_AT);

    expect(second).toStrictEqual({ kind: 'skipped' });
    expect(
      (await readRefundRows()).map(({ requestKey }) => requestKey),
    ).toEqual([DISPLAY_STOP_KEY]);
    expect(queue.sent).toHaveLength(sentAfterFirst);
  });

  test.each([
    ['申込の論理削除', { deletedAt: SETTLED_AT }],
    ['プロダクトの論理削除', { productDeletedAt: SETTLED_AT }],
    ['同時の精算', { stopRefundStatus: 'not_needed' as const }],
    ['強制終了', terminatedColumnsOf(1, ENDED_PERIOD)],
  ])(
    '読み取りの後に%sで条件が崩れると、返金の依頼の行と申込の列の更新の両方を取り消して取り消しを返す',
    async (_label, columns) => {
      await arrange();
      const record = await readRecord();
      await db
        .update(sponsorships)
        .set(columns)
        .where(eq(sponsorships.id, sponsorshipIdOf(1)));

      const result = await createCommitter().settle(record, SETTLED_AT);

      expect(result).toStrictEqual({ kind: 'skipped' });
      expect(await readRefundRows()).toEqual([]);
      expect(await readSponsorshipRow(1)).toMatchObject({
        stopRefundDays: null,
        stopRefundAmount: null,
        stopRefundRequestId: null,
      });
      expect(queue.sent).toEqual([]);
    },
  );

  test('管理者が全額を返金済みの購入は、依頼の行を作らずに返金済みとして確定する', async () => {
    await arrange(7_000);

    const result = await createCommitter().settle(
      await readRecord(),
      SETTLED_AT,
    );

    expect(result).toMatchObject({
      kind: 'settled',
      displayStop: { status: 'already_refunded', refundRequestId: null },
    });
    expect(
      (await readRefundRows()).map(({ requestKey }) => requestKey),
    ).toEqual([`admin:${PURCHASE_ID}`]);
    expect(await readSponsorshipRow(1)).toMatchObject({
      stopRefundStatus: 'already_refunded',
      stopRefundDays: 2,
      stopRefundAmount: 2_000,
    });
  });

  test('条件の崩れ以外の書き込みの失敗は、取り消しにせず例外をそのまま投げる', async () => {
    await arrange();
    const record = await readRecord();
    const failure = new Error('D1の一括の書き込みに失敗した');
    const settlement = createSettlement();
    const failingDb = new Proxy(db, {
      get: (target, property, receiver) =>
        property === 'batch'
          ? () => Promise.reject(failure)
          : (Reflect.get(target, property, receiver) as unknown),
    });

    await expect(
      new D1PeriodEndSettlementCommitter(failingDb, settlement).settle(
        record,
        SETTLED_AT,
      ),
    ).rejects.toBe(failure);
    expect(queue.sent).toEqual([]);
  });
});
