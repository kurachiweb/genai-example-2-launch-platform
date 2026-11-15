import { resetSync } from '@logtape/logtape';
import { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { z } from 'zod';

import { INTERNAL_ERROR_RESPONSE } from '../../core/errors/error-envelope.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import { envGuard } from './env-guard.ts';

interface GuardedEnv {
  readonly REQUIRED_SECRET?: string;
  readonly LOG_LEVEL?: string;
  readonly EXTRA_VALUE?: string;
}

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly [property: string]: unknown;
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const SECRET_VALUE = ['guarded', 'secret', 'value'].join('-');

const schema = z.object({
  REQUIRED_SECRET: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info']),
});

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

function createApp(envSchema: z.ZodType = schema): Hono<{
  Bindings: GuardedEnv;
}> {
  const app = new Hono<{ Bindings: GuardedEnv }>();
  app.use(envGuard({ appName: 'event', envSchema }));
  app.get('/jobs', (c) => c.json({ extra: c.env.EXTRA_VALUE ?? null }));
  app.onError((error, c) => c.json({ handled: error.message }, 500));
  return app;
}

afterAll(() => {
  resetSync();
});

describe('envGuard', () => {
  test('検証に通れば、スキーマに無いキーも残る元の環境のまま次の処理へ進む', async () => {
    const logs = configureRecordingLogs();

    const response = await createApp().request('/jobs', undefined, {
      REQUIRED_SECRET: SECRET_VALUE,
      LOG_LEVEL: 'info',
      EXTRA_VALUE: 'kept',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ extra: 'kept' });
    expect(logs).toStrictEqual([]);
  });

  test('検証に失敗すると、欠けたキーと不正なキーの名前だけをerrorで記録して500の定型で応答する', async () => {
    const logs = configureRecordingLogs();

    const response = await createApp().request('/jobs', undefined, {
      LOG_LEVEL: 'verbose-level',
      EXTRA_VALUE: SECRET_VALUE,
    });

    expect(response.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
    expect(logs).toMatchObject([
      {
        level: 'error',
        category: 'event.http.env',
        missingEnvNames: ['REQUIRED_SECRET'],
        invalidEnvNames: ['LOG_LEVEL'],
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain('verbose-level');
    expect(JSON.stringify(logs)).not.toContain(SECRET_VALUE);
  });

  test('検証の不備以外の例外は記録せずに例外の変換へ渡す', async () => {
    const logs = configureRecordingLogs();
    const broken = z.object({}).refine(() => {
      throw new Error('検証の処理が壊れています');
    });

    const response = await createApp(broken).request('/jobs', undefined, {});

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      handled: '検証の処理が壊れています',
    });
    expect(logs).toStrictEqual([]);
  });
});
