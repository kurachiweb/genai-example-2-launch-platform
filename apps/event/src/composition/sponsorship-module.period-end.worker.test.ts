import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import {
  SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
  SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE,
} from '../../lib/core/messaging/contracts/sponsorship.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../lib/core/payments/refund-message.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import {
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from '../../lib/workers/sponsorship/testing/observability-recording.ts';
import {
  clearSponsorshipTables,
  db,
  insertDisplayStops,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorshipPurchase,
  insertSponsorUser,
  paidColumnsOf,
  productIdOf,
  readSponsorshipRow,
  sponsorshipPurchaseIdOf,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.23.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

// 基準時刻(UTC-08:00)の2026-11-25 0:07。0:07のジョブが精算を依頼する時刻
const SETTLING_AT = new Date('2026-11-25T08:07:00.000Z');

const OWNER = 1;

const STOPPED_PRODUCT = 1;

const OTHER_PRODUCT = 2;

const BULK_PRODUCT = 3;

// 前日に終わった広告(プロダクト1)・今日終わる広告(プロダクト1)・終了日が5日前の広告(プロダクト2)
const ENDED_YESTERDAY = 1;

const ENDING_TODAY = 2;

const ENDED_DAYS_AGO = 3;

const DISPLAY_STOP_KEY = `sponsorship:${sponsorshipPurchaseIdOf(ENDED_YESTERDAY)}:sponsorship_display_stopped`;

const ENVELOPE_PREFIX = '01JD0SPSET';

interface Round {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly sent: readonly QueueEnvelope[];
}

let envelopeCount = 0;

function settleEnvelope(): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
    id: `${ENVELOPE_PREFIX}${String(envelopeCount).padStart(16, '0')}`,
    sentAt: SETTLING_AT.toISOString(),
    body: { requestedAt: SETTLING_AT.toISOString() },
  };
}

// 本番と同じQueueのconsumer・メッセージの処理の一覧・モジュールの一覧で1件を処理し、Queueへ送られた封筒を記録する
async function deliver(envelope: QueueEnvelope): Promise<Round> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: SETTLING_AT, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  // 返金・通知の送信の依頼と続きの再送が後のテストの途中で届かないよう、実際には送らない
  const sendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const ctx = createExecutionContext();
  try {
    await createQueueDispatcher(MESSAGE_HANDLERS, MODULES).dispatch(
      batch,
      env,
      ctx,
    );
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    expect(deadLetterSpy).not.toHaveBeenCalled();
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      sent: sendSpy.mock.calls.map(([body]) => body as QueueEnvelope),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

function typesOf(round: Round): string[] {
  return round.sent.map(({ type }) => type).toSorted();
}

async function readRefundKeys(): Promise<string[]> {
  const rows = await db
    .select({ requestKey: paymentRefunds.requestKey })
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.requestKey));
  return rows.map(({ requestKey }) => requestKey);
}

// プロダクト1は11-20 10:00から11-22 0:00ちょうどまで非公開(11-20・11-21の2日)。7日間・7,000セント(1日1,000セント)
async function seedEndedSponsorships(): Promise<void> {
  await insertSponsorships([
    {
      index: ENDED_YESTERDAY,
      owner: OWNER,
      product: STOPPED_PRODUCT,
      columns: paidColumnsOf(ENDED_YESTERDAY, {
        startsOn: '2026-11-18',
        endsOn: '2026-11-24',
        days: 7,
        startNotice: 'requested',
      }),
    },
    {
      index: ENDING_TODAY,
      owner: OWNER,
      product: STOPPED_PRODUCT,
      columns: paidColumnsOf(ENDING_TODAY, {
        startsOn: '2026-11-19',
        endsOn: '2026-11-25',
        days: 7,
        startNotice: 'requested',
      }),
    },
    {
      index: ENDED_DAYS_AGO,
      owner: OWNER,
      product: OTHER_PRODUCT,
      columns: paidColumnsOf(ENDED_DAYS_AGO, {
        startsOn: '2026-11-14',
        endsOn: '2026-11-20',
        days: 7,
        startNotice: 'requested',
      }),
    },
  ]);
  for (const index of [ENDED_YESTERDAY, ENDING_TODAY, ENDED_DAYS_AGO]) {
    await insertSponsorshipPurchase({ index, owner: OWNER });
  }
  await insertDisplayStops([
    {
      index: 1,
      subject: { kind: 'product', productId: productIdOf(STOPPED_PRODUCT) },
      startedAt: new Date('2026-11-20T18:00:00.000Z'),
      endedAt: new Date('2026-11-22T08:00:00.000Z'),
    },
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // 本番のQueueの経路は処理の時刻をシステムの時計から読むため、業務日付2026-11-25の0:07に固定する
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SETTLING_AT);
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  for (const index of [STOPPED_PRODUCT, OTHER_PRODUCT, BULK_PRODUCT]) {
    await insertSponsorProduct({ index, owner: OWNER });
  }
});

afterEach(() => {
  resetSponsorshipObservability();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sponsorship.settle-period-endのQueueの処理', () => {
  test('掲載終了日の翌日に表示停止日数分の返金を1回だけ依頼し、精算した広告の掲載終了通知だけを依頼待ちにして送信を依頼する', async () => {
    await seedEndedSponsorships();
    expect(await readSponsorshipRow(ENDED_YESTERDAY)).toMatchObject({
      stopRefundStatus: 'none',
      endNotice: 'none',
    });

    const round = await deliver(settleEnvelope());

    expect(round).toMatchObject({ acked: true, retried: false });
    expect(typesOf(round)).toStrictEqual(
      [
        PAYMENTS_REFUND_MESSAGE.type,
        SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
      ].toSorted(),
    );
    expect(await readRefundKeys()).toStrictEqual([DISPLAY_STOP_KEY]);
    expect(await readSponsorshipRow(ENDED_YESTERDAY)).toMatchObject({
      stopRefundStatus: 'requested',
      stopRefundDays: 2,
      stopRefundAmount: 2_000,
      endNotice: 'pending',
    });
    expect(await readSponsorshipRow(ENDING_TODAY)).toMatchObject({
      stopRefundStatus: 'none',
      endNotice: 'none',
    });
  });

  test('終了日が2日以上前の未精算の広告も精算し、掲載終了通知を依頼待ちにする', async () => {
    await seedEndedSponsorships();

    await deliver(settleEnvelope());

    expect(await readSponsorshipRow(ENDED_DAYS_AGO)).toMatchObject({
      stopRefundStatus: 'not_needed',
      stopRefundDays: 0,
      stopRefundAmount: 0,
      stopRefundRequestId: null,
      endNotice: 'pending',
    });
  });

  test('同じ依頼が再び届いても、返金の依頼を増やさず、精算と依頼待ちの記録を変えない', async () => {
    await seedEndedSponsorships();
    await deliver(settleEnvelope());
    const settled = await readSponsorshipRow(ENDED_YESTERDAY);

    const second = await deliver(settleEnvelope());

    expect(second).toMatchObject({ acked: true, retried: false });
    expect(typesOf(second)).toStrictEqual([
      SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
    ]);
    expect(await readRefundKeys()).toStrictEqual([DISPLAY_STOP_KEY]);
    expect(await readSponsorshipRow(ENDED_YESTERDAY)).toStrictEqual(settled);
  });

  test('20件を超える未精算の広告は、20件を精算して続きを遅らせて送り、続きで残りを精算する', async () => {
    await insertSponsorships(
      Array.from({ length: 21 }, (_, offset) => {
        const index = 100 + offset;
        return {
          index,
          owner: OWNER,
          product: BULK_PRODUCT,
          columns: paidColumnsOf(index, {
            startsOn: '2026-11-18',
            endsOn: '2026-11-24',
            days: 7,
            startNotice: 'requested',
          }),
        };
      }),
    );
    const envelope = settleEnvelope();

    const first = await deliver(envelope);

    expect(first).toMatchObject({ acked: true, retried: false });
    const continued = first.sent.filter(
      ({ type }) => type === SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
    );
    expect(continued).toStrictEqual([envelope]);
    expect((await readSponsorshipRow(120))?.stopRefundStatus).toBe('none');
    expect((await readSponsorshipRow(119))?.stopRefundStatus).toBe(
      'not_needed',
    );

    const second = await deliver(envelope);

    expect(typesOf(second)).toStrictEqual([
      SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
    ]);
    expect(await readSponsorshipRow(120)).toMatchObject({
      stopRefundStatus: 'not_needed',
      endNotice: 'pending',
    });
  });

  test('ログに件数と続けるかどうかだけを記録する', async () => {
    await seedEndedSponsorships();
    const logs = recordSponsorshipLogs('event');

    await deliver(settleEnvelope());

    expect(
      logs.filter(({ category }) => category === 'event.sponsorship'),
    ).toMatchObject([
      {
        message: 'スポンサー広告の掲載の終わりの精算を処理しました',
        settled: 2,
        skipped: 0,
        failed: 0,
        more: false,
      },
    ]);
  });
});
