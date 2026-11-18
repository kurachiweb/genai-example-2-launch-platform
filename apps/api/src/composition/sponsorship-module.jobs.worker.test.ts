import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
  SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE,
} from '../../lib/core/messaging/contracts/sponsorship.ts';
import {
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  parseBusinessDate,
  toUtcCronExpression,
} from '../../lib/core/time/business-time.ts';
import {
  clearSponsorshipTables,
  db,
  insertDisplayStops,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  productIdOf,
  readDisplayStopRows,
  readSponsorshipIds,
  readSponsorshipRow,
  sponsorshipIdOf,
  TODAY,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import * as mainModule from '../index.ts';

interface LoggedObject {
  readonly level: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
}

const DATE = parseBusinessDate(TODAY);
const NOTICES_TIME: BusinessTimeOfDay = { hour: 0, minute: 7 };
const MAINTENANCE_TIME: BusinessTimeOfDay = { hour: 4, minute: 21 };
const OWNER = 1;
const PRODUCT = 1;

const SPONSORSHIP_MESSAGE_TYPES: readonly string[] = [
  SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
  SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
];

// 2026-11-25の400日前(2025-10-21)の基準時刻の0:00
const RETENTION_CUTOFF = new Date('2025-10-21T08:00:00.000Z');

const STARTS_TODAY = 1;
const ENDED_UNSETTLED = 2;
const ENDED_SETTLED = 3;
const UNPAID_PAST_START = 4;
const UNPAID_STARTS_TODAY = 5;
const UNPAID_FUTURE = 6;

function recordConsole(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logs;
}

// 本機能のメッセージの種類だけを送った順に記録し、指定があれば本機能のメッセージの送信を失敗させる
function recordSponsorshipMessages(failure?: Error): string[] {
  const types: string[] = [];
  vi.spyOn(env.JOBS_QUEUE, 'send').mockImplementation((message) => {
    const { type } = message as QueueEnvelope;
    if (SPONSORSHIP_MESSAGE_TYPES.includes(type)) {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      types.push(type);
    }
    return Promise.resolve({ metadata: { metrics: {} } } as QueueSendResponse);
  });
  return types;
}

async function runScheduled(time: BusinessTimeOfDay): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron: toUtcCronExpression(time),
      scheduledTime: fromBusinessDateTime(DATE, time).getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

function sponsorshipJobResults(logs: readonly LoggedObject[]): JobSummary[] {
  return logs
    .filter(({ message }) => message === '定期実行を終えました')
    .flatMap((summary) => (summary['jobs'] ?? []) as readonly JobSummary[])
    .filter(({ name }) => name.startsWith('sponsorship.'))
    .map(({ name, result }) => ({ name, result }));
}

function jobFailuresOf(logs: readonly LoggedObject[]): unknown[] {
  return logs
    .filter(({ message }) => message === '定期実行のジョブが失敗しました')
    .map(({ job }) => job);
}

async function noticeStates() {
  const states = [];
  for (const index of [STARTS_TODAY, ENDED_UNSETTLED, ENDED_SETTLED]) {
    const row = await readSponsorshipRow(index);
    states.push({
      index,
      startNotice: row?.startNotice,
      endNotice: row?.endNotice,
      stopRefundStatus: row?.stopRefundStatus,
      updatedAt: row?.updatedAt,
    });
  }
  return states;
}

async function insertScenario(): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: PRODUCT, owner: OWNER });
  const period = (startsOn: string, endsOn: string, days: number) => ({
    startsOn,
    endsOn,
    days,
  });
  await insertSponsorships([
    {
      index: STARTS_TODAY,
      owner: OWNER,
      product: PRODUCT,
      columns: paidColumnsOf(STARTS_TODAY, period(TODAY, '2026-12-01', 7)),
    },
    {
      index: ENDED_UNSETTLED,
      owner: OWNER,
      product: PRODUCT,
      columns: paidColumnsOf(ENDED_UNSETTLED, {
        ...period('2026-11-18', '2026-11-24', 7),
        tier: 'silver',
      }),
    },
    {
      index: ENDED_SETTLED,
      owner: OWNER,
      product: PRODUCT,
      columns: paidColumnsOf(ENDED_SETTLED, {
        ...period('2026-11-11', '2026-11-17', 7),
        tier: 'legend',
        stopRefundStatus: 'not_needed',
      }),
    },
    {
      index: UNPAID_PAST_START,
      owner: OWNER,
      product: PRODUCT,
      columns: period('2026-11-24', '2026-11-30', 7),
    },
    {
      index: UNPAID_STARTS_TODAY,
      owner: OWNER,
      product: PRODUCT,
      columns: period(TODAY, '2026-11-26', 2),
    },
    { index: UNPAID_FUTURE, owner: OWNER, product: PRODUCT },
  ]);
  const subject = { kind: 'product', productId: productIdOf(PRODUCT) } as const;
  await insertDisplayStops([
    {
      index: 1,
      subject,
      startedAt: new Date('2025-09-01T08:00:00.000Z'),
      endedAt: new Date(RETENTION_CUTOFF.getTime() - 1),
    },
    {
      index: 2,
      subject,
      startedAt: new Date('2025-09-02T08:00:00.000Z'),
      endedAt: RETENTION_CUTOFF,
    },
    { index: 3, subject, startedAt: new Date('2025-09-03T08:00:00.000Z') },
  ]);
}

beforeEach(async () => {
  await clearSponsorshipTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('0:07の起動のスポンサー広告の通知のジョブ', () => {
  test('開始と精算済みの終了の通知を依頼待ちにして送信と精算を依頼し、2回目の実行でも記録とメッセージの送信が変わらない', async () => {
    await insertScenario();
    const logs = recordConsole();
    const messages = recordSponsorshipMessages();

    await runScheduled(NOTICES_TIME);
    const afterFirst = await noticeStates();
    const firstMessages = [...messages];
    messages.length = 0;
    await runScheduled(NOTICES_TIME);

    expect(sponsorshipJobResults(logs)).toEqual([
      { name: 'sponsorship.daily-notices', result: 'succeeded' },
      { name: 'sponsorship.daily-notices', result: 'succeeded' },
    ]);
    expect(firstMessages).toEqual([
      SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
      SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
    ]);
    expect(messages).toEqual(firstMessages);
    expect(afterFirst).toMatchObject([
      { index: STARTS_TODAY, startNotice: 'pending', endNotice: 'none' },
      {
        index: ENDED_UNSETTLED,
        startNotice: 'none',
        endNotice: 'none',
        stopRefundStatus: 'none',
      },
      {
        index: ENDED_SETTLED,
        startNotice: 'none',
        endNotice: 'pending',
        stopRefundStatus: 'not_needed',
      },
    ]);
    expect(await noticeStates()).toEqual(afterFirst);
  });

  test('精算は自分で行わずにメッセージを送るだけで、未決済の申込と表示停止の区間を消さない', async () => {
    await insertScenario();
    recordConsole();
    recordSponsorshipMessages();

    await runScheduled(NOTICES_TIME);

    expect(await readSponsorshipRow(ENDED_UNSETTLED)).toMatchObject({
      stopRefundStatus: 'none',
      stopRefundDays: null,
      stopRefundRequestId: null,
    });
    expect(await db.select().from(paymentRefunds)).toEqual([]);
    expect(await readSponsorshipIds()).toHaveLength(6);
    expect(await readDisplayStopRows()).toHaveLength(3);
  });

  test('D1の障害ではジョブが失敗して定期実行の規約で記録され、依頼待ちの記録もメッセージの送信もしない', async () => {
    await insertScenario();
    const logs = recordConsole();
    const messages = recordSponsorshipMessages();
    vi.spyOn(env.DB, 'batch').mockRejectedValue(
      new Error('D1の障害を模した失敗'),
    );

    await runScheduled(NOTICES_TIME);

    expect(sponsorshipJobResults(logs)).toEqual([
      { name: 'sponsorship.daily-notices', result: 'failed' },
    ]);
    expect(jobFailuresOf(logs)).toEqual(['sponsorship.daily-notices']);
    expect(messages).toEqual([]);
    expect(await readSponsorshipRow(STARTS_TODAY)).toMatchObject({
      startNotice: 'none',
    });
  });
});

describe('4:21の起動のスポンサー広告の日次の処理', () => {
  test('開始日を過ぎた未決済だけを消し、精算と送信を依頼し直し、終わりから400日を過ぎた区間を消して、2回目の実行でも結果とメッセージの送信が変わらない', async () => {
    await insertScenario();
    const logs = recordConsole();
    const messages = recordSponsorshipMessages();

    await runScheduled(MAINTENANCE_TIME);
    const firstMessages = [...messages];
    const firstIds = await readSponsorshipIds();
    const firstNotices = await noticeStates();
    const firstStops = await readDisplayStopRows();
    messages.length = 0;
    await runScheduled(MAINTENANCE_TIME);

    expect(sponsorshipJobResults(logs)).toEqual([
      { name: 'sponsorship.maintenance', result: 'succeeded' },
      { name: 'sponsorship.maintenance', result: 'succeeded' },
    ]);
    expect(firstMessages).toEqual([
      SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
      SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
    ]);
    expect(messages).toEqual(firstMessages);
    expect(firstIds).toEqual(
      [
        STARTS_TODAY,
        ENDED_UNSETTLED,
        ENDED_SETTLED,
        UNPAID_STARTS_TODAY,
        UNPAID_FUTURE,
      ].map(sponsorshipIdOf),
    );
    expect(firstNotices).toMatchObject([
      { startNotice: 'pending' },
      { endNotice: 'none', stopRefundStatus: 'none' },
      { endNotice: 'pending' },
    ]);
    expect(firstStops.map(({ endedAt }) => endedAt)).toEqual([
      RETENTION_CUTOFF,
      null,
    ]);
    expect(await readSponsorshipIds()).toEqual(firstIds);
    expect(await noticeStates()).toEqual(firstNotices);
    expect(await readDisplayStopRows()).toEqual(firstStops);
    expect(await db.select().from(paymentRefunds)).toEqual([]);
  });

  test('未精算の終了した広告と依頼待ちの通知が無ければ、精算も送信も依頼しない', async () => {
    await insertSponsorUser(OWNER);
    await insertSponsorProduct({ index: PRODUCT, owner: OWNER });
    await insertSponsorships([
      {
        index: ENDED_SETTLED,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(ENDED_SETTLED, {
          startsOn: '2026-11-11',
          endsOn: '2026-11-17',
          startNotice: 'requested',
          endNotice: 'requested',
          stopRefundStatus: 'not_needed',
        }),
      },
    ]);
    const logs = recordConsole();
    const messages = recordSponsorshipMessages();

    await runScheduled(MAINTENANCE_TIME);

    expect(sponsorshipJobResults(logs)).toEqual([
      { name: 'sponsorship.maintenance', result: 'succeeded' },
    ]);
    expect(messages).toEqual([]);
  });

  test('メッセージの送信の失敗ではジョブが失敗して定期実行の規約で記録され、次の実行で依頼し直す', async () => {
    await insertScenario();
    const logs = recordConsole();
    recordSponsorshipMessages(new Error('Queuesの障害を模した失敗'));

    await runScheduled(MAINTENANCE_TIME);

    expect(sponsorshipJobResults(logs)).toEqual([
      { name: 'sponsorship.maintenance', result: 'failed' },
    ]);
    expect(jobFailuresOf(logs)).toContain('sponsorship.maintenance');
    expect(await readSponsorshipRow(UNPAID_PAST_START)).toBeUndefined();

    vi.restoreAllMocks();
    recordConsole();
    const messages = recordSponsorshipMessages();
    await runScheduled(MAINTENANCE_TIME);

    expect(messages).toEqual([
      SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
      SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
    ]);
  });
});
