import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';
import { z } from 'zod';

import type { AppModule } from '../../../lib/core/di/app-module.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { platformEnvShape } from '../../../lib/workers/env/platform-env.ts';
import { createWorkerApp } from '../../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { ensureLoggingConfigured } from '../../../lib/workers/logging/configure-logging.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../../lib/workers/observability/sentry.ts';
import {
  type AuthenticatedPrincipal,
  SESSION_TYPES,
  type SessionIssue,
  type SessionSubjectKind,
  type SessionVerification,
  type SessionVerifier,
} from '../../application/session/session-verifier.ts';
import {
  type CallerKind,
  GATEWAY_HEADERS,
  SESSION_RESPONSE_HEADERS,
} from './gateway-headers.ts';
import {
  createInternalRoutesModule,
  INTERNAL_ROUTE_PREFIX,
  type InternalRoutes,
  warnOnMissingClientIp,
} from './internal-only.ts';
import {
  readInternalCaller,
  resolveGatewayClientIp,
} from './internal-request.ts';

type TestEnv = typeof env;
type TestApp = Hono<PlatformHonoEnv<TestEnv>>;

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface EchoResponse {
  readonly caller: CallerKind | undefined;
  readonly clientIp: string | undefined;
}

interface InvokeOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

const BASE_URL = 'https://api.launch.example';
const CONNECTING_IP = '198.51.100.20';
const RELAYED_IP = '203.0.113.7';
const INVALID_IP = 'not-an-ip-203.0.113';
const CLIENT_IP_CATEGORY = 'api.gateway.client-ip';
const SESSION_TOKEN_LENGTH = 43;
const VALID_TOKEN = 'valid'.padEnd(SESSION_TOKEN_LENGTH, '0');
const RENEWING_TOKEN = 'renewing'.padEnd(SESSION_TOKEN_LENGTH, '0');
const INVALID_TOKEN = 'invalid'.padEnd(SESSION_TOKEN_LENGTH, '0');

const RETRY_AFTER_SECONDS = 30;

const RENEWAL: SessionIssue = Object.freeze({
  token: 'issued'.padEnd(SESSION_TOKEN_LENGTH, '0'),
  maxAgeSeconds: 3600,
});

const USER_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JBUSER000000000000000000',
  sessionId: '01JBSESSION000000000000000',
});

const handledPaths: string[] = [];

const verifiedSubjectKinds: SessionSubjectKind[] = [];

function verifyByToken(token: string): SessionVerification {
  if (token === INVALID_TOKEN) {
    return { status: 'invalid' };
  }
  return token === RENEWING_TOKEN
    ? { status: 'valid', principal: USER_PRINCIPAL, renewal: RENEWAL }
    : { status: 'valid', principal: USER_PRINCIPAL };
}

const echoRoutes: InternalRoutes<TestEnv> = (app) => {
  app.get('/echo', (c) => {
    handledPaths.push(c.req.path);
    return c.json<EchoResponse>({
      caller: readInternalCaller(c.req.raw),
      clientIp: c.get('clientIp'),
    });
  });
};

const sessionRoutes: InternalRoutes<TestEnv> = (app) => {
  app.get('/session', async (c) => {
    handledPaths.push(c.req.path);
    return c.json(await c.var.session.principal());
  });
  app.get('/session/required', async (c) => {
    handledPaths.push(c.req.path);
    return c.json(await c.var.session.requireAuthenticated());
  });
  app.get('/session/rejected', async (c) => {
    handledPaths.push(c.req.path);
    await c.var.session.principal();
    throw new AppError({
      kind: 'forbidden',
      code: 'forbidden',
      message: 'この操作は許可されていません。',
    });
  });
  app.get('/session/limited', async (c) => {
    handledPaths.push(c.req.path);
    await c.var.session.principal();
    throw new AppError({
      kind: 'rate_limited',
      code: 'rate_limited',
      message: 'しばらく時間をおいてから再度お試しください。',
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    });
  });
  app.get('/session/crashed', async (c) => {
    handledPaths.push(c.req.path);
    await c.var.session.principal();
    throw new Error('経路の想定外の失敗');
  });
  app.get('/session/cached', async (c) => {
    handledPaths.push(c.req.path);
    return c.json(await c.var.session.principal(), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  });
};

const outsideRoutesModule: AppModule<TestApp> = {
  name: 'outside-test',
  bindings: new ContainerModule(({ bind }) => {
    bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).toConstantValue({
      verify: ({ subjectKind, token }) => {
        verifiedSubjectKinds.push(subjectKind);
        return Promise.resolve(verifyByToken(token));
      },
    });
  }),
  routes: (app) => {
    app.get('/echo', (c) => {
      handledPaths.push(c.req.path);
      return c.text('外部経路の経路');
    });
  },
};

const alwaysAllowedRateLimiter: RateLimit = {
  limit: () => Promise.resolve({ success: true }),
};

function createTestApp(): TestApp {
  return createWorkerApp<TestEnv>({
    appName: 'api',
    envSchema: z.object(platformEnvShape),
    modules: [
      outsideRoutesModule,
      createInternalRoutesModule<TestEnv>([echoRoutes, sessionRoutes]),
    ],
    rateLimitExclusions: [],
    resolveClientIp: resolveGatewayClientIp,
    sentry: (bindings) =>
      buildSentryOptions({
        ...readSentryRuntimeOptions(bindings),
        dsn: undefined,
      }),
  });
}

function configureRecordingLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  const methods: Record<ConsoleMethod, typeof record> = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: methods as unknown as Console,
  });
  return logs;
}

function clientIpLogs(logs: readonly LoggedObject[]): LoggedObject[] {
  return logs.filter((log) => log.category === CLIENT_IP_CATEGORY);
}

function internalHeaders(
  caller: CallerKind,
  clientIp: string | null = RELAYED_IP,
): Record<string, string> {
  return {
    [GATEWAY_HEADERS.caller]: caller,
    ...(clientIp === null ? {} : { [GATEWAY_HEADERS.clientIp]: clientIp }),
  };
}

function sessionHeaders(
  token: string,
  caller: CallerKind = 'client',
): Record<string, string> {
  return {
    ...internalHeaders(caller),
    [GATEWAY_HEADERS.sessionToken]: token,
  };
}

function sessionInstructionHeaders(
  response: Response,
): Record<keyof typeof SESSION_RESPONSE_HEADERS, string | null> {
  return {
    issue: response.headers.get(SESSION_RESPONSE_HEADERS.issue),
    maxAge: response.headers.get(SESSION_RESPONSE_HEADERS.maxAge),
    clear: response.headers.get(SESSION_RESPONSE_HEADERS.clear),
  };
}

function headerNames(response: Response): string[] {
  return [...response.headers.keys()].sort();
}

async function invoke(
  path: string,
  options: InvokeOptions = {},
): Promise<Response> {
  handledPaths.length = 0;
  verifiedSubjectKinds.length = 0;
  const ctx = createExecutionContext();
  const response = await createTestApp().fetch(
    new Request(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'CF-Connecting-IP': CONNECTING_IP, ...options.headers },
    }),
    { ...env, IP_RATE_LIMITER: alwaysAllowedRateLimiter },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

afterAll(() => {
  resetSync();
});

describe('createInternalRoutesModule', () => {
  test('内部経路の要求は、/internalの下に登録した経路に届き、引き継いだIPアドレスを送信元として使う', async () => {
    configureRecordingLogs();

    const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`, {
      headers: internalHeaders('client'),
    });

    expect(response.status).toBe(200);
    expect(await response.json<EchoResponse>()).toStrictEqual({
      caller: 'client',
      clientIp: RELAYED_IP,
    });
    expect(handledPaths).toStrictEqual(['/internal/echo']);
  });

  test.each([
    ['呼び出し元のヘッダーが無い', {}],
    ['呼び出し元の種類に無い値を名乗る', { [GATEWAY_HEADERS.caller]: 'root' }],
  ])(
    '外部経路の要求(%s)は、経路を実行せずに共通のエラー形式の404で応答する',
    async (_label, headers: Record<string, string>) => {
      configureRecordingLogs();

      const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`, {
        headers: { ...headers, [GATEWAY_HEADERS.clientIp]: RELAYED_IP },
      });

      expect(response.status).toBe(NOT_FOUND_RESPONSE.status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
      expect(handledPaths).toStrictEqual([]);
    },
  );

  test('外部経路では、未登録の経路も登録した経路と同じ404で応答し、経路の存在を明かさない', async () => {
    configureRecordingLogs();

    const registered = await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`);
    const unregistered = await invoke(`${INTERNAL_ROUTE_PREFIX}/unknown`);
    const prefixOnly = await invoke(INTERNAL_ROUTE_PREFIX);

    for (const response of [registered, unregistered, prefixOnly]) {
      expect(response.status).toBe(NOT_FOUND_RESPONSE.status);
      expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    }
  });

  test('内部経路でも、未登録の経路は共通のエラー形式の404で応答する', async () => {
    configureRecordingLogs();

    const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/unknown`, {
      headers: internalHeaders('admin'),
    });

    expect(response.status).toBe(NOT_FOUND_RESPONSE.status);
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
  });

  test('登録した経路は/internalの下にだけ追加され、/internalの外の経路に影響しない', async () => {
    configureRecordingLogs();

    const response = await invoke('/echo');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('外部経路の経路');
  });

  test.each([
    ['client', 'user'],
    ['admin', 'admin'],
  ] as const)(
    '経路は受け取ったセッションの参照で、呼び出し元(%s)に応じた種類(%s)のセッションを検証できる',
    async (caller, subjectKind) => {
      configureRecordingLogs();

      const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/session`, {
        headers: sessionHeaders(VALID_TOKEN, caller),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual(USER_PRINCIPAL);
      expect(verifiedSubjectKinds).toStrictEqual([subjectKind]);
      expect(handledPaths).toStrictEqual(['/internal/session']);
    },
  );

  test('内部経路で元のクライアントIPアドレスが無ければ、経路を実行し、理由と呼び出し元だけを警告する', async () => {
    const logs = configureRecordingLogs();

    const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`, {
      headers: internalHeaders('admin', null),
    });

    expect(response.status).toBe(200);
    expect((await response.json<EchoResponse>()).clientIp).toBeUndefined();
    expect(clientIpLogs(logs)).toMatchObject([
      { level: 'warning', reason: 'missing', caller: 'admin' },
    ]);
    expect(JSON.stringify(logs)).not.toContain(CONNECTING_IP);
  });

  test('内部経路で元のクライアントIPアドレスが不正なら、経路を実行し、値を含めずに警告する', async () => {
    const logs = configureRecordingLogs();

    const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`, {
      headers: internalHeaders('client', INVALID_IP),
    });

    expect(response.status).toBe(200);
    expect((await response.json<EchoResponse>()).clientIp).toBeUndefined();
    const warnings = clientIpLogs(logs);
    expect(warnings).toMatchObject([
      { level: 'warning', reason: 'invalid', caller: 'client' },
    ]);
    expect(Object.keys(warnings[0] ?? {}).sort()).toStrictEqual([
      'caller',
      'category',
      'correlationId',
      'level',
      'message',
      'reason',
      'time',
    ]);
    expect(JSON.stringify(logs)).not.toContain(INVALID_IP);
    expect(JSON.stringify(logs)).not.toContain(CONNECTING_IP);
  });

  test('内部経路で元のクライアントIPアドレスが正しければ警告しない', async () => {
    const logs = configureRecordingLogs();

    await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`, {
      headers: internalHeaders('client'),
    });

    expect(clientIpLogs(logs)).toStrictEqual([]);
    expect(JSON.stringify(logs)).not.toContain(RELAYED_IP);
  });

  test('外部経路の要求は、元のクライアントIPアドレスが無くても警告しない', async () => {
    const logs = configureRecordingLogs();

    await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`);

    expect(clientIpLogs(logs)).toStrictEqual([]);
  });
});

describe('createInternalRoutesModule(応答の後処理)', () => {
  test.each([
    ['正常な応答', '/session', 200],
    ['未ログインの共通エラー', '/session/required', 401],
    ['その他の共通エラー', '/session/rejected', 403],
    ['想定外の例外', '/session/crashed', 500],
  ] as const)(
    '経路が%sで終えても、無効なセッションの削除の指示とキャッシュの禁止を応答に付ける',
    async (_label, path, status) => {
      configureRecordingLogs();

      const response = await invoke(`${INTERNAL_ROUTE_PREFIX}${path}`, {
        headers: sessionHeaders(INVALID_TOKEN),
      });

      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(sessionInstructionHeaders(response)).toStrictEqual({
        issue: null,
        maxAge: null,
        clear: '1',
      });
      expect(handledPaths).toStrictEqual([`${INTERNAL_ROUTE_PREFIX}${path}`]);
    },
  );

  test.each([
    ['正常な応答', '/session', 200],
    ['共通エラー', '/session/rejected', 403],
    ['想定外の例外', '/session/crashed', 500],
  ] as const)(
    '経路が%sで終えても、セッションの更新の発行の指示を応答に付ける',
    async (_label, path, status) => {
      configureRecordingLogs();

      const response = await invoke(`${INTERNAL_ROUTE_PREFIX}${path}`, {
        headers: sessionHeaders(RENEWING_TOKEN),
      });

      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(sessionInstructionHeaders(response)).toStrictEqual({
        issue: RENEWAL.token,
        maxAge: String(RENEWAL.maxAgeSeconds),
        clear: null,
      });
    },
  );

  test.each([
    ['403の共通エラー', '/session/rejected', 403, 'forbidden', null],
    [
      '429の共通エラー',
      '/session/limited',
      429,
      'rate_limited',
      String(RETRY_AFTER_SECONDS),
    ],
  ] as const)(
    '経路が%sで終えても、作り直した応答は元の形式・エラーコード・再試行の待ち時間を保つ',
    async (_label, path, status, code, retryAfter) => {
      configureRecordingLogs();

      const response = await invoke(`${INTERNAL_ROUTE_PREFIX}${path}`, {
        headers: sessionHeaders(INVALID_TOKEN),
      });

      expect(response.status).toBe(status);
      expect(response.headers.get('Content-Type')).toMatch(
        /^application\/json\b/,
      );
      expect(response.headers.get('Retry-After')).toBe(retryAfter);
      expect(response.headers.get(SESSION_RESPONSE_HEADERS.clear)).toBe('1');
      expect(
        (await response.json<{ error: { code: string } }>()).error.code,
      ).toBe(code);
    },
  );

  test('経路が付けたキャッシュの指定も、キャッシュの禁止に置き換える', async () => {
    configureRecordingLogs();

    const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/session/cached`, {
      headers: sessionHeaders(VALID_TOKEN),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(USER_PRINCIPAL);
  });

  test('セッションを参照しない経路は検証を呼ばず、指示を付けずにキャッシュの禁止だけを付ける', async () => {
    configureRecordingLogs();

    const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/echo`, {
      headers: sessionHeaders(INVALID_TOKEN),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(sessionInstructionHeaders(response)).toStrictEqual({
      issue: null,
      maxAge: null,
      clear: null,
    });
    expect(verifiedSubjectKinds).toStrictEqual([]);
  });

  test('外部経路の404は、セッションを検証せず、/internalの外の未登録の経路の404と同じヘッダーで応答する', async () => {
    configureRecordingLogs();
    const headers = { [GATEWAY_HEADERS.sessionToken]: INVALID_TOKEN };

    const registered = await invoke(`${INTERNAL_ROUTE_PREFIX}/session`, {
      headers,
    });
    const outside = await invoke('/unregistered', { headers });

    expect(registered.status).toBe(NOT_FOUND_RESPONSE.status);
    expect(headerNames(registered)).toStrictEqual(headerNames(outside));
    expect(sessionInstructionHeaders(registered)).toStrictEqual({
      issue: null,
      maxAge: null,
      clear: null,
    });
    expect(verifiedSubjectKinds).toStrictEqual([]);
    expect(handledPaths).toStrictEqual([]);
  });
});

describe('warnOnMissingClientIp', () => {
  test.each([
    ['無い', 'missing', null],
    ['空文字列', 'invalid', ''],
    ['複数の値', 'invalid', `${RELAYED_IP}, ${CONNECTING_IP}`],
  ] as const)(
    '内部経路で元のクライアントIPアドレスが%sなら、理由%sで警告する',
    (_label, reason, clientIp) => {
      const logs = configureRecordingLogs();

      warnOnMissingClientIp(
        new Request(`${BASE_URL}/internal/echo`, {
          headers: internalHeaders('client', clientIp),
        }),
      );

      expect(clientIpLogs(logs)).toMatchObject([
        { level: 'warning', reason, caller: 'client' },
      ]);
      expect(JSON.stringify(logs)).not.toContain(RELAYED_IP);
    },
  );

  test('呼び出し元のヘッダーが無い要求では警告しない', () => {
    const logs = configureRecordingLogs();

    warnOnMissingClientIp(new Request(`${BASE_URL}/internal/echo`));

    expect(clientIpLogs(logs)).toStrictEqual([]);
  });
});
