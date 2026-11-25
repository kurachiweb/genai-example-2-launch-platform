import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { EMAIL_SEND_MESSAGE } from '../../lib/core/email/send-message.ts';
import { SPONSORSHIP_DISPATCH_NOTICES_MESSAGE } from '../../lib/core/messaging/contracts/sponsorship.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { emailOf } from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import {
  recordSponsorshipLogs,
  resetSponsorshipObservability,
} from '../../lib/workers/sponsorship/testing/observability-recording.ts';
import {
  clearSponsorshipTables,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  readSponsorshipRow,
  terminatedColumnsOf,
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

const OWNER = 1;

const WITHDRAWN_OWNER = 2;

const PRODUCT = 1;

const HIDDEN_PRODUCT = 2;

const WITHDRAWN_PRODUCT = 3;

const PRODUCT_NAME = 'プロダクト1';

const TERMINATION_REASON = '掲載の基準に合わない表現を含むため';

const ENVELOPE_PREFIX = '01JD0SPDSP';

interface Round {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly sent: readonly QueueEnvelope[];
}

interface MailpitRequest {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

interface EmailSendBodyShape {
  readonly kind: string;
  readonly to: string;
}

let envelopeCount = 0;

function dispatchEnvelope(): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type,
    id: `${ENVELOPE_PREFIX}${String(envelopeCount).padStart(16, '0')}`,
    sentAt: NOW.toISOString(),
    body: { requestedAt: NOW.toISOString() },
  };
}

function isEnvelopeOf(type: string, sent: unknown): sent is QueueEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === type
  );
}

// 本番と同じQueueのconsumer・メッセージの処理の一覧・モジュールの一覧で1件を処理し、Queueへ送られた封筒を記録する
async function deliver(envelope: QueueEnvelope): Promise<Round> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: NOW, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  // メールの送信要求と続きの再送が後のテストの途中で届かないよう、実際には送らない
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

function emailEnvelopesOf(round: Round): QueueEnvelope[] {
  return round.sent.filter((sent) =>
    isEnvelopeOf(EMAIL_SEND_MESSAGE.type, sent),
  );
}

function stubMailpit(): MailpitRequest[] {
  const requests: MailpitRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
    const body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    ) as {
      readonly To?: readonly { readonly Email: string }[];
      readonly Subject?: string;
      readonly Text?: string;
    };
    requests.push({
      to: body.To?.[0]?.Email ?? '',
      subject: body.Subject ?? '',
      text: body.Text ?? '',
    });
    return Promise.resolve(Response.json({ ID: 'mailpit-message-id' }));
  });
  return requests;
}

// 送信要求の封筒をメール送信の処理へ渡し、Mailpitの送信APIへの要求を記録する
async function deliverToMailpit(
  envelopes: readonly QueueEnvelope[],
): Promise<MailpitRequest[]> {
  const requests = stubMailpit();
  for (const envelope of envelopes) {
    const round = await deliver(envelope);
    expect(round).toMatchObject({ acked: true, retried: false });
  }
  return requests;
}

// 基準時刻の2026-11-25の0:00に、当日開始・前日終了・強制終了の3つの通知が依頼待ちの広告
async function seedPendingNotices(): Promise<void> {
  await insertSponsorships([
    {
      index: 1,
      owner: OWNER,
      product: PRODUCT,
      columns: paidColumnsOf(1, {
        startsOn: '2026-11-25',
        endsOn: '2026-12-01',
        days: 7,
        startNotice: 'pending',
      }),
    },
    {
      index: 2,
      owner: OWNER,
      product: PRODUCT,
      columns: paidColumnsOf(2, {
        startsOn: '2026-11-18',
        endsOn: '2026-11-24',
        days: 7,
        startNotice: 'requested',
        endNotice: 'pending',
        stopRefundStatus: 'requested',
        stopRefundDays: 2,
        stopRefundAmount: 2_000,
        stopRefundRequestId: 'sponsorship-stop-refund-2',
      }),
    },
    {
      index: 3,
      owner: OWNER,
      product: PRODUCT,
      columns: terminatedColumnsOf(3, {
        startsOn: '2026-11-22',
        endsOn: '2026-11-28',
        days: 7,
        terminatedAt: NOW,
        terminationReason: TERMINATION_REASON,
        terminationNotice: 'pending',
        terminationRefundStatus: 'requested',
        terminationRefundDays: 4,
        terminationRefundAmount: null,
        terminationRefundRequestId: 'sponsorship-termination-refund-3',
        stopRefundStatus: 'already_refunded',
        stopRefundDays: 1,
        stopRefundAmount: 1_000,
      }),
    },
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // 本番のQueueの経路は処理の時刻をシステムの時計から読むため、業務日付2026-11-25の0:00に固定する
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  await insertSponsorUser(WITHDRAWN_OWNER, 'withdrawn');
  await insertSponsorProduct({ index: PRODUCT, owner: OWNER });
  await insertSponsorProduct({
    index: HIDDEN_PRODUCT,
    owner: OWNER,
    state: 'hidden',
  });
  await insertSponsorProduct({
    index: WITHDRAWN_PRODUCT,
    owner: WITHDRAWN_OWNER,
  });
});

afterEach(() => {
  resetSponsorshipObservability();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sponsorship.dispatch-noticesのQueueの処理', () => {
  test('開始・終了・強制終了の通知を1回ずつ送信要求にし、返金の金額を含むメールがMailpitに届く', async () => {
    await seedPendingNotices();

    const round = await deliver(dispatchEnvelope());

    expect(round).toMatchObject({ acked: true, retried: false });
    const emails = emailEnvelopesOf(round);
    expect(
      emails
        .map(({ body }) => {
          const { kind, to } = body as EmailSendBodyShape;
          return [kind, to];
        })
        .toSorted(),
    ).toStrictEqual(
      [
        ['sponsorship.start-notice', emailOf(OWNER)],
        ['sponsorship.end-notice', emailOf(OWNER)],
        ['sponsorship.termination-notice', emailOf(OWNER)],
      ].toSorted(),
    );
    expect(await readSponsorshipRow(1)).toMatchObject({
      startNotice: 'requested',
    });
    expect(await readSponsorshipRow(2)).toMatchObject({
      endNotice: 'requested',
    });
    expect(await readSponsorshipRow(3)).toMatchObject({
      terminationNotice: 'requested',
    });

    const delivered = await deliverToMailpit(emails);

    const bySubject = new Map(
      delivered.map((request) => [request.subject, request] as const),
    );
    expect([...bySubject.keys()].toSorted()).toStrictEqual(
      [
        `${PRODUCT_NAME}のスポンサー広告掲載が始まりました`,
        `${PRODUCT_NAME}のスポンサー広告掲載期間が終了しました`,
        `${PRODUCT_NAME}のスポンサー広告掲載を終了しました`,
      ].toSorted(),
    );
    for (const request of delivered) {
      expect(request.to).toBe(emailOf(OWNER));
    }
    const start = bySubject.get(
      `${PRODUCT_NAME}のスポンサー広告掲載が始まりました`,
    );
    expect(start?.text).toContain(
      '掲載期間: 2026年11月25日〜12月1日(UTC-08:00の日付)、7日間',
    );
    const end = bySubject.get(
      `${PRODUCT_NAME}のスポンサー広告掲載期間が終了しました`,
    );
    expect(end?.text).toContain('表示を止めた2日分: $20.00');
    const termination = bySubject.get(
      `${PRODUCT_NAME}のスポンサー広告掲載を終了しました`,
    );
    expect(termination?.text).toContain('強制終了日: 2026年11月25日');
    expect(termination?.text).toContain(`理由: ${TERMINATION_REASON}`);
    expect(termination?.text).toContain('未掲載の4日分: 残りの全額');
    expect(termination?.text).not.toContain('表示を止めた');
  });

  test('同じ依頼が再び届いても、送った通知を2回送らない', async () => {
    await seedPendingNotices();
    await deliver(dispatchEnvelope());

    const second = await deliver(dispatchEnvelope());

    expect(second).toMatchObject({ acked: true, retried: false });
    expect(emailEnvelopesOf(second)).toStrictEqual([]);
  });

  test('送信の時点で条件に合わない通知は送らないと記録し、依頼待ちを残さない', async () => {
    await insertSponsorships([
      {
        index: 4,
        owner: OWNER,
        product: HIDDEN_PRODUCT,
        columns: paidColumnsOf(4, {
          startsOn: '2026-11-25',
          endsOn: '2026-11-25',
          days: 1,
          startNotice: 'pending',
        }),
      },
      {
        index: 5,
        owner: WITHDRAWN_OWNER,
        product: WITHDRAWN_PRODUCT,
        columns: paidColumnsOf(5, {
          startsOn: '2026-11-18',
          endsOn: '2026-11-24',
          days: 7,
          endNotice: 'pending',
          stopRefundStatus: 'not_needed',
          deletedAt: NOW,
        }),
      },
      {
        index: 6,
        owner: OWNER,
        product: PRODUCT,
        columns: paidColumnsOf(6, {
          startsOn: '2026-11-18',
          endsOn: '2026-11-24',
          days: 7,
          endNotice: 'pending',
          stopRefundStatus: 'not_needed',
          productDeletedAt: NOW,
        }),
      },
    ]);

    const round = await deliver(dispatchEnvelope());

    expect(round).toMatchObject({ acked: true, retried: false });
    expect(emailEnvelopesOf(round)).toStrictEqual([]);
    expect((await readSponsorshipRow(4))?.startNotice).toBe('skipped');
    expect((await readSponsorshipRow(5))?.endNotice).toBe('skipped');
    expect((await readSponsorshipRow(6))?.endNotice).toBe('skipped');
  });

  test('ログに名称・メールアドレス・強制終了の理由を含めず、申込のIDと通知の種類と件数を記録する', async () => {
    await seedPendingNotices();
    const logs = recordSponsorshipLogs('event');

    const round = await deliver(dispatchEnvelope());
    await deliverToMailpit(emailEnvelopesOf(round));

    const serialized = JSON.stringify(logs);
    expect(
      logs.filter(({ category }) => category === 'event.sponsorship'),
    ).toMatchObject([
      {
        message: 'スポンサー広告の通知を処理しました',
        sent: 3,
        skipped: 0,
        taken: 0,
        more: false,
      },
    ]);
    for (const secret of [PRODUCT_NAME, emailOf(OWNER), TERMINATION_REASON]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
