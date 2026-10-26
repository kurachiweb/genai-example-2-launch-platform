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
  type SessionVerifier,
} from '../../application/session/session-verifier.ts';
import { type CallerKind, GATEWAY_HEADERS } from './gateway-headers.ts';
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
import { createSessionAccess } from './session-access.ts';

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
const SESSION_TOKEN = `sess${'0123456789'.repeat(3)}abcdefghi`;

const USER_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JBUSER000000000000000000',
  sessionId: '01JBSESSION000000000000000',
});

const handledPaths: string[] = [];

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
  app.post('/session', async (c) => {
    handledPaths.push(c.req.path);
    const caller = readInternalCaller(c.req.raw);
    if (caller === undefined) {
      throw new Error('内部経路の呼び出し元がありません');
    }
    const access = createSessionAccess({
      container: c.get('container'),
      caller,
      token: c.req.header(GATEWAY_HEADERS.sessionToken),
    });
    return c.json(await access.principal());
  });
};

const outsideRoutesModule: AppModule<TestApp> = {
  name: 'outside-test',
  bindings: new ContainerModule(({ bind }) => {
    bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).toConstantValue({
      verify: () =>
        Promise.resolve({ status: 'valid', principal: USER_PRINCIPAL }),
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

async function invoke(
  path: string,
  options: InvokeOptions = {},
): Promise<Response> {
  handledPaths.length = 0;
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

  test('経路のハンドラーは、処理単位のコンテナと呼び出し元からセッションの検証を呼べる', async () => {
    configureRecordingLogs();

    const response = await invoke(`${INTERNAL_ROUTE_PREFIX}/session`, {
      method: 'POST',
      headers: {
        ...internalHeaders('client'),
        [GATEWAY_HEADERS.sessionToken]: SESSION_TOKEN,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(USER_PRINCIPAL);
    expect(handledPaths).toStrictEqual(['/internal/session']);
  });

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
