import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import type { EmailIncident } from '../../application/email/ports.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../../../lib/workers/observability/sentry.ts';
import { SentryEmailIncidentReporter } from './sentry-email-incident-reporter.ts';

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const REQUEST_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';
const RECIPIENT = 'user@recipient.example';
const SUBJECT = 'テスト用の件名';
const LINK_URL = 'https://launch.example/products/1?token=secret-value';

function decodeBody(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new TypeError('想定外の送信本文の形式です');
}

// エンベロープは改行区切りのJSONで、先頭のヘッダーの後に項目のヘッダーと本体が交互に並ぶ
function parseSentryEnvelope(text: string): SentItem[] {
  const [, ...lines] = text.split('\n').filter((line) => line !== '');
  const items: SentItem[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? '') as { type: string };
    const payload = JSON.parse(lines[index + 1] ?? '') as Record<
      string,
      unknown
    >;
    items.push({ type: header.type, payload });
  }
  return items;
}

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で通知する
async function reportWithSentry(
  incidents: readonly EmailIncident[],
): Promise<Record<string, unknown>[]> {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseSentryEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const reporter = new SentryEmailIncidentReporter();
  const handler = withSentryForScheduledAndQueue<Env>(
    (): CloudflareOptions => ({
      ...buildSentryOptions({
        dsn: TEST_DSN,
        environment: 'test',
        tracesSampleRate: 0,
      }),
      cacheClient: false,
      transportOptions: { fetch: recordingFetch as typeof fetch },
    }),
    {
      scheduled: () => {
        for (const incident of incidents) {
          reporter.report(incident);
        }
      },
    },
  );
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

async function reportOne(
  incident: EmailIncident,
): Promise<Record<string, unknown>> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

describe('SentryEmailIncidentReporter(送信不能)', () => {
  test('errorで、異常の種類・種別・分類・コード・送信要求の識別子のタグと、種類とコードの指紋を付けて送る', async () => {
    const event = await reportOne({
      kind: 'undeliverable',
      emailKind: 'email-delivery.smoke',
      category: 'transactional',
      requestId: REQUEST_ID,
      code: 'E_SENDER_NOT_VERIFIED',
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: 'メールを送信できませんでした' },
      fingerprint: ['email', 'undeliverable', 'E_SENDER_NOT_VERIFIED'],
    });
    expect(event.tags).toStrictEqual({
      email_incident: 'undeliverable',
      email_kind: 'email-delivery.smoke',
      email_category: 'transactional',
      email_code: 'E_SENDER_NOT_VERIFIED',
      correlation_id: REQUEST_ID,
    });
  });

  test('分類が決まらない未登録の種別では、分類のタグを付けない', async () => {
    const event = await reportOne({
      kind: 'undeliverable',
      emailKind: 'retired.weekly-digest',
      category: undefined,
      requestId: REQUEST_ID,
      code: 'unknown-kind',
    });

    expect(event.tags).toStrictEqual({
      email_incident: 'undeliverable',
      email_kind: 'retired.weekly-digest',
      email_code: 'unknown-kind',
      correlation_id: REQUEST_ID,
    });
    expect(event.fingerprint).toStrictEqual([
      'email',
      'undeliverable',
      'unknown-kind',
    ]);
  });

  test('同じ送信不能が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: EmailIncident = {
      kind: 'undeliverable',
      emailKind: 'email-delivery.smoke',
      category: 'transactional',
      requestId: REQUEST_ID,
      code: 'render-failed',
    };

    const events = await reportWithSentry([incident, incident]);

    expect(events.map(({ fingerprint }) => fingerprint)).toStrictEqual([
      ['email', 'undeliverable', 'render-failed'],
      ['email', 'undeliverable', 'render-failed'],
    ]);
  });
});

describe('SentryEmailIncidentReporter(日次上限)', () => {
  test('warningで、異常の種類のタグと、上限到達を1つの問題にまとめる指紋を付けて送る', async () => {
    const event = await reportOne({ kind: 'daily-limit' });

    expect(event).toMatchObject({
      level: 'warning',
      logentry: { message: 'メールの日次の送信上限に達しました' },
      fingerprint: ['email', 'daily-limit'],
    });
    expect(event.tags).toStrictEqual({ email_incident: 'daily-limit' });
  });
});

describe('SentryEmailIncidentReporter(配信不能イベント)', () => {
  test.each([
    {
      kind: 'sender-side-rejection',
      reason: 'policy:rejected',
      message: '送信側の理由でメールが拒否されました',
    },
    {
      kind: 'delivery-failed',
      reason: 'internal_error',
      message: '受け付け後のメールの配送に失敗しました',
    },
  ] as const)(
    '$kindはerrorで、異常の種類と理由のタグと、種類と理由の指紋を付けて送る',
    async ({ kind, reason, message }) => {
      const event = await reportOne({ kind, reason });

      expect(event).toMatchObject({
        level: 'error',
        logentry: { message },
        fingerprint: ['email', kind, reason],
      });
      expect(event.tags).toStrictEqual({
        email_incident: kind,
        email_code: reason,
      });
    },
  );

  test('不正なイベントはerrorで、イベントの種類をコードのタグと指紋に入れて送る', async () => {
    const event = await reportOne({
      kind: 'invalid-delivery-event',
      type: 'cf.email.sending.message.delayed',
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: '不正な配信不能イベントを受け取りました' },
      fingerprint: [
        'email',
        'invalid-delivery-event',
        'cf.email.sending.message.delayed',
      ],
    });
    expect(event.tags).toStrictEqual({
      email_incident: 'invalid-delivery-event',
      email_code: 'cf.email.sending.message.delayed',
    });
  });

  test('イベントの種類が無ければ、欠けていることを表すコードで送る', async () => {
    const event = await reportOne({
      kind: 'invalid-delivery-event',
      type: undefined,
    });

    expect(event.tags).toMatchObject({ email_code: 'missing' });
    expect(event.fingerprint).toStrictEqual([
      'email',
      'invalid-delivery-event',
      'missing',
    ]);
  });

  test('長いイベントの種類は、Sentryのタグの値の上限より短い64文字に切り詰める', async () => {
    const longType = `cf.email.sending.message.${'x'.repeat(300)}`;

    const event = await reportOne({
      kind: 'invalid-delivery-event',
      type: longType,
    });

    const expected = longType.slice(0, 64);
    expect(event.tags).toMatchObject({ email_code: expected });
    expect(event.fingerprint).toStrictEqual([
      'email',
      'invalid-delivery-event',
      expected,
    ]);
  });
});

describe('SentryEmailIncidentReporter(個人情報)', () => {
  test('識別子に使わない文字を含む値は置き換え、宛先・件名・URLを送らない', async () => {
    const events = await reportWithSentry([
      {
        kind: 'undeliverable',
        emailKind: RECIPIENT,
        category: 'notification',
        requestId: `${SUBJECT} ${RECIPIENT}`,
        code: LINK_URL,
      },
      { kind: 'sender-side-rejection', reason: `${SUBJECT}\n${RECIPIENT}` },
      { kind: 'invalid-delivery-event', type: `${LINK_URL} ${RECIPIENT}` },
    ]);

    expect(events).toHaveLength(3);
    expect(events.map(({ tags }) => tags)).toStrictEqual([
      {
        email_incident: 'undeliverable',
        email_kind: 'unknown',
        email_category: 'notification',
        email_code: 'unknown',
        correlation_id: 'unknown',
      },
      { email_incident: 'sender-side-rejection', email_code: 'unknown' },
      { email_incident: 'invalid-delivery-event', email_code: 'unknown' },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(RECIPIENT);
    expect(serialized).not.toContain('recipient.example');
    expect(serialized).not.toContain(SUBJECT);
    expect(serialized).not.toContain('launch.example');
    expect(serialized).not.toContain('secret-value');
  });
});
