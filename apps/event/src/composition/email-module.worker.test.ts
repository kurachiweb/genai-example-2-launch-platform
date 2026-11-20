import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { createDatabase } from '../../db/client.ts';
import { emailSendRecords } from '../../db/schema/email/email-send-records.ts';
import { emailSuppressions } from '../../db/schema/email/email-suppressions.ts';
import { notificationSenderSettings } from '../../db/schema/notifications/notification-sender-settings.ts';
import { EMAIL_SEND_RETRY_POLICY } from '../../lib/core/email/delivery-decision.ts';
import {
  BOUNCED_EVENT_SAMPLE,
  SAMPLE_EVENT_TIMESTAMP,
  SAMPLE_RECIPIENT,
} from '../../lib/core/email/delivery-event.fixtures.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from '../../lib/core/email/kinds/email-delivery-smoke.ts';
import {
  NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
  NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
  NOTIFICATION_MATCH_PREVIEW_KIND,
  NOTIFICATION_MATCH_RESULT_KIND,
} from '../../lib/core/email/kinds/notifications.ts';
import { EMAIL_SEND_MESSAGE } from '../../lib/core/email/send-message.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { decideOnFailure } from '../../lib/core/messaging/retry-policy.ts';
import {
  restoreSenderInfoSeed,
  SENDER_INFO_SEED_ROW,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import worker from '../index.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.22.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

interface TestMessage {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
}

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly delaySeconds?: number;
}

interface MailpitRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: Record<string, unknown>;
}

const MESSAGE_TIMESTAMP = new Date('2026-10-27T03:04:05.678Z');
const REQUESTED_AT = '2026-10-27T01:02:03.000Z';
const RECIPIENT_MARKER = 'recipient-marker';

let sequence = 0;

function nextUlid(): string {
  sequence += 1;
  return `01HZX3Y7Q2M4N5P6R7S8T9V${String(sequence).padStart(3, '0')}`;
}

function smokeEnvelope(id: string, to: string): QueueEnvelope {
  return {
    v: 1,
    type: EMAIL_SEND_MESSAGE.type,
    id,
    sentAt: '2026-10-27T01:02:04.000Z',
    body: {
      kind: EMAIL_DELIVERY_SMOKE_KIND.name,
      to,
      input: { requestedAt: REQUESTED_AT },
    },
  };
}

async function runQueue(
  batch: MessageBatch,
  ctx: ExecutionContext,
): Promise<void> {
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  await queue(batch, env, ctx);
}

// 0.22.0のretry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる
async function dispatch(
  queueName: string,
  messages: readonly TestMessage[],
): Promise<readonly MessageOutcome[]> {
  const batch = createMessageBatch(
    queueName,
    messages.map(({ id, body, attempts }) => ({
      id,
      timestamp: MESSAGE_TIMESTAMP,
      attempts,
      body,
    })),
  );
  const retrySpies = batch.messages.map((message) =>
    vi.spyOn(message, 'retry'),
  );
  const ctx = createExecutionContext();
  await runQueue(batch, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  return batch.messages.map(({ id }, index) => {
    const retried = retryMessages.some(({ msgId }) => msgId === id);
    const delaySeconds =
      retrySpies[index]?.mock.calls.at(-1)?.[0]?.delaySeconds;
    return {
      acked: explicitAcks.includes(id),
      retried,
      ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
    };
  });
}

function stubMailpit(response: () => Response): MailpitRequest[] {
  const requests: MailpitRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method,
      body: JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as Record<string, unknown>,
    });
    return Promise.resolve(response());
  });
  return requests;
}

function mailpitAccepted(): Response {
  return Response.json({ ID: 'mailpit-message-id' });
}

function silenceConsole(): readonly unknown[][] {
  const calls: unknown[][] = [];
  const record = (...args: unknown[]): void => {
    calls.push(args);
  };
  for (const method of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return calls;
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const db = createDatabase(env.DB);

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

let consoleCalls: readonly unknown[][];

beforeEach(() => {
  consoleCalls = silenceConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('イベントサーバーのメールの結線', () => {
  test('email.sendのバッチから、日本語の件名と両パートをMailpitの宛先へ送り、送信済みとして記録する', async () => {
    const id = nextUlid();
    const recipient = `${RECIPIENT_MARKER}-sent@test.example`;
    const requests = stubMailpit(mailpitAccepted);

    const outcomes = await dispatch(env.JOBS_QUEUE_NAME, [
      { id, body: smokeEnvelope(id, recipient), attempts: 1 },
    ]);

    expect(outcomes).toStrictEqual([{ acked: true, retried: false }]);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe('http://mailpit.example/api/v1/send');
    expect(request?.method).toBe('POST');
    expect(request?.body).toMatchObject({
      From: { Email: 'noreply@test.example', Name: 'Launch Stadium' },
      To: [{ Email: recipient }],
      Subject: 'メール送信の確認',
    });
    expect(request?.body).not.toHaveProperty('ReplyTo');
    expect(request?.body['HTML']).toContain('lang="ja"');
    expect(request?.body['HTML']).toContain('メール送信の確認のために');
    expect(request?.body['Text']).toContain('メール送信の確認のために');
    expect(request?.body['Text']).toContain('10月27日01:02(UTC)');
    const records = await db
      .select()
      .from(emailSendRecords)
      .where(eq(emailSendRecords.id, id));
    expect(records).toMatchObject([
      { id, kind: EMAIL_DELIVERY_SMOKE_KIND.name },
    ]);
    expect(JSON.stringify(consoleCalls)).not.toContain(RECIPIENT_MARKER);
  });

  test('同じ種別で同じ冪等のキーの送信要求は、別の封筒で届いても2回目を送らずに完了する', async () => {
    const firstId = nextUlid();
    const secondId = nextUlid();
    const idempotencyKey = `01JQ0ACT0000000000000${String(sequence).padStart(5, '0')}`;
    const recipient = `${RECIPIENT_MARKER}-idempotent@test.example`;
    const requests = stubMailpit(mailpitAccepted);
    const keyed = (id: string): QueueEnvelope => {
      const envelope = smokeEnvelope(id, recipient);
      return {
        ...envelope,
        body: { ...(envelope.body as object), idempotencyKey },
      };
    };

    const first = await dispatch(env.JOBS_QUEUE_NAME, [
      { id: firstId, body: keyed(firstId), attempts: 1 },
    ]);
    const second = await dispatch(env.JOBS_QUEUE_NAME, [
      { id: secondId, body: keyed(secondId), attempts: 1 },
    ]);

    expect(first).toStrictEqual([{ acked: true, retried: false }]);
    expect(second).toStrictEqual([{ acked: true, retried: false }]);
    expect(requests).toHaveLength(1);
    const records = await db
      .select()
      .from(emailSendRecords)
      .where(eq(emailSendRecords.idempotencyKey, idempotencyKey));
    expect(records).toMatchObject([
      { id: firstId, kind: EMAIL_DELIVERY_SMOKE_KIND.name, idempotencyKey },
    ]);
  });

  test('冪等のキーを持たない送信要求は、別の封筒なら同じ内容でもそれぞれ送る', async () => {
    const firstId = nextUlid();
    const secondId = nextUlid();
    const recipient = `${RECIPIENT_MARKER}-keyless@test.example`;
    const requests = stubMailpit(mailpitAccepted);

    await dispatch(env.JOBS_QUEUE_NAME, [
      { id: firstId, body: smokeEnvelope(firstId, recipient), attempts: 1 },
    ]);
    await dispatch(env.JOBS_QUEUE_NAME, [
      { id: secondId, body: smokeEnvelope(secondId, recipient), attempts: 1 },
    ]);

    expect(requests).toHaveLength(2);
  });

  test('Mailpitの一時的な障害では、メール送信の再試行の方針の間隔でQueuesの再試行に任せる', async () => {
    const id = nextUlid();
    stubMailpit(() => new Response(null, { status: 503 }));
    const expected = decideOnFailure(EMAIL_SEND_RETRY_POLICY, 1);
    if (expected.kind !== 'retry') {
      throw new Error('1回目の失敗は再試行になるはず');
    }

    const outcomes = await dispatch(env.JOBS_QUEUE_NAME, [
      {
        id,
        body: smokeEnvelope(id, `${RECIPIENT_MARKER}-retry@test.example`),
        attempts: 1,
      },
    ]);

    expect(outcomes).toStrictEqual([
      { acked: false, retried: true, delaySeconds: expected.delaySeconds },
    ]);
    expect(expected.delaySeconds).toBe(
      EMAIL_SEND_RETRY_POLICY.baseDelaySeconds,
    );
  });

  test('メールイベント用Queueのhard bounceを期限なしの抑止として記録し、同じバッチの再送で内容を変えない', async () => {
    const message = {
      id: 'email-event-hard-bounce',
      body: BOUNCED_EVENT_SAMPLE,
    };

    const first = await dispatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      { ...message, attempts: 1 },
    ]);
    const afterFirst = await db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.address, SAMPLE_RECIPIENT));
    const second = await dispatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      { ...message, attempts: 2 },
    ]);
    const afterSecond = await db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.address, SAMPLE_RECIPIENT));

    expect(first).toStrictEqual([{ acked: true, retried: false }]);
    expect(second).toStrictEqual([{ acked: true, retried: false }]);
    expect(afterFirst).toMatchObject([
      {
        address: SAMPLE_RECIPIENT,
        lastReason: 'hard_bounce',
        lastEventAt: SAMPLE_EVENT_TIMESTAMP,
        expiresAt: null,
      },
    ]);
    const stable = (rows: typeof afterFirst) =>
      rows.map(
        ({ id, address, lastReason, lastEventAt, expiresAt, createdAt }) => ({
          id,
          address,
          lastReason,
          lastEventAt,
          expiresAt,
          createdAt,
        }),
      );
    expect(stable(afterSecond)).toStrictEqual(stable(afterFirst));
  });
});

describe('イベントサーバーのメールへの送信者情報の表示', () => {
  const SENDER_INFO = {
    businessName: 'ローンチ運営事務局',
    contactEmail: 'support@launch.example',
    postalAddress: '東京都千代田区1-1-1',
  } as const;

  const UPDATED_SENDER_INFO = {
    businessName: 'ローンチ運営事務局(新)',
    contactEmail: 'help@launch.example',
    postalAddress: '大阪府大阪市北区2-2-2',
  } as const;

  const NOTICE_LINKS = {
    settingsUrl: 'https://client.example/settings/notifications',
    unsubscribeUrl: 'https://client.example/unsubscribe#token=0123456789abcdef',
  } as const;

  const SENDER_INFO_VALUES = [
    ...Object.values(SENDER_INFO),
    ...Object.values(UPDATED_SENDER_INFO),
  ];

  const MAIL_CASES = [
    {
      label: '疎通確認',
      body: (to: string) => ({
        kind: EMAIL_DELIVERY_SMOKE_KIND.name,
        to,
        input: { requestedAt: REQUESTED_AT },
      }),
    },
    {
      label: 'メールアドレスの確認',
      body: (to: string) => ({
        kind: 'identity.email-verification',
        to,
        input: {
          nickname: '山田',
          verifyUrl: 'https://client.example/verify-email#token=abc',
          expiresAt: REQUESTED_AT,
        },
      }),
    },
    {
      label: 'マッチ開始予告の通知',
      body: (to: string) => ({
        kind: NOTIFICATION_MATCH_PREVIEW_KIND.name,
        to,
        input: {
          ...NOTICE_LINKS,
          nickname: '山田',
          ownProductName: 'Pitch Notes',
          opponentProductName: 'Tactics Board',
          matchLabel: '予選',
          startsAt: REQUESTED_AT,
          endsAt: REQUESTED_AT,
          topPageUrl: 'https://client.example/',
        },
      }),
    },
    {
      label: '勝敗結果の通知',
      body: (to: string) => ({
        kind: NOTIFICATION_MATCH_RESULT_KIND.name,
        to,
        input: {
          ...NOTICE_LINKS,
          nickname: '山田',
          ownProductName: 'Pitch Notes',
          opponentProductName: 'Tactics Board',
          matchLabel: '予選',
          outcome: 'won',
          decidedByLastUpvote: false,
          ownVotes: 12,
          opponentVotes: 9,
          supplements: [],
          action: {
            label: '自分のプロダクトを見る',
            url: 'https://client.example/my/products',
          },
          next: null,
        },
      }),
    },
    {
      label: 'フォロー中の利用者のマッチの開催通知',
      body: (to: string) => ({
        kind: NOTIFICATION_FOLLOWED_USER_MATCHES_KIND.name,
        to,
        input: {
          ...NOTICE_LINKS,
          nickname: '山田',
          items: [
            {
              productName: 'Pitch Notes',
              makerNickname: '佐藤',
              matchLabel: '予選',
              opponentProductName: 'Tactics Board',
            },
          ],
          omittedCount: 0,
          topPageUrl: 'https://client.example/',
        },
      }),
    },
    {
      label: 'フォロー中の利用者の受賞結果の通知',
      body: (to: string) => ({
        kind: NOTIFICATION_FOLLOWED_USER_AWARD_KIND.name,
        to,
        input: {
          ...NOTICE_LINKS,
          nickname: '山田',
          productName: 'Pitch Notes',
          makerNickname: '佐藤',
          award: 'product_of_the_week',
          periodLabel: '2026年第37週(9/7〜9/13)',
          productUrl: 'https://client.example/p/pitch-notes',
        },
      }),
    },
  ] as const;

  async function saveSenderInfo(
    info: typeof SENDER_INFO | typeof UPDATED_SENDER_INFO,
    version: number,
  ): Promise<void> {
    await db
      .update(notificationSenderSettings)
      .set({ ...info, version })
      .where(eq(notificationSenderSettings.id, SENDER_INFO_SEED_ROW.id));
  }

  async function sendOne(
    body: (to: string) => Record<string, unknown>,
  ): Promise<MailpitRequest> {
    const id = nextUlid();
    const requests = stubMailpit(mailpitAccepted);
    const envelope: QueueEnvelope = {
      v: 1,
      type: EMAIL_SEND_MESSAGE.type,
      id,
      sentAt: '2026-10-27T01:02:04.000Z',
      body: body(`${RECIPIENT_MARKER}-sender-info-${id}@test.example`),
    };

    const outcomes = await dispatch(env.JOBS_QUEUE_NAME, [
      { id, body: envelope, attempts: 1 },
    ]);

    expect(outcomes).toStrictEqual([{ acked: true, retried: false }]);
    const [request] = requests;
    if (request === undefined) {
      throw new Error('Mailpitへの送信の要求が無い');
    }
    return request;
  }

  function partsOf(request: MailpitRequest): readonly string[] {
    return [String(request.body['HTML']), String(request.body['Text'])];
  }

  beforeEach(async () => {
    await restoreSenderInfoSeed();
  });

  afterEach(async () => {
    await restoreSenderInfoSeed();
  });

  test.each(MAIL_CASES)(
    '送信者情報が版0なら、$labelのメールに送信者情報の区画を置かない',
    async ({ body }) => {
      const request = await sendOne(body);

      for (const part of partsOf(request)) {
        for (const value of SENDER_INFO_VALUES) {
          expect(part).not.toContain(value);
        }
      }
    },
  );

  test.each(MAIL_CASES)(
    '送信者情報が設定済みなら、$labelのメールの両パートに3項目を載せる',
    async ({ body }) => {
      await saveSenderInfo(SENDER_INFO, 1);

      const request = await sendOne(body);

      for (const part of partsOf(request)) {
        for (const value of Object.values(SENDER_INFO)) {
          expect(part).toContain(value);
        }
      }
    },
  );

  test('送信者情報を保存し直すと、直後のメールから新しい値を載せる', async () => {
    const [smoke] = MAIL_CASES;
    await saveSenderInfo(SENDER_INFO, 1);
    const before = await sendOne(smoke.body);

    await saveSenderInfo(UPDATED_SENDER_INFO, 2);
    const afterUpdate = await sendOne(smoke.body);

    expect(String(before.body['Text'])).toContain(SENDER_INFO.businessName);
    for (const part of partsOf(afterUpdate)) {
      for (const value of Object.values(UPDATED_SENDER_INFO)) {
        expect(part).toContain(value);
      }
      expect(part).not.toContain(SENDER_INFO.contactEmail);
    }
  });
});
