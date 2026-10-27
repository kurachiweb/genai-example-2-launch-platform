import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { EMAIL_DELIVERY_SMOKE_KIND } from '../../../lib/core/email/kinds/email-delivery-smoke.ts';
import { EMAIL_SEND_MESSAGE } from '../../../lib/core/email/send-message.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import worker from '../../index.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

interface SmokeSecrets {
  readonly EMAIL_SMOKE_TOKEN?: string;
  readonly EMAIL_SMOKE_RECIPIENT?: string;
}

interface SmokeRequestOptions {
  readonly method?: string;
  readonly authorization?: string;
  readonly body?: string;
}

const EVENT_ORIGIN = 'https://event.launch.example';
const SMOKE_PATH = '/internal/email/smoke';
// IP単位の制限の計数を他のテストファイルと分けるため、このファイルだけの接続元にする
const CLIENT_IP = '203.0.113.62';
const SMOKE_TOKEN = 'smoke-token-for-workers-integration-tests';
const SMOKE_RECIPIENT = 'smoke-recipient@test.example';
const CONFIGURED: SmokeSecrets = {
  EMAIL_SMOKE_TOKEN: SMOKE_TOKEN,
  EMAIL_SMOKE_RECIPIENT: SMOKE_RECIPIENT,
};

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

async function requestSmoke(
  secrets: SmokeSecrets,
  options: SmokeRequestOptions = {},
): Promise<{ readonly response: Response; readonly sent: QueueEnvelope[] }> {
  const { fetch } = worker;
  if (fetch === undefined) {
    throw new Error('イベントサーバーのエントリにfetchハンドラーが無い');
  }
  const { queue, sent } = createRecordingQueue();
  const headers = new Headers({ 'CF-Connecting-IP': CLIENT_IP });
  if (options.authorization !== undefined) {
    headers.set('Authorization', options.authorization);
  }
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const request = new Request<unknown, IncomingRequestCfProperties>(
    `${EVENT_ORIGIN}${SMOKE_PATH}`,
    {
      method: options.method ?? 'POST',
      headers,
      ...(options.body === undefined ? {} : { body: options.body }),
    },
  );
  const ctx = createExecutionContext();
  const response = await fetch(
    request,
    { ...env, ...secrets, JOBS_QUEUE: queue },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { response, sent };
}

const NOT_FOUND_BODY = {
  error: {
    code: 'not_found',
    message: 'お探しの内容は見つかりませんでした。',
  },
};

describe('疎通確認の経路 POST /internal/email/smoke', () => {
  test.each<{ readonly label: string; readonly secrets: SmokeSecrets }>([
    { label: 'トークンと宛先の両方が無い', secrets: {} },
    {
      label: 'トークンだけがある',
      secrets: { EMAIL_SMOKE_TOKEN: SMOKE_TOKEN },
    },
    {
      label: '宛先だけがある',
      secrets: { EMAIL_SMOKE_RECIPIENT: SMOKE_RECIPIENT },
    },
    {
      label: 'トークンが空',
      secrets: { ...CONFIGURED, EMAIL_SMOKE_TOKEN: '' },
    },
    {
      label: '宛先が空',
      secrets: { ...CONFIGURED, EMAIL_SMOKE_RECIPIENT: '' },
    },
  ])(
    '$labelの環境では、正しいトークンでも未登録の経路と同じ404を返して送らない',
    async ({ secrets }) => {
      const { response, sent } = await requestSmoke(secrets, {
        authorization: `Bearer ${SMOKE_TOKEN}`,
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toStrictEqual(NOT_FOUND_BODY);
      expect(sent).toEqual([]);
    },
  );

  test.each<{ readonly label: string; readonly authorization?: string }>([
    { label: 'Authorizationヘッダーが無い' },
    { label: '異なるトークン', authorization: `Bearer ${SMOKE_TOKEN}x` },
    {
      label: '長さが同じで内容が異なるトークン',
      authorization: `Bearer ${SMOKE_TOKEN.slice(0, -1)}X`,
    },
    { label: '短いトークン', authorization: 'Bearer s' },
    { label: 'トークンの無いBearer', authorization: 'Bearer ' },
    { label: 'Bearer以外の方式', authorization: `Basic ${SMOKE_TOKEN}` },
    { label: '方式の無いトークン', authorization: SMOKE_TOKEN },
  ])('$labelでは401を返して送らない', async ({ authorization }) => {
    const { response, sent } = await requestSmoke(CONFIGURED, {
      ...(authorization === undefined ? {} : { authorization }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({
      error: { code: 'unauthenticated', message: '認証されていません。' },
    });
    expect(sent).toEqual([]);
  });

  test('正しいトークンでは202と送信要求の識別子を返し、疎通確認の種別を宛先のシークレットへemail.sendとして送る', async () => {
    const before = Date.now();

    const { response, sent } = await requestSmoke(CONFIGURED, {
      authorization: `Bearer ${SMOKE_TOKEN}`,
    });

    const after = Date.now();
    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(sent).toHaveLength(1);
    const [envelope] = sent;
    expect(body).toStrictEqual({ requestId: envelope?.id });
    expect(envelope?.type).toBe(EMAIL_SEND_MESSAGE.type);
    const { input, ...rest } = EMAIL_SEND_MESSAGE.schema.parse(envelope?.body);
    expect(rest).toStrictEqual({
      kind: EMAIL_DELIVERY_SMOKE_KIND.name,
      to: SMOKE_RECIPIENT,
    });
    expect(Object.keys(input as object)).toEqual(['requestedAt']);
    const { requestedAt } = EMAIL_DELIVERY_SMOKE_KIND.inputSchema.parse(input);
    expect(requestedAt.endsWith('Z')).toBe(true);
    expect(Date.parse(requestedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(requestedAt)).toBeLessThanOrEqual(after);
  });

  test('方式の名前の大文字小文字を区別せずにトークンを受け付ける', async () => {
    const { response, sent } = await requestSmoke(CONFIGURED, {
      authorization: `bearer ${SMOKE_TOKEN}`,
    });

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
  });

  test('要求の本文に宛先・種別・入力があっても無視し、宛先のシークレットへ疎通確認の種別だけを送る', async () => {
    const { response, sent } = await requestSmoke(CONFIGURED, {
      authorization: `Bearer ${SMOKE_TOKEN}`,
      body: JSON.stringify({
        to: 'attacker@other.example',
        kind: 'other-domain.kind',
        input: { requestedAt: '2000-01-01T00:00:00.000Z' },
      }),
    });

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
    const { kind, to, input } = EMAIL_SEND_MESSAGE.schema.parse(sent[0]?.body);
    expect(kind).toBe(EMAIL_DELIVERY_SMOKE_KIND.name);
    expect(to).toBe(SMOKE_RECIPIENT);
    expect(input).not.toStrictEqual({
      requestedAt: '2000-01-01T00:00:00.000Z',
    });
  });

  test('POST以外のメソッドは未登録の経路と同じ404を返して送らない', async () => {
    const { response, sent } = await requestSmoke(CONFIGURED, {
      method: 'GET',
      authorization: `Bearer ${SMOKE_TOKEN}`,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual(NOT_FOUND_BODY);
    expect(sent).toEqual([]);
  });
});
