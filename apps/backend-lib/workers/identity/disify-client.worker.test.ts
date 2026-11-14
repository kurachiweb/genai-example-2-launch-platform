import { resetSync } from '@logtape/logtape';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';

import type { HttpFetch } from '../bot-protection/turnstile-verifier.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  createDisifyClient,
  DISIFY_EMAIL_URL,
  type DisifyClientOptions,
} from './disify-client.ts';

interface DisifyCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
  readonly signal: AbortSignal | null | undefined;
}

interface FakeFetch {
  readonly fetch: HttpFetch;
  readonly calls: DisifyCall[];
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly args: readonly unknown[];
}

const LOCAL_PART = 'taro.yamada';
const DOMAIN = 'mail.example';
const EMAIL = `${LOCAL_PART}@${DOMAIN}`;
const API_KEY = ['test', 'disify', 'api', 'credential'].join('-');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function judgedBody(disposable: boolean): Record<string, unknown> {
  return { format: true, domain: DOMAIN, disposable, dns: true };
}

function createFakeFetch(
  respond: (init: RequestInit | undefined) => Promise<Response>,
): FakeFetch {
  const calls: DisifyCall[] = [];
  const fakeFetch: HttpFetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: new TextDecoder().decode(await request.arrayBuffer()),
      signal: init?.signal,
    });
    return respond(init);
  };
  return { fetch: fakeFetch, calls };
}

function respondWith(body: unknown, status = 200): FakeFetch {
  return createFakeFetch(() => Promise.resolve(jsonResponse(body, status)));
}

// 打ち切りの合図が来るまで応答しない判定サービスの代わり
function respondOnlyWhenAborted(): FakeFetch {
  return createFakeFetch(
    (init) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal === null || signal === undefined) {
          reject(new Error('打ち切りの合図が渡されていません'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      }),
  );
}

function clientOptions(
  fake: FakeFetch,
  overrides: Partial<DisifyClientOptions> = {},
): DisifyClientOptions {
  return {
    appName: 'api',
    fetch: fake.fetch,
    apiKey: API_KEY,
    ...overrides,
  };
}

function recordLogs(appName: 'api' | 'event' = 'api'): ConsoleCall[] {
  const calls: ConsoleCall[] = [];
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const recorder = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: recorder as unknown as Console,
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('createDisifyClient(要求)', () => {
  test('ローカル部をダミーに置き換えたアドレスをフォーム形式の本文でPOSTする', async () => {
    const fake = respondWith(judgedBody(false));
    const client = createDisifyClient(clientOptions(fake));

    await client.check(EMAIL);

    expect(fake.calls).toHaveLength(1);
    expect(DISIFY_EMAIL_URL).toBe('https://disify.com/api/email');
    expect(fake.calls[0]?.url).toBe(DISIFY_EMAIL_URL);
    expect(fake.calls[0]?.method).toBe('POST');
    expect(fake.calls[0]?.headers.get('Content-Type')).toMatch(
      /^application\/x-www-form-urlencoded/,
    );
    expect(
      Object.fromEntries(new URLSearchParams(fake.calls[0]?.body ?? '')),
    ).toStrictEqual({ email: `dummy@${DOMAIN}` });
  });

  test('メールアドレスは本文にだけ入り、URLとヘッダーに含めず、ローカル部をどこにも送らない', async () => {
    const fake = respondWith(judgedBody(false));
    const client = createDisifyClient(clientOptions(fake, { apiKey: API_KEY }));

    await client.check(EMAIL);

    const call = fake.calls[0];
    const headerValues = [...(call?.headers.entries() ?? [])].flat().join('\n');
    expect(call?.url).not.toContain(DOMAIN);
    expect(new URL(call?.url ?? '').search).toBe('');
    expect(headerValues).not.toContain(DOMAIN);
    expect(call?.body).toContain(encodeURIComponent(DOMAIN));
    expect(JSON.stringify(fake.calls)).not.toContain(LOCAL_PART);
    expect(call?.body).not.toContain(encodeURIComponent(LOCAL_PART));
  });

  test('APIキーがあればX-Api-Keyヘッダーで送る', async () => {
    const fake = respondWith(judgedBody(false));
    const client = createDisifyClient(clientOptions(fake, { apiKey: API_KEY }));

    await client.check(EMAIL);

    expect(fake.calls[0]?.headers.get('X-Api-Key')).toBe(API_KEY);
  });

  test.each([undefined, ''])(
    'APIキーが%sなら判定サービスを呼ばずにregularを返す',
    async (apiKey) => {
      const fake = respondWith(judgedBody(true));
      const client = createDisifyClient(clientOptions(fake, { apiKey }));

      const status = await client.check(EMAIL);

      expect(status).toBe('regular');
      expect(fake.calls).toHaveLength(0);
    },
  );

  test('User-Agentを渡されたら、User-Agentヘッダーで呼び出し元を名乗る', async () => {
    const fake = respondWith(judgedBody(false));
    const client = createDisifyClient(
      clientOptions(fake, { userAgent: 'genai-example-2-api' }),
    );

    await client.check(EMAIL);

    expect(fake.calls[0]?.headers.get('User-Agent')).toBe(
      'genai-example-2-api',
    );
  });

  test('User-Agentを渡されなければ、User-Agentヘッダーを設定しない', async () => {
    const fake = respondWith(judgedBody(false));
    const client = createDisifyClient(clientOptions(fake));

    await client.check(EMAIL);

    expect(fake.calls[0]?.headers.has('User-Agent')).toBe(false);
  });

  test('既定では3秒で通信を打ち切る', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fake = respondWith(judgedBody(false));
    const client = createDisifyClient(clientOptions(fake));

    await client.check(EMAIL);

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(fake.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('createDisifyClient(判定結果)', () => {
  test.each<[boolean, string]>([
    [true, 'disposable'],
    [false, 'regular'],
  ])(
    '状態コード200でdisposableが%sなら%sを返す',
    async (disposable, expected) => {
      const client = createDisifyClient(
        clientOptions(respondWith(judgedBody(disposable))),
      );

      await expect(client.check(EMAIL)).resolves.toBe(expected);
    },
  );

  test.each<[string, () => FakeFetch]>([
    ['形式の不正', () => respondWith({ format: false })],
    ['状態コード401', () => respondWith({ message: 'Unauthorized' }, 401)],
    ['状態コード429', () => respondWith({ message: 'Too Many' }, 429)],
    ['状態コード503', () => respondWith(judgedBody(true), 503)],
    [
      'HTMLの応答',
      () =>
        createFakeFetch(() =>
          Promise.resolve(
            new Response('<html></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            }),
          ),
        ),
    ],
    [
      '通信の失敗',
      () =>
        createFakeFetch(() => Promise.reject(new TypeError('接続できません'))),
    ],
  ])('%sは例外を投げずundeterminedを返す', async (_, fake) => {
    const client = createDisifyClient(clientOptions(fake()));

    await expect(client.check(EMAIL)).resolves.toBe('undetermined');
  });

  test('打ち切りまでに応答が無ければundeterminedを返す', async () => {
    const fake = respondOnlyWhenAborted();
    const client = createDisifyClient(clientOptions(fake, { timeoutMs: 20 }));

    await expect(client.check(EMAIL)).resolves.toBe('undetermined');
    expect(fake.calls[0]?.signal?.aborted).toBe(true);
  });
});

describe('createDisifyClient(ログ)', () => {
  test('状態コードで判定できなければ、理由と状態コードを警告ログに1件残し、メールアドレスとドメインを記録しない', async () => {
    const logs = recordLogs();
    const client = createDisifyClient(
      clientOptions(respondWith({ message: 'Too Many' }, 429)),
    );

    await client.check(EMAIL);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.method).toBe('warn');
    expect(logs[0]?.args[0]).toMatchObject({
      level: 'warning',
      category: 'api.identity.disposable-email',
      reason: 'unexpected-status',
      status: 429,
    });
    expect(JSON.stringify(logs)).not.toContain(DOMAIN);
    expect(JSON.stringify(logs)).not.toContain(LOCAL_PART);
  });

  test('判定できない本文はunexpected-bodyとして記録する', async () => {
    const logs = recordLogs();
    const client = createDisifyClient(
      clientOptions(respondWith({ format: false, domain: DOMAIN })),
    );

    await client.check(EMAIL);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.args[0]).toMatchObject({
      reason: 'unexpected-body',
      status: 200,
    });
    expect(JSON.stringify(logs)).not.toContain(DOMAIN);
  });

  test.each<[string, () => FakeFetch, Partial<DisifyClientOptions>]>([
    [
      'network-error',
      () => createFakeFetch(() => Promise.reject(new TypeError(EMAIL))),
      {},
    ],
    ['timeout', respondOnlyWhenAborted, { timeoutMs: 20 }],
  ])(
    '通信の失敗は理由%sだけを記録し、状態コードを付けない',
    async (reason, fake, overrides) => {
      const logs = recordLogs();
      const client = createDisifyClient(clientOptions(fake(), overrides));

      await client.check(EMAIL);

      expect(logs).toHaveLength(1);
      expect(logs[0]?.args[0]).toMatchObject({ level: 'warning', reason });
      expect(logs[0]?.args[0]).not.toHaveProperty('status');
      expect(JSON.stringify(logs)).not.toContain(DOMAIN);
      expect(JSON.stringify(logs)).not.toContain(LOCAL_PART);
    },
  );

  test('カテゴリの先頭は呼び出したアプリの名前になる', async () => {
    const logs = recordLogs('event');
    const client = createDisifyClient(
      clientOptions(respondWith(undefined, 503), { appName: 'event' }),
    );

    await client.check(EMAIL);

    expect(logs[0]?.args[0]).toMatchObject({
      category: 'event.identity.disposable-email',
    });
  });

  test('判定できた結果はログに残さない', async () => {
    const logs = recordLogs();
    const client = createDisifyClient(
      clientOptions(respondWith(judgedBody(true))),
    );

    await client.check(EMAIL);

    expect(logs).toHaveLength(0);
  });
});
