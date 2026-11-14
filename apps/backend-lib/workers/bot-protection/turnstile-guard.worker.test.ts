import { resetSync } from '@logtape/logtape';
import { Hono } from 'hono';
import { Container } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';

import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { toErrorResponse } from '../../core/errors/error-envelope.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  TURNSTILE_RESPONSE_HEADER,
  turnstileGuard,
  type TurnstileGuardOptions,
} from './turnstile-guard.ts';
import {
  BOT_VERIFICATION_FAILED_MESSAGE,
  BOT_VERIFICATION_UNAVAILABLE_MESSAGE,
  createTurnstileVerifier,
  type HttpFetch,
} from './turnstile-verifier.ts';

interface GuardHonoEnv {
  Variables: {
    clientIp: string | undefined;
    container: Container;
  };
}

interface SentBody {
  readonly secret?: string;
  readonly response?: string;
  readonly remoteip?: string;
}

interface FakeSiteverify {
  readonly fetch: HttpFetch;
  readonly sent: SentBody[];
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const TOKEN = ['turnstile', 'response', 'guard', '0002'].join('-');
const SECRET_KEY = ['test', 'turnstile', 'secret'].join('-');
const CLIENT_IP = '198.51.100.31';
const HOSTNAME = 'client.launch.example';
const API_URL = 'https://api.launch.example/v1/protected';

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
    challenge_ts: '2026-10-25T03:04:05.678Z',
    ...(action !== undefined && { action }),
    'error-codes': [],
  };
}

function failureBody(errorCodes: readonly string[]): Record<string, unknown> {
  return { success: false, 'error-codes': errorCodes };
}

function createFakeSiteverify(
  respond: (init: RequestInit | undefined) => Promise<Response>,
): FakeSiteverify {
  const sent: SentBody[] = [];
  const fakeFetch: HttpFetch = (_, init) => {
    if (typeof init?.body === 'string') {
      sent.push(JSON.parse(init.body) as SentBody);
    }
    return respond(init);
  };
  return { fetch: fakeFetch, sent };
}

function respondWith(body: unknown, status = 200): FakeSiteverify {
  return createFakeSiteverify(() =>
    Promise.resolve(jsonResponse(body, status)),
  );
}

function respondOnlyWhenAborted(): FakeSiteverify {
  return createFakeSiteverify(
    (init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      }),
  );
}

// 処理単位のコンテナとクライアントIPを用意するinvocationContext・requestContainerの役割と、AppErrorを共通のエラー形式へ変えるonErrorの役割を、テストではこのアプリが担う
function createApp(
  fake: FakeSiteverify,
  guardOptions?: TurnstileGuardOptions,
  timeoutMs?: number,
): Hono<GuardHonoEnv> {
  const verifier = createTurnstileVerifier({
    secretKey: SECRET_KEY,
    expectedHostnames: [HOSTNAME],
    fetch: fake.fetch,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });
  const app = new Hono<GuardHonoEnv>();
  app.use(async (c, next) => {
    const container = new Container();
    container.bind(PLATFORM_TYPES.BotVerifier).toConstantValue(verifier);
    c.set('container', container);
    c.set('clientIp', c.req.header('CF-Connecting-IP'));
    await next();
  });
  app.post('/v1/protected', turnstileGuard(guardOptions), (c) =>
    c.text('handled'),
  );
  app.onError((error, c) => {
    if (!(error instanceof AppError)) {
      throw error;
    }
    const { status, body, headers } = toErrorResponse(error);
    return c.json(body, status, headers);
  });
  return app;
}

function withToken(token: string | undefined): RequestInit {
  const headers = new Headers({ 'CF-Connecting-IP': CLIENT_IP });
  if (token !== undefined) {
    headers.set(TURNSTILE_RESPONSE_HEADER, token);
  }
  return { method: 'POST', headers };
}

function recordLogs(): { method: ConsoleMethod; args: unknown[] }[] {
  const calls: { method: ConsoleMethod; args: unknown[] }[] = [];
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: {
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    } as unknown as Console,
  });
  return calls;
}

afterAll(() => {
  resetSync();
});

describe('turnstileGuard', () => {
  test('既定ではCF-Turnstile-Responseヘッダーのトークンとクライアントの文脈のIPで検証し、成功すれば次の処理へ進む', async () => {
    const fake = respondWith(successBody());
    const app = createApp(fake);

    const response = await app.request(API_URL, withToken(TOKEN));

    expect(TURNSTILE_RESPONSE_HEADER).toBe('CF-Turnstile-Response');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('handled');
    expect(fake.sent).toStrictEqual([
      {
        secret: SECRET_KEY,
        response: TOKEN,
        remoteip: CLIENT_IP,
      },
    ]);
  });

  test('トークンが無ければ通信せず403と共通のエラー形式で拒否する', async () => {
    const fake = respondWith(successBody());
    const app = createApp(fake);

    const response = await app.request(API_URL, withToken(undefined));

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'bot_verification_failed',
        message: BOT_VERIFICATION_FAILED_MESSAGE,
      },
    });
    expect(fake.sent).toHaveLength(0);
  });

  test.each<[string, () => FakeSiteverify]>([
    [
      '無効なトークン',
      () => respondWith(failureBody(['invalid-input-response'])),
    ],
    [
      '期限切れ・使用済みのトークン',
      () => respondWith(failureBody(['timeout-or-duplicate'])),
    ],
    [
      'ホスト名の不一致',
      () => respondWith({ ...successBody(), hostname: 'other.launch.example' }),
    ],
  ])('%sは403で拒否し、次の処理へ進まない', async (_, createFake) => {
    const app = createApp(createFake());

    const response = await app.request(API_URL, withToken(TOKEN));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'bot_verification_failed' },
    });
  });

  test.each<[string, () => FakeSiteverify]>([
    ['判定サービスの障害', () => respondWith(failureBody(['internal-error']))],
    ['設定の誤り', () => respondWith(failureBody(['invalid-input-secret']))],
    ['2xx以外の応答', () => respondWith(successBody(), 502)],
    [
      '接続の失敗',
      () =>
        createFakeSiteverify(() =>
          Promise.reject(new TypeError('接続できません')),
        ),
    ],
  ])('%sは503・Retry-After: 5で拒否する', async (_, createFake) => {
    const app = createApp(createFake());

    const response = await app.request(API_URL, withToken(TOKEN));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'bot_verification_unavailable',
        message: BOT_VERIFICATION_UNAVAILABLE_MESSAGE,
      },
    });
  });

  test('打ち切りまでに判定サービスが応答しなければ503で拒否する', async () => {
    const app = createApp(respondOnlyWhenAborted(), undefined, 20);

    const response = await app.request(API_URL, withToken(TOKEN));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
  });

  test('指定した操作名と判定結果の操作名が一致しなければ403で拒否する', async () => {
    const mismatched = createApp(respondWith(successBody('signup')), {
      action: 'login',
    });
    const matched = createApp(respondWith(successBody('login')), {
      action: 'login',
    });

    const rejected = await mismatched.request(API_URL, withToken(TOKEN));
    const accepted = await matched.request(API_URL, withToken(TOKEN));

    expect(rejected.status).toBe(403);
    expect(accepted.status).toBe(200);
  });

  test('トークンの読み取り方を差し替えられる', async () => {
    const fake = respondWith(successBody());
    const app = createApp(fake, {
      token: (request) => request.headers.get('X-Test-Bot-Token') ?? undefined,
    });

    const response = await app.request(API_URL, {
      method: 'POST',
      headers: { 'X-Test-Bot-Token': TOKEN, 'CF-Connecting-IP': CLIENT_IP },
    });

    expect(response.status).toBe(200);
    expect(fake.sent[0]?.response).toBe(TOKEN);
  });

  test('失敗の理由を警告ログに残し、トークンを記録しない', async () => {
    const logs = recordLogs();
    const app = createApp(respondWith(failureBody(['timeout-or-duplicate'])));

    const response = await app.request(API_URL, withToken(TOKEN));

    expect(response.status).toBe(403);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.args[0]).toMatchObject({
      level: 'warning',
      failure: 'expired-or-duplicate',
      errorCodes: ['timeout-or-duplicate'],
    });
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });
});
