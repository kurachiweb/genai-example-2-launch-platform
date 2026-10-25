import { resetSync } from '@logtape/logtape';
import { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import {
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
} from '../../core/errors/error-envelope.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import { createErrorHandler, handleNotFound } from './error-handler.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly [property: string]: unknown;
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const API_KEY = `lsk_${'ZyXwVuTsRq'.repeat(4)}P_-`;

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

function createApp(): Hono {
  const app = new Hono();
  app.get('/limited', () => {
    throw new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。',
      retryAfterSeconds: 30,
    });
  });
  app.post('/invalid', () => {
    throw new AppError({
      kind: 'bad_request',
      code: 'validation_failed',
      message: '入力内容を確認してください。',
      details: [{ field: 'title', message: '必須です。', code: 'required' }],
    });
  });
  app.get('/unexpected', () => {
    throw new TypeError(`設定の読み込みに失敗しました: ${API_KEY}`);
  });
  app.notFound(handleNotFound);
  app.onError(createErrorHandler('api'));
  return app;
}

afterAll(() => {
  resetSync();
});

describe('createErrorHandler', () => {
  test('共通エラーを対応する状態コード・ヘッダー・共通のエラー形式に変換し、ログを出さない', async () => {
    const logs = configureRecordingLogs();
    const app = createApp();

    const limited = await app.request('/limited');
    const invalid = await app.request('/invalid', { method: 'POST' });

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('30');
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    expect(await limited.json()).toStrictEqual({
      error: { code: 'rate_limit_exceeded', message: '操作が集中しています。' },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toStrictEqual({
      error: {
        code: 'validation_failed',
        message: '入力内容を確認してください。',
        details: [{ field: 'title', message: '必須です。', code: 'required' }],
      },
    });
    expect(logs).toStrictEqual([]);
  });

  test('想定外の例外を内部の詳細を含まない500にし、例外名と伏せ字済みのメッセージをerrorで記録する', async () => {
    const logs = configureRecordingLogs();

    const response = await createApp().request('/unexpected');
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.parse(body)).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
    expect(body).not.toContain('設定の読み込み');
    expect(logs).toMatchObject([
      {
        level: 'error',
        category: 'api.http.error',
        error: {
          name: 'TypeError',
          message: '設定の読み込みに失敗しました: [REDACTED]',
        },
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(API_KEY);
  });
});

describe('handleNotFound', () => {
  test('未登録の経路に404の共通エラー形式を返す', async () => {
    const response = await createApp().request('/missing');

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
  });
});
