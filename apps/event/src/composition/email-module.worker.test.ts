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
import { EMAIL_SEND_RETRY_POLICY } from '../../lib/core/email/delivery-decision.ts';
import {
  BOUNCED_EVENT_SAMPLE,
  SAMPLE_EVENT_TIMESTAMP,
  SAMPLE_RECIPIENT,
} from '../../lib/core/email/delivery-event.fixtures.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from '../../lib/core/email/kinds/email-delivery-smoke.ts';
import { EMAIL_SEND_MESSAGE } from '../../lib/core/email/send-message.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { decideOnFailure } from '../../lib/core/messaging/retry-policy.ts';
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
