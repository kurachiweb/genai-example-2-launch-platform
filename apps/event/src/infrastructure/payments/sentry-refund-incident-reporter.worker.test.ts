import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../../../lib/workers/observability/sentry.ts';
import type { RefundIncident } from '../../application/payments/refund-incidents.ts';
import { SentryRefundIncidentReporter } from './sentry-refund-incident-reporter.ts';

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const REFUND_REQUEST_ID = '01JC0RF0000000000000000001';
const EMAIL = 'taro.yamada@mail.example';

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
  incidents: readonly RefundIncident[],
): Promise<Record<string, unknown>[]> {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseSentryEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const reporter = new SentryRefundIncidentReporter();
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
  incident: RefundIncident,
): Promise<Record<string, unknown>> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

describe('SentryRefundIncidentReporter(Stripeの恒久的な拒否)', () => {
  test('errorで、定型の文言と、種類・操作・拒否のコードの指紋と、メッセージの種別・拒否のコードのタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'stripe-rejected',
      refundRequestId: REFUND_REQUEST_ID,
      operation: 'create_refund',
      stripeErrorCode: 'charge_already_refunded',
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: 'Stripeが返金の処理を拒否しました' },
      fingerprint: [
        'payments',
        'stripe-rejected',
        'create_refund',
        'charge_already_refunded',
      ],
    });
    expect(event).not.toHaveProperty('message');
    expect(event.tags).toStrictEqual({
      message_type: 'payments.refund-payment',
      payments_incident: 'stripe-rejected',
      refund_request_id: REFUND_REQUEST_ID,
      stripe_operation: 'create_refund',
      stripe_error_code: 'charge_already_refunded',
    });
  });

  test('同じ拒否が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: RefundIncident = {
      kind: 'stripe-rejected',
      refundRequestId: REFUND_REQUEST_ID,
      operation: 'cancel_subscription',
      stripeErrorCode: 'resource_missing',
    };

    const events = await reportWithSentry([incident, incident]);

    expect(events).toHaveLength(2);
  });
});

describe('SentryRefundIncidentReporter(支払いのIDが無い依頼)', () => {
  test('errorで、定型の文言と種類の指紋と、メッセージの種別・依頼のIDのタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'missing-payment-intent',
      refundRequestId: REFUND_REQUEST_ID,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: '返金に要る支払いの識別子が無い返金の依頼があります',
      },
      fingerprint: ['payments', 'missing-payment-intent'],
    });
    expect(event.tags).toStrictEqual({
      message_type: 'payments.refund-payment',
      payments_incident: 'missing-payment-intent',
      refund_request_id: REFUND_REQUEST_ID,
    });
  });
});

describe('SentryRefundIncidentReporter(Stripe上で既に失敗していた返金)', () => {
  test('errorで、定型の文言と種類の指紋と、依頼のID・Stripeの返金ID・失敗のコードのタグを付けて送り、形でない値は置き換える', async () => {
    const event = await reportOne({
      kind: 'stripe-refund-failed',
      refundRequestId: REFUND_REQUEST_ID,
      stripeRefundId: 're_test_existing',
      failureCode: 'expired_or_canceled_card',
    });
    const unsafe = await reportOne({
      kind: 'stripe-refund-failed',
      refundRequestId: REFUND_REQUEST_ID,
      stripeRefundId: EMAIL,
      failureCode: null,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: '作成済みの返金がStripe上で失敗していました' },
      fingerprint: ['payments', 'stripe-refund-failed'],
    });
    expect(event.tags).toStrictEqual({
      message_type: 'payments.refund-payment',
      payments_incident: 'stripe-refund-failed',
      refund_request_id: REFUND_REQUEST_ID,
      stripe_refund_id: 're_test_existing',
      failure_code: 'expired_or_canceled_card',
    });
    expect(unsafe.tags).toMatchObject({
      stripe_refund_id: 'unknown',
      failure_code: 'unknown',
    });
    expect(JSON.stringify(unsafe)).not.toContain(EMAIL);
  });
});

describe('SentryRefundIncidentReporter(送る値)', () => {
  test('識別子と拒否のコードの形でない値はタグと指紋に入れず置き換える', async () => {
    const event = await reportOne({
      kind: 'stripe-rejected',
      refundRequestId: EMAIL,
      operation: 'create_refund',
      stripeErrorCode: `card ${EMAIL}`,
    });

    expect(event.tags).toMatchObject({
      refund_request_id: 'unknown',
      stripe_error_code: 'unknown',
    });
    expect(event.fingerprint).toStrictEqual([
      'payments',
      'stripe-rejected',
      'create_refund',
      'unknown',
    ]);
    expect(JSON.stringify(event)).not.toContain(EMAIL);
  });
});
