import { resetSync } from '@logtape/logtape';
import { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import { resolveConnectingIp } from '../rate-limit/client-ip.ts';
import { invocationContext } from './invocation-context.ts';

interface ContextHonoEnv {
  Variables: {
    correlationId: string;
    clientIp: string | undefined;
  };
}

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly correlationId?: string;
  readonly [property: string]: unknown;
}

interface ContextBody {
  readonly correlationId: string;
  readonly clientIp: string | null;
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const CLIENT_IP = '198.51.100.61';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const handlerLogger = getAppLogger(['event', 'application', 'context-test']);

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
    appName: 'event',
    level: 'debug',
    console: methods as unknown as Console,
  });
  return logs;
}

function createApp(): Hono<ContextHonoEnv> {
  const app = new Hono<ContextHonoEnv>();
  app.use(
    invocationContext({
      appName: 'event',
      resolveClientIp: resolveConnectingIp,
    }),
  );
  app.get('/context', async (c) => {
    await scheduler.wait(1);
    handlerLogger.info('処理中です');
    return c.json({
      correlationId: c.get('correlationId'),
      clientIp: c.get('clientIp') ?? null,
    });
  });
  app.get('/failure', () => {
    throw new Error('想定外の失敗です');
  });
  app.onError((_, c) => c.json({ error: 'internal' }, 500));
  return app;
}

function accessLogs(logs: readonly LoggedObject[]): LoggedObject[] {
  return logs.filter((log) => log.category === 'event.http.access');
}

afterAll(() => {
  resetSync();
});

describe('invocationContext', () => {
  test('相関IDを採番し、解決したクライアントIPとともに文脈変数へ入れる', async () => {
    configureRecordingLogs();
    const app = createApp();

    const first = await app.request('/context', {
      headers: { 'CF-Connecting-IP': CLIENT_IP },
    });
    const second = await app.request('/context');
    const firstBody = await first.json<ContextBody>();
    const secondBody = await second.json<ContextBody>();

    expect(firstBody.correlationId).toMatch(UUID_PATTERN);
    expect(firstBody.clientIp).toBe(CLIENT_IP);
    expect(secondBody.correlationId).toMatch(UUID_PATTERN);
    expect(secondBody.correlationId).not.toBe(firstBody.correlationId);
    expect(secondBody.clientIp).toBeNull();
  });

  test('処理中のログとアクセスログに同じ相関IDを付け、アクセスログにはクエリ文字列とIPを含めない', async () => {
    const logs = configureRecordingLogs();

    const response = await createApp().request(
      '/context?token=abc&ip=203.0.113.9',
      { headers: { 'CF-Connecting-IP': CLIENT_IP } },
    );
    const { correlationId } = await response.json<ContextBody>();

    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ message: '処理中です', correlationId });
    const [accessLog] = accessLogs(logs) as [LoggedObject];
    expect(accessLog).toMatchObject({
      level: 'info',
      message: 'HTTPリクエストを処理しました',
      correlationId,
      method: 'GET',
      path: '/context',
      status: 200,
    });
    expect(accessLog.durationMs).toBeGreaterThanOrEqual(1);
    expect(Object.keys(accessLog).toSorted()).toStrictEqual(
      [
        'time',
        'level',
        'category',
        'message',
        'correlationId',
        'method',
        'path',
        'status',
        'durationMs',
      ].toSorted(),
    );
    expect(JSON.stringify(logs)).not.toContain(CLIENT_IP);
    expect(JSON.stringify(logs)).not.toContain('203.0.113.9');
  });

  test('例外を変換した応答の状態コードと、HEADのメソッドを記録する', async () => {
    const logs = configureRecordingLogs();
    const app = createApp();

    await app.request('/failure');
    await app.request('/context', { method: 'HEAD' });

    expect(accessLogs(logs)).toMatchObject([
      { method: 'GET', path: '/failure', status: 500 },
      { method: 'HEAD', path: '/context', status: 200 },
    ]);
  });
});
