import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { SPONSORSHIP_TERMINATE_ACTION } from '../../../common-lib/admin/audit-actions/sponsorship.ts';
import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { createUlidGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../../lib/core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import type { PaymentRefunds } from '../../../lib/core/payments/ports.ts';
import type { SponsorshipRecord } from '../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { LogObject } from '../../../lib/core/logging/log-record.ts';
import { createMessagePublisher } from '../../../lib/workers/messaging/queue-publisher.ts';
import { D1PurchaseStore } from '../../../lib/workers/payments/d1-purchase-store.ts';
import { D1RefundStore } from '../../../lib/workers/payments/d1-refund-store.ts';
import { D1PaymentRefunds } from '../../../lib/workers/payments/payment-refunds.ts';
import { D1ProductDirectory } from '../../../lib/workers/product/d1-product-directory.ts';
import { D1DisplayStopStore } from '../../../lib/workers/sponsorship/d1-display-stop-store.ts';
import { D1PlacementReader } from '../../../lib/workers/sponsorship/d1-placement-reader.ts';
import { D1SponsorshipStore } from '../../../lib/workers/sponsorship/d1-sponsorship-store.ts';
import {
  D1RefundSettlement,
  type RefundSettlement,
} from '../../../lib/workers/sponsorship/refund-settlement.ts';
import {
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from '../../../lib/workers/sponsorship/testing/observability-recording.ts';
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
} from '../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import type { TerminationCommitResult } from '../../application/sponsorship/sponsorship-termination.ts';
import {
  adminIdOf,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../admin/testing/admin-store-fixtures.ts';
import { D1TerminationWriter } from './d1-termination-writer.ts';

const OWNER = 1;
const SPONSORSHIP_ID = sponsorshipIdOf(1);
const PURCHASE_ID = sponsorshipPurchaseIdOf(1);
const TODAY: BusinessDate = parseBusinessDate('2026-11-25');
const REASON = '規約に反する広告のため';

// 基準時刻の2026-11-25 10:00
const AT = new Date('2026-11-25T18:00:00.000Z');

// 11-20〜11-29の10日間・10,000セント(1日1,000セント)。強制終了日11-25から5日が未掲載
const PERIOD = Object.freeze({
  startsOn: '2026-11-20',
  endsOn: '2026-11-29',
  days: 10,
  amountTotal: 10_000,
});

const clock: Clock = { now: () => NOW };

const TERMINATION_KEY = `sponsorship:${PURCHASE_ID}:sponsorship_terminated`;
const DISPLAY_STOP_KEY = `sponsorship:${PURCHASE_ID}:sponsorship_display_stopped`;

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
let auditLogIds: IdGenerator = createSequentialAuditLogIds();
let logs: LogObject[] = [];

function createPaymentRefunds(): D1PaymentRefunds {
  const ids = createUlidGenerator(clock);
  const refundStore = new D1RefundStore(db);
  return new D1PaymentRefunds({
    appName: 'api',
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
}

// 依頼の送信だけが失敗する決済の機能の口
function failingDispatchOf(refunds: PaymentRefunds): PaymentRefunds {
  return {
    request: (input) => refunds.request(input),
    dispatch: () => Promise.reject(new Error('送信できない')),
    redispatch: (refundRequestId) => refunds.redispatch(refundRequestId),
  };
}

function createSettlement(
  options: { readonly failDispatch?: boolean } = {},
): D1RefundSettlement {
  const refunds = createPaymentRefunds();
  return new D1RefundSettlement({
    appName: 'api',
    displayStops: new D1DisplayStopStore(db),
    refundStatements: refunds,
    refunds:
      options.failDispatch === true ? failingDispatchOf(refunds) : refunds,
  });
}

// 全ての呼び出しが計画を作り終えるまで返さず、同時の強制終了で計画が確定より前にそろう状況を作る
function planningTogether(
  inner: RefundSettlement,
  parties: number,
): RefundSettlement {
  let arrived = 0;
  let release: () => void = () => undefined;
  const allPlanned = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    planTermination: async (record, today) => {
      const plans = await inner.planTermination(record, today);
      arrived += 1;
      if (arrived === parties) {
        release();
      }
      await allPlanned;
      return plans;
    },
    planPeriodEnd: (record) => inner.planPeriodEnd(record),
    periodEndStatement: (record, plan, at, database) =>
      inner.periodEndStatement(record, plan, at, database),
    dispatch: (plans) => inner.dispatch(plans),
  };
}

function writerOf(settlement: RefundSettlement = createSettlement()) {
  return new D1TerminationWriter(db, settlement);
}

function auditOf(occurredAt: Date = AT): PreparedAuditEntry {
  return createAuditLogRecorder({ ids: auditLogIds }).prepare({
    operatorAdminId: adminIdOf(1),
    action: SPONSORSHIP_TERMINATE_ACTION.name,
    targetIds: [SPONSORSHIP_ID],
    reason: REASON,
    detail: {
      unexposedDays: '5',
      refundEstimate: '5000',
      stoppedDays: '2',
      stopRefundAmount: '2000',
    },
    occurredAt,
  });
}

async function readRecord(): Promise<SponsorshipRecord> {
  const record = await new D1SponsorshipStore(
    db,
    createSequentialSponsorshipIds(),
  ).findById(SPONSORSHIP_ID);
  if (record === undefined) {
    throw new Error('申込が見つからない');
  }
  return record;
}

async function readRefundRows() {
  return db
    .select()
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.requestKey));
}

async function placedIds(now: Date): Promise<string[]> {
  const placements = await new D1PlacementReader(
    db,
    new D1ProductDirectory(db),
  ).read(now);
  return [...placements.legend, ...placements.gold, ...placements.silver].map(
    ({ sponsorshipId }) => sponsorshipId,
  );
}

async function arrange(refundedAmount = 0): Promise<SponsorshipRecord> {
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
  await insertSponsorships([
    { index: 1, owner: OWNER, product: 1, columns: paidColumnsOf(1, PERIOD) },
  ]);
  await insertSponsorshipPurchase({
    index: 1,
    owner: OWNER,
    amountTotal: PERIOD.amountTotal,
    refundedAmount,
  });
  // 11-22 10:00から11-24 0:00ちょうどまで(11-22・11-23の2日)
  await insertDisplayStops([
    {
      index: 1,
      subject: { kind: 'product', productId: productIdOf(1) },
      startedAt: new Date('2026-11-22T18:00:00.000Z'),
      endedAt: new Date('2026-11-24T08:00:00.000Z'),
    },
  ]);
  return readRecord();
}

function commitInput(record: SponsorshipRecord, today: BusinessDate = TODAY) {
  return { record, today, reason: REASON, at: AT, audit: auditOf() };
}

const UNCHANGED_COLUMNS = Object.freeze({
  state: 'paid',
  terminatedAt: null,
  terminationReason: null,
  terminationNotice: 'none',
  terminationRefundStatus: 'none',
  terminationRefundDays: null,
  terminationRefundAmount: null,
  terminationRefundRequestId: null,
  stopRefundStatus: 'none',
  stopRefundDays: null,
  stopRefundAmount: null,
  stopRefundRequestId: null,
});

beforeEach(async () => {
  await clearSponsorshipTables();
  await clearAdminTables();
  queue = createRecordingQueue();
  auditLogIds = createSequentialAuditLogIds();
  logs = recordSponsorshipLogs('api');
});

afterEach(() => {
  resetSponsorshipObservability();
});

describe('D1TerminationWriter 強制終了の確定', () => {
  test('強制終了の状態の前進と2つの返金の列と返金の依頼の行と監査ログが同じ一括の書き込みで確定し、確定の後に依頼を送る', async () => {
    const record = await arrange();

    const result = await writerOf().commit(commitInput(record));

    const refunds = await readRefundRows();
    expect(
      refunds.map(({ requestKey, amount, reason, dispatchedAt }) => ({
        requestKey,
        amount,
        reason,
        dispatchedAt,
      })),
    ).toEqual([
      {
        requestKey: DISPLAY_STOP_KEY,
        amount: 2_000,
        reason: 'sponsorship_display_stopped',
        dispatchedAt: NOW,
      },
      {
        requestKey: TERMINATION_KEY,
        amount: 5_000,
        reason: 'sponsorship_terminated',
        dispatchedAt: NOW,
      },
    ]);
    const [displayStopRefund, terminationRefund] = refunds;
    expect(await readSponsorshipRow(1)).toMatchObject({
      state: 'terminated',
      terminatedAt: AT,
      terminationReason: REASON,
      terminationNotice: 'pending',
      terminationRefundStatus: 'requested',
      terminationRefundDays: 5,
      terminationRefundAmount: 5_000,
      terminationRefundRequestId: terminationRefund?.id,
      stopRefundStatus: 'requested',
      stopRefundDays: 2,
      stopRefundAmount: 2_000,
      stopRefundRequestId: displayStopRefund?.id,
      updatedAt: AT,
    });
    expect(await readAuditLogSummaries()).toEqual([
      {
        id: auditLogIdOf(1),
        operatorAdminId: adminIdOf(1),
        action: 'sponsorship.terminate',
        detail: {
          unexposedDays: '5',
          refundEstimate: '5000',
          stoppedDays: '2',
          stopRefundAmount: '2000',
        },
      },
    ]);
    expect(await readAuditLogTargetIds()).toEqual([SPONSORSHIP_ID]);
    expect(queue.sent).toHaveLength(2);
    expect(result).toEqual({
      kind: 'committed',
      termination: {
        kind: 'termination',
        days: 5,
        amount: 5_000,
        status: 'requested',
        refundRequestId: terminationRefund?.id,
      },
      displayStop: {
        kind: 'display_stop',
        days: 2,
        amount: 2_000,
        status: 'requested',
        refundRequestId: displayStopRefund?.id,
      },
    });
  });

  test('返す結果の日数・金額・状態・依頼の識別が申込に記録した列と一致し、文を含まない', async () => {
    const record = await arrange();

    const result = await writerOf().commit(commitInput(record));

    const row = await readSponsorshipRow(1);
    expect(result).toEqual({
      kind: 'committed',
      termination: {
        kind: 'termination',
        days: row?.terminationRefundDays,
        amount: row?.terminationRefundAmount,
        status: row?.terminationRefundStatus,
        refundRequestId: row?.terminationRefundRequestId,
      },
      displayStop: {
        kind: 'display_stop',
        days: row?.stopRefundDays,
        amount: row?.stopRefundAmount,
        status: row?.stopRefundStatus,
        refundRequestId: row?.stopRefundRequestId,
      },
    });
  });

  test('確定の後は広告の表示から消える', async () => {
    const record = await arrange();
    expect(await placedIds(AT)).toEqual([SPONSORSHIP_ID]);

    await writerOf().commit(commitInput(record));

    expect(await placedIds(AT)).toEqual([]);
  });

  test('管理者が全額を返金済みの購入でも強制終了が確定し、依頼の行を作らずに返金済みの結果になる', async () => {
    const record = await arrange(PERIOD.amountTotal);

    const result = await writerOf().commit(commitInput(record));

    expect(result).toMatchObject({
      kind: 'committed',
      termination: {
        days: 5,
        amount: 5_000,
        status: 'already_refunded',
        refundRequestId: null,
      },
      displayStop: {
        days: 2,
        amount: 2_000,
        status: 'already_refunded',
        refundRequestId: null,
      },
    });
    expect(await readSponsorshipRow(1)).toMatchObject({
      state: 'terminated',
      terminationNotice: 'pending',
      terminationRefundStatus: 'already_refunded',
      terminationRefundRequestId: null,
      stopRefundStatus: 'already_refunded',
      stopRefundRequestId: null,
    });
    expect(
      (await readRefundRows()).map(({ requestKey }) => requestKey),
    ).toEqual([`admin:${PURCHASE_ID}`]);
    expect(await readAuditLogSummaries()).toHaveLength(1);
    expect(queue.sent).toEqual([]);
  });

  test('確定の後の依頼の送信が失敗しても警告のログで終わり、確定した結果を返す', async () => {
    const record = await arrange();

    const result = await writerOf(
      createSettlement({ failDispatch: true }),
    ).commit(commitInput(record));

    expect(result.kind).toBe('committed');
    expect(await readSponsorshipRow(1)).toMatchObject({
      state: 'terminated',
      terminationRefundStatus: 'requested',
      stopRefundStatus: 'requested',
    });
    expect(await readRefundRows()).toHaveLength(2);
    expect(await readAuditLogSummaries()).toHaveLength(1);
    expect(
      logs
        .filter(({ level }) => level === 'warning')
        .map(({ category, message, refundKind }) => ({
          category,
          message,
          refundKind,
        })),
    ).toEqual([
      {
        category: 'api.sponsorship.refund',
        message: 'スポンサー広告の返金の依頼を送れませんでした',
        refundKind: 'termination',
      },
      {
        category: 'api.sponsorship.refund',
        message: 'スポンサー広告の返金の依頼を送れませんでした',
        refundKind: 'display_stop',
      },
    ]);
  });
});

describe('D1TerminationWriter 強制終了できない申込', () => {
  test.each([
    ['未決済', { state: 'pending_payment' as const }],
    ['申込の論理削除', { deletedAt: AT }],
    ['プロダクトの論理削除の記録', { productDeletedAt: AT }],
  ])(
    '計画の後に%sになると、返金の依頼と監査ログを含む書き込み全体が取り消されて強制終了できない結果になり、依頼を送らない',
    async (_label, columns) => {
      const record = await arrange();
      await db
        .update(sponsorships)
        .set(columns)
        .where(eq(sponsorships.id, SPONSORSHIP_ID));

      const result = await writerOf().commit(commitInput(record));

      expect(result).toEqual({ kind: 'not_terminable' });
      expect(await readSponsorshipRow(1)).toMatchObject({
        ...UNCHANGED_COLUMNS,
        ...columns,
      });
      expect(await readRefundRows()).toEqual([]);
      expect(await readAuditLogSummaries()).toEqual([]);
      expect(queue.sent).toEqual([]);
    },
  );

  test('終了日を過ぎた申込は、表示停止の返金の依頼と監査ログを含む書き込み全体が取り消されて強制終了できない結果になる', async () => {
    const record = await arrange();

    const result = await writerOf().commit(
      commitInput(record, parseBusinessDate('2026-11-30')),
    );

    expect(result).toEqual({ kind: 'not_terminable' });
    expect(await readSponsorshipRow(1)).toMatchObject(UNCHANGED_COLUMNS);
    expect(await readRefundRows()).toEqual([]);
    expect(await readAuditLogSummaries()).toEqual([]);
    expect(queue.sent).toEqual([]);
  });

  test('強制終了の後に同じ申込の読み取りで2回目を確定すると強制終了できない結果になり、監査ログと返金の依頼は1回目のまま', async () => {
    const record = await arrange();
    await writerOf().commit(commitInput(record));
    const afterFirst = await readSponsorshipRow(1);

    const second = await writerOf().commit(commitInput(record));

    expect(second).toEqual({ kind: 'not_terminable' });
    expect(await readSponsorshipRow(1)).toEqual(afterFirst);
    expect(await readRefundRows()).toHaveLength(2);
    expect(await readAuditLogSummaries()).toHaveLength(1);
    expect(queue.sent).toHaveLength(2);
  });

  test('同時の2回の強制終了は1回だけ確定し、監査ログは1件、返金の依頼の行と送信は1回分になる', async () => {
    const record = await arrange();
    const settlement = planningTogether(createSettlement(), 2);

    const results: TerminationCommitResult[] = await Promise.all([
      writerOf(settlement).commit(commitInput(record)),
      writerOf(settlement).commit(commitInput(record)),
    ]);

    expect(results.map(({ kind }) => kind).toSorted()).toEqual([
      'committed',
      'not_terminable',
    ]);
    expect(await readAuditLogSummaries()).toHaveLength(1);
    const refunds = await readRefundRows();
    expect(refunds.map(({ requestKey }) => requestKey)).toEqual([
      DISPLAY_STOP_KEY,
      TERMINATION_KEY,
    ]);
    expect(await readSponsorshipRow(1)).toMatchObject({
      state: 'terminated',
      terminationRefundRequestId: refunds[1]?.id,
      stopRefundRequestId: refunds[0]?.id,
    });
    expect(queue.sent).toHaveLength(2);
  });
});
