import { describe, expect, test, vi } from 'vitest';

import type { OutgoingEmail } from '../../../application/email/ports.ts';
import { createMailpitEmailProvider } from './mailpit-email-provider.ts';

const API_URL = 'http://mailpit.example';

const OUTGOING: OutgoingEmail = {
  from: { address: 'noreply@sender.example', name: 'Launch Stadium' },
  to: 'user@recipient.example',
  subject: '疎通確認',
  html: '<p>疎通確認です。</p>',
  text: '疎通確認です。',
  headers: {
    'List-Unsubscribe': '<https://unsubscribe.example/u/token>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
};

function createFetcher(respond: () => Promise<Response>) {
  const spy =
    vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      respond,
    );
  return { fetcher: spy as typeof spy & typeof fetch, spy };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requestOf(spy: ReturnType<typeof createFetcher>['spy']) {
  const [input, init] = spy.mock.calls[0] ?? [];
  const request = new Request(input ?? '', init);
  return { request, body: await request.json<unknown>() };
}

describe('Mailpitの送信プロバイダ', () => {
  test('HTTPの送信APIへ送信元・宛先・件名・両パート・追加ヘッダーを送り、応答のIDを返す', async () => {
    const { fetcher, spy } = createFetcher(() =>
      Promise.resolve(jsonResponse({ ID: 'mailpit-message-1' }, 200)),
    );

    const outcome = await createMailpitEmailProvider(API_URL, fetcher).send(
      OUTGOING,
    );

    expect(outcome).toEqual({
      kind: 'sent',
      providerMessageId: 'mailpit-message-1',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const { request, body } = await requestOf(spy);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://mailpit.example/api/v1/send');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(body).toEqual({
      From: { Email: 'noreply@sender.example', Name: 'Launch Stadium' },
      To: [{ Email: 'user@recipient.example' }],
      Subject: '疎通確認',
      Text: '疎通確認です。',
      HTML: '<p>疎通確認です。</p>',
      Headers: {
        'List-Unsubscribe': '<https://unsubscribe.example/u/token>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    expect(body).not.toHaveProperty('ReplyTo');
  });

  test('宛先URLの末尾のスラッシュを重ねずに送信APIのパスをつなぐ', async () => {
    const { fetcher, spy } = createFetcher(() =>
      Promise.resolve(jsonResponse({ ID: 'mailpit-message-2' }, 200)),
    );

    await createMailpitEmailProvider(`${API_URL}/`, fetcher).send(OUTGOING);

    const { request } = await requestOf(spy);
    expect(request.url).toBe('http://mailpit.example/api/v1/send');
  });

  test('追加ヘッダーが無ければHeadersを送らない', async () => {
    const { fetcher, spy } = createFetcher(() =>
      Promise.resolve(jsonResponse({ ID: 'mailpit-message-3' }, 200)),
    );

    await createMailpitEmailProvider(API_URL, fetcher).send({
      ...OUTGOING,
      headers: {},
    });

    const { body } = await requestOf(spy);
    expect(body).not.toHaveProperty('Headers');
  });

  test('400は再試行しても変わらない失敗(mailpit-rejected)として返す', async () => {
    const { fetcher } = createFetcher(() =>
      Promise.resolve(jsonResponse({ Error: 'invalid format' }, 400)),
    );

    const outcome = await createMailpitEmailProvider(API_URL, fetcher).send(
      OUTGOING,
    );

    expect(outcome).toEqual({ kind: 'permanent', code: 'mailpit-rejected' });
  });

  test('失敗の応答の本文を読み捨てられなくても例外にせず結果として返す', async () => {
    const body = new ReadableStream({
      cancel() {
        throw new Error('読み捨ての失敗');
      },
    });
    const { fetcher } = createFetcher(() =>
      Promise.resolve(new Response(body, { status: 400 })),
    );

    const outcome = await createMailpitEmailProvider(API_URL, fetcher).send(
      OUTGOING,
    );

    expect(outcome).toEqual({ kind: 'permanent', code: 'mailpit-rejected' });
  });

  test.each([500, 503, 404])(
    '状態コード%iは一時的な障害として返す',
    async (status) => {
      const { fetcher } = createFetcher(() =>
        Promise.resolve(new Response('error', { status })),
      );

      const outcome = await createMailpitEmailProvider(API_URL, fetcher).send(
        OUTGOING,
      );

      expect(outcome).toEqual({
        kind: 'temporary',
        code: `mailpit-status-${String(status)}`,
      });
    },
  );

  test('通信の失敗は一時的な障害(mailpit-unreachable)として返す', async () => {
    const { fetcher } = createFetcher(() =>
      Promise.reject(new TypeError('Network connection lost.')),
    );

    const outcome = await createMailpitEmailProvider(API_URL, fetcher).send(
      OUTGOING,
    );

    expect(outcome).toEqual({ kind: 'temporary', code: 'mailpit-unreachable' });
  });

  test.each<[string, () => Response]>([
    ['IDの無い応答', () => jsonResponse({}, 200)],
    ['IDが文字列でない応答', () => jsonResponse({ ID: 1 }, 200)],
    ['JSONでない応答', () => new Response('ok', { status: 200 })],
  ])(
    '200でも%sは一時的な障害(mailpit-invalid-response)として返す',
    async (_label, response) => {
      const { fetcher } = createFetcher(() => Promise.resolve(response()));

      const outcome = await createMailpitEmailProvider(API_URL, fetcher).send(
        OUTGOING,
      );

      expect(outcome).toEqual({
        kind: 'temporary',
        code: 'mailpit-invalid-response',
      });
    },
  );
});
