import { resetSync } from '@logtape/logtape';
import {
  CloudflareClient,
  type Event,
  getCurrentScope,
} from '@sentry/cloudflare';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import {
  type BotVerificationFailure,
  MAX_TOKEN_LENGTH,
} from '../../core/bot-protection/siteverify-result.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  BOT_VERIFICATION_FAILED_MESSAGE,
  BOT_VERIFICATION_UNAVAILABLE_MESSAGE,
  createTurnstileVerifier,
  type HttpFetch,
  SITEVERIFY_URL,
  type TurnstileVerifierOptions,
} from './turnstile-verifier.ts';

interface SiteverifyCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly body: unknown;
  readonly signal: AbortSignal | null | undefined;
}

interface FakeFetch {
  readonly fetch: HttpFetch;
  readonly calls: SiteverifyCall[];
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly args: readonly unknown[];
}

const TOKEN = ['turnstile', 'response', 'sample', '0001'].join('-');
const SECRET_KEY = ['test', 'turnstile', 'secret'].join('-');
const CLIENT_IP = '203.0.113.21';
const HOSTNAME = 'client.launch.example';
const CHALLENGE_TS = '2026-10-25T03:04:05.678Z';
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successBody(action?: string): Record<string, unknown> {
  return {
    success: true,
    hostname: HOSTNAME,
    challenge_ts: CHALLENGE_TS,
    ...(action !== undefined && { action }),
    'error-codes': [],
  };
}

function failureBody(errorCodes: readonly string[]): Record<string, unknown> {
  return { success: false, 'error-codes': errorCodes };
}

function createFakeFetch(
  respond: (init: RequestInit | undefined) => Promise<Response>,
): FakeFetch {
  const calls: SiteverifyCall[] = [];
  const fakeFetch: HttpFetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const contentType = new Headers(init?.headers).get('Content-Type');
    const body: unknown =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({
      url,
      method: init?.method,
      contentType,
      body,
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

function verifierOptions(
  fake: FakeFetch,
  overrides: Partial<TurnstileVerifierOptions> = {},
): TurnstileVerifierOptions {
  return {
    secretKey: SECRET_KEY,
    expectedHostnames: [],
    fetch: fake.fetch,
    ...overrides,
  };
}

function createRecordingConsole(): {
  readonly console: Console;
  readonly calls: ConsoleCall[];
} {
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
  return { console: recorder as unknown as Console, calls };
}

function recordLogs(): ConsoleCall[] {
  const recording = createRecordingConsole();
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: recording.console,
  });
  return recording.calls;
}

interface RecordingSentry {
  readonly events: Event[];
  readonly flush: () => Promise<boolean>;
}

function installRecordingSentry(): RecordingSentry {
  const events: Event[] = [];
  const client = new CloudflareClient({
    dsn: TEST_DSN,
    integrations: [],
    stackParser: () => [],
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
    beforeSend: (event) => {
      events.push(event);
      return null;
    },
  });
  getCurrentScope().setClient(client);
  client.init();
  return { events, flush: () => client.flush(1000) };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗するはずの検証が成功した');
}

afterEach(() => {
  vi.restoreAllMocks();
  getCurrentScope().setClient(undefined);
});

afterAll(() => {
  resetSync();
});

describe('createTurnstileVerifier(verify)', () => {
  test('トークンと送信元IPをJSONで判定サービスへPOSTし、成功の判定結果を返す', async () => {
    const fake = respondWith(successBody('login'));
    const verifier = createTurnstileVerifier(verifierOptions(fake));

    const result = await verifier.verify({
      token: TOKEN,
      remoteIp: CLIENT_IP,
    });

    expect(result).toStrictEqual({
      ok: true,
      hostname: HOSTNAME,
      action: 'login',
      challengeTs: CHALLENGE_TS,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe(SITEVERIFY_URL);
    expect(SITEVERIFY_URL).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    expect(fake.calls[0]?.method).toBe('POST');
    expect(fake.calls[0]?.contentType).toBe('application/json');
    expect(fake.calls[0]?.body).toStrictEqual({
      secret: SECRET_KEY,
      response: TOKEN,
      remoteip: CLIENT_IP,
    });
    expect(fake.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test('送信元IPが不明なら送る本文に含めない', async () => {
    const fake = respondWith(successBody());
    const verifier = createTurnstileVerifier(verifierOptions(fake));

    const result = await verifier.verify({ token: TOKEN, remoteIp: undefined });

    expect(result.ok).toBe(true);
    expect(fake.calls[0]?.body).toStrictEqual({
      secret: SECRET_KEY,
      response: TOKEN,
    });
  });

  test.each([undefined, ''])(
    'トークンが%sなら通信せずmissing-tokenで失敗する',
    async (token) => {
      const fake = respondWith(successBody());
      const verifier = createTurnstileVerifier(verifierOptions(fake));

      const result = await verifier.verify({ token, remoteIp: CLIENT_IP });

      expect(result).toStrictEqual({
        ok: false,
        failure: 'missing-token',
        errorCodes: [],
      });
      expect(fake.calls).toHaveLength(0);
    },
  );

  test('上限の文字数を超えるトークンは通信せずinvalid-tokenで失敗し、上限ちょうどは送る', async () => {
    const fake = respondWith(successBody());
    const verifier = createTurnstileVerifier(verifierOptions(fake));

    const tooLong = await verifier.verify({
      token: 'a'.repeat(MAX_TOKEN_LENGTH + 1),
      remoteIp: CLIENT_IP,
    });
    expect(fake.calls).toHaveLength(0);
    const atLimit = await verifier.verify({
      token: 'a'.repeat(MAX_TOKEN_LENGTH),
      remoteIp: CLIENT_IP,
    });

    expect(tooLong).toStrictEqual({
      ok: false,
      failure: 'invalid-token',
      errorCodes: [],
    });
    expect(atLimit.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });

  test.each<[string, BotVerificationFailure]>([
    ['invalid-input-response', 'invalid-token'],
    ['timeout-or-duplicate', 'expired-or-duplicate'],
    ['invalid-input-secret', 'misconfigured'],
    ['internal-error', 'unavailable'],
  ])(
    '判定サービスのエラーコード%sを%sに分類する',
    async (errorCode, failure) => {
      const verifier = createTurnstileVerifier(
        verifierOptions(respondWith(failureBody([errorCode]))),
      );

      const result = await verifier.verify({
        token: TOKEN,
        remoteIp: CLIENT_IP,
      });

      expect(result).toStrictEqual({
        ok: false,
        failure,
        errorCodes: [errorCode],
      });
    },
  );

  test('期待する操作名と一致しなければaction-mismatchで失敗する', async () => {
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(successBody('signup'))),
    );

    const mismatched = await verifier.verify({
      token: TOKEN,
      remoteIp: CLIENT_IP,
      expectedAction: 'login',
    });
    const matched = await verifier.verify({
      token: TOKEN,
      remoteIp: CLIENT_IP,
      expectedAction: 'signup',
    });

    expect(mismatched).toMatchObject({ ok: false, failure: 'action-mismatch' });
    expect(matched.ok).toBe(true);
  });

  test('期待するホスト名と一致しなければhostname-mismatchで失敗し、設定値の大文字小文字は区別しない', async () => {
    const fake = respondWith(successBody());

    const mismatched = await createTurnstileVerifier(
      verifierOptions(fake, { expectedHostnames: ['admin.launch.example'] }),
    ).verify({ token: TOKEN, remoteIp: CLIENT_IP });
    const matched = await createTurnstileVerifier(
      verifierOptions(fake, {
        expectedHostnames: ['admin.launch.example', 'Client.Launch.Example'],
      }),
    ).verify({ token: TOKEN, remoteIp: CLIENT_IP });

    expect(mismatched).toMatchObject({
      ok: false,
      failure: 'hostname-mismatch',
    });
    expect(matched.ok).toBe(true);
  });

  test('判定サービスへ接続できなければunavailableで失敗する', async () => {
    const fake = createFakeFetch(() =>
      Promise.reject(new TypeError('接続できません')),
    );
    const verifier = createTurnstileVerifier(verifierOptions(fake));

    const result = await verifier.verify({ token: TOKEN, remoteIp: CLIENT_IP });

    expect(result).toStrictEqual({
      ok: false,
      failure: 'unavailable',
      errorCodes: [],
    });
  });

  test.each([
    ['2xx以外の応答', () => jsonResponse(successBody(), 500)],
    ['JSONでない応答', () => new Response('<html></html>', { status: 200 })],
  ])('%sはunavailableで失敗する', async (_, response) => {
    const fake = createFakeFetch(() => Promise.resolve(response()));
    const verifier = createTurnstileVerifier(verifierOptions(fake));

    const result = await verifier.verify({ token: TOKEN, remoteIp: CLIENT_IP });

    expect(result).toMatchObject({ ok: false, failure: 'unavailable' });
  });

  test('既定では5秒で通信を打ち切る', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(successBody())),
    );

    await verifier.verify({ token: TOKEN, remoteIp: CLIENT_IP });

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  test('打ち切りまでに応答が無ければunavailableで失敗する', async () => {
    const fake = respondOnlyWhenAborted();
    const verifier = createTurnstileVerifier(
      verifierOptions(fake, { timeoutMs: 20 }),
    );

    const result = await verifier.verify({ token: TOKEN, remoteIp: CLIENT_IP });

    expect(result).toStrictEqual({
      ok: false,
      failure: 'unavailable',
      errorCodes: [],
    });
    expect(fake.calls[0]?.signal?.aborted).toBe(true);
  });
});

describe('createTurnstileVerifier(assertHuman)', () => {
  test('検証に成功すれば例外を投げない', async () => {
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(successBody())),
    );

    await expect(
      verifier.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
    ).resolves.toBeUndefined();
  });

  test.each<[string, () => FakeFetch, string | undefined]>([
    ['missing-token', () => respondWith(successBody()), undefined],
    [
      'invalid-token',
      () => respondWith(failureBody(['invalid-input-response'])),
      TOKEN,
    ],
    [
      'expired-or-duplicate',
      () => respondWith(failureBody(['timeout-or-duplicate'])),
      TOKEN,
    ],
    ['action-mismatch', () => respondWith(successBody('signup')), TOKEN],
  ])(
    '%sは403のbot_verification_failedを投げる',
    async (_, createFetch, token) => {
      const verifier = createTurnstileVerifier(verifierOptions(createFetch()));

      const error = await captureRejection(
        verifier.assertHuman({
          token,
          remoteIp: CLIENT_IP,
          expectedAction: 'login',
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'forbidden',
        code: 'bot_verification_failed',
        message: BOT_VERIFICATION_FAILED_MESSAGE,
        retryAfterSeconds: undefined,
      });
    },
  );

  test('hostname-mismatchは403のbot_verification_failedを投げる', async () => {
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(successBody()), {
        expectedHostnames: ['admin.launch.example'],
      }),
    );

    const error = await captureRejection(
      verifier.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
    );

    expect(error).toMatchObject({
      kind: 'forbidden',
      code: 'bot_verification_failed',
    });
  });

  test.each<[string, () => FakeFetch]>([
    ['unavailable', () => respondWith(failureBody(['internal-error']))],
    ['misconfigured', () => respondWith(failureBody(['invalid-input-secret']))],
  ])(
    '%sは503・再試行まで5秒のbot_verification_unavailableを投げる',
    async (_, createFetch) => {
      const verifier = createTurnstileVerifier(verifierOptions(createFetch()));

      const error = await captureRejection(
        verifier.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'unavailable',
        code: 'bot_verification_unavailable',
        message: BOT_VERIFICATION_UNAVAILABLE_MESSAGE,
        retryAfterSeconds: 5,
      });
    },
  );

  test('打ち切りは503のbot_verification_unavailableを投げる', async () => {
    const verifier = createTurnstileVerifier(
      verifierOptions(respondOnlyWhenAborted(), { timeoutMs: 20 }),
    );

    const error = await captureRejection(
      verifier.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
    );

    expect(error).toMatchObject({
      kind: 'unavailable',
      code: 'bot_verification_unavailable',
      retryAfterSeconds: 5,
    });
  });

  test('設定の誤りだけをエラートラッキングへerrorで送り、トークンを含めない', async () => {
    const sentry = installRecordingSentry();
    const misconfigured = createTurnstileVerifier(
      verifierOptions(respondWith(failureBody(['invalid-input-secret']))),
    );
    const unavailable = createTurnstileVerifier(
      verifierOptions(respondWith(failureBody(['internal-error']))),
    );
    const invalid = createTurnstileVerifier(
      verifierOptions(respondWith(failureBody(['invalid-input-response']))),
    );

    await captureRejection(
      misconfigured.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
    );
    await captureRejection(
      unavailable.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
    );
    await captureRejection(
      invalid.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
    );
    await sentry.flush();

    expect(sentry.events).toHaveLength(1);
    expect(sentry.events[0]?.level).toBe('error');
    expect(sentry.events[0]?.extra).toStrictEqual({
      errorCodes: ['invalid-input-secret'],
    });
    expect(JSON.stringify(sentry.events)).not.toContain(TOKEN);
  });
});

describe('createTurnstileVerifier(ログ)', () => {
  test('失敗の理由とエラーコードを警告ログに1件残し、トークンを記録しない', async () => {
    const logs = recordLogs();
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(failureBody(['timeout-or-duplicate']))),
    );

    await verifier.verify({ token: TOKEN, remoteIp: CLIENT_IP });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.method).toBe('warn');
    expect(logs[0]?.args[0]).toMatchObject({
      level: 'warning',
      category: 'api.infrastructure.bot-protection',
      failure: 'expired-or-duplicate',
      errorCodes: ['timeout-or-duplicate'],
    });
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(JSON.stringify(logs)).not.toContain(CLIENT_IP);
  });

  test('通信しない失敗も警告ログに残す', async () => {
    const logs = recordLogs();
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(successBody())),
    );

    await verifier.verify({
      token: TOKEN.repeat(MAX_TOKEN_LENGTH),
      remoteIp: CLIENT_IP,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.args[0]).toMatchObject({
      level: 'warning',
      failure: 'invalid-token',
      errorCodes: [],
    });
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  test('assertHumanの失敗でも警告ログは1件だけ残る', async () => {
    const logs = recordLogs();
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(failureBody(['invalid-input-secret']))),
    );

    await captureRejection(
      verifier.assertHuman({ token: TOKEN, remoteIp: CLIENT_IP }),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]?.args[0]).toMatchObject({
      level: 'warning',
      failure: 'misconfigured',
      errorCodes: ['invalid-input-secret'],
    });
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  test('成功はログに残さない', async () => {
    const logs = recordLogs();
    const verifier = createTurnstileVerifier(
      verifierOptions(respondWith(successBody())),
    );

    await verifier.verify({ token: TOKEN, remoteIp: CLIENT_IP });

    expect(logs).toHaveLength(0);
  });
});
