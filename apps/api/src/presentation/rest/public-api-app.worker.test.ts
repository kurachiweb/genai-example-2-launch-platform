import { createRoute, z } from '@hono/zod-openapi';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, test } from 'vitest';

import {
  createErrorHandler,
  handleNotFound,
} from '../../../lib/workers/http/error-handler.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { INTERNAL_ERROR_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  API_KEY_SECURITY,
  API_KEY_SECURITY_SCHEME,
  createPublicApiApp,
  OPENAPI_DOCUMENT_PATH,
  PUBLIC_API_BASE_PATH,
  type PublicApiApp,
  type PublicRestRoutes,
  registerApiKeySecurityScheme,
} from './public-api-app.ts';

type TestEnv = typeof env;

interface HandledItem {
  readonly title: string;
  readonly tags: readonly string[];
  readonly page: number;
}

const BASE_URL = 'https://api.launch.example';
const VALIDATION_MESSAGE = '入力内容を確認してください。';
const DOCUMENT_INFO = { title: 'テスト用の公開API', version: '0.0.1' };

const itemInput = z.object({
  title: z.string().min(1).max(5),
  tags: z.array(z.string().max(3)),
});

const itemQuery = z.object({
  page: z.coerce.number().int().min(1),
});

const createItemRoute = createRoute({
  method: 'post',
  path: '/items',
  request: {
    query: itemQuery,
    body: {
      required: true,
      content: { 'application/json': { schema: itemInput } },
    },
  },
  responses: {
    201: {
      description: '作成した項目',
      content: {
        'application/json': { schema: z.object({ data: itemInput }) },
      },
    },
  },
});

const securedRoute = createRoute({
  method: 'get',
  path: '/secured',
  security: [...API_KEY_SECURITY],
  responses: { 204: { description: '内容なし' } },
});

function createHandledItems(): HandledItem[] {
  return [];
}

function registerTestRoutes(handled: HandledItem[]): PublicRestRoutes<TestEnv> {
  return (api) => {
    api.openapi(createItemRoute, (c) => {
      const body = c.req.valid('json');
      handled.push({ ...body, page: c.req.valid('query').page });
      return c.json({ data: body }, 201);
    });
  };
}

function mountOnPlatformApp(
  api: PublicApiApp<TestEnv>,
): Hono<PlatformHonoEnv<TestEnv>> {
  const app = new Hono<PlatformHonoEnv<TestEnv>>();
  app.route(PUBLIC_API_BASE_PATH, api);
  app.notFound(handleNotFound);
  app.onError(createErrorHandler('api'));
  return app;
}

function createTestApp(handled: HandledItem[]): Hono<PlatformHonoEnv<TestEnv>> {
  const api = createPublicApiApp<TestEnv>();
  registerTestRoutes(handled)(api);
  return mountOnPlatformApp(api);
}

async function postItem(
  app: Hono<PlatformHonoEnv<TestEnv>>,
  query: string,
  body: unknown,
): Promise<Response> {
  return app.request(
    `${BASE_URL}${PUBLIC_API_BASE_PATH}/items${query}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

interface ObservedApp {
  readonly app: Hono<PlatformHonoEnv<TestEnv>>;
  readonly observedErrors: unknown[];
}

const failingRoute = createRoute({
  method: 'get',
  path: '/failing',
  responses: { 204: { description: '内容なし' } },
});

const httpExceptionRoute = createRoute({
  method: 'get',
  path: '/http-exception',
  responses: { 204: { description: '内容なし' } },
});

// 基盤のSentryのミドルウェアと同じく、外側のミドルウェアから見える例外を記録する
function createObservedApp(handled: HandledItem[]): ObservedApp {
  const observedErrors: unknown[] = [];
  const api = createPublicApiApp<TestEnv>();
  registerTestRoutes(handled)(api);
  api.openapi(failingRoute, () => {
    throw new Error('想定外の失敗');
  });
  api.openapi(httpExceptionRoute, () => {
    throw new HTTPException(403);
  });
  const app = new Hono<PlatformHonoEnv<TestEnv>>();
  app.use(async (c, next) => {
    await next();
    observedErrors.push(c.error);
  });
  app.route(PUBLIC_API_BASE_PATH, api);
  app.notFound(handleNotFound);
  app.onError(createErrorHandler('api'));
  return { app, observedErrors };
}

async function postRawItem(
  app: Hono<PlatformHonoEnv<TestEnv>>,
  headers: Record<string, string>,
  body: string,
): Promise<Response> {
  return app.request(
    `${BASE_URL}${PUBLIC_API_BASE_PATH}/items?page=1`,
    { method: 'POST', headers, body },
    env,
  );
}

describe('公開APIの基準パスと仕様の経路', () => {
  test('基準パスはヘルスチェックと衝突しない版付きの/v1である', () => {
    expect(PUBLIC_API_BASE_PATH).toBe('/v1');
  });

  test('仕様の経路は基準パスからの相対の/openapi.jsonである', () => {
    expect(OPENAPI_DOCUMENT_PATH).toBe('/openapi.json');
  });
});

describe('createPublicApiAppの検証の失敗', () => {
  test('本文が検証規則に合わなければ400と項目ごとの詳細の共通のエラー形式で応答し、経路の処理を呼ばない', async () => {
    const handled = createHandledItems();
    const app = createTestApp(handled);

    const response = await postItem(app, '?page=1', {
      title: '',
      tags: ['abc', 'abcd'],
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'validation_error',
        message: VALIDATION_MESSAGE,
        details: [
          {
            field: 'title',
            code: 'too_small',
            message: expect.any(String) as string,
          },
          {
            field: 'tags.1',
            code: 'too_big',
            message: expect.any(String) as string,
          },
        ],
      },
    });
    expect(handled).toStrictEqual([]);
  });

  test('クエリが検証規則に合わなければ400と項目ごとの詳細の共通のエラー形式で応答する', async () => {
    const handled = createHandledItems();
    const app = createTestApp(handled);

    const response = await postItem(app, '?page=0', { title: 'abc', tags: [] });

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'validation_error',
        message: VALIDATION_MESSAGE,
        details: [
          {
            field: 'page',
            code: 'too_small',
            message: expect.any(String) as string,
          },
        ],
      },
    });
    expect(handled).toStrictEqual([]);
  });

  test('本文の最上位が検証規則に合わなければ項目のパスを空にする', async () => {
    const app = createTestApp(createHandledItems());

    const response = await postItem(app, '?page=1', ['not-an-object']);

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'validation_error',
        message: VALIDATION_MESSAGE,
        details: [
          {
            field: '',
            code: 'invalid_type',
            message: expect.any(String) as string,
          },
        ],
      },
    });
  });

  test('検証規則に合えば検証後の値で経路の処理を呼ぶ', async () => {
    const handled = createHandledItems();
    const app = createTestApp(handled);

    const response = await postItem(app, '?page=2', {
      title: 'abc',
      tags: ['x'],
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toStrictEqual({
      data: { title: 'abc', tags: ['x'] },
    });
    expect(handled).toStrictEqual([{ title: 'abc', tags: ['x'], page: 2 }]);
  });

  test('作るたびに経路の登録を共有しない別のアプリを返す', () => {
    const first = createPublicApiApp<TestEnv>();
    const second = createPublicApiApp<TestEnv>();
    registerTestRoutes(createHandledItems())(first);

    const document = second.getOpenAPI31Document({
      openapi: '3.1.0',
      info: DOCUMENT_INFO,
    });

    expect(first).not.toBe(second);
    expect(document.paths).toStrictEqual({});
  });
});

describe('APIキーによるBearer認証の方式の宣言', () => {
  test('認証方式の名前と経路に付ける要件を定数で提供する', () => {
    expect(API_KEY_SECURITY_SCHEME).toBe('ApiKeyAuth');
    expect(API_KEY_SECURITY).toStrictEqual([{ ApiKeyAuth: [] }]);
    expect(Object.isFrozen(API_KEY_SECURITY)).toBe(true);
  });

  test('登録するとOpenAPI仕様にBearer認証の方式が現れ、経路の要件から参照できる', () => {
    const api = createPublicApiApp<TestEnv>();
    registerApiKeySecurityScheme(api);
    api.openapi(securedRoute, (c) => c.body(null, 204));

    const document = api.getOpenAPI31Document({
      openapi: '3.1.0',
      info: DOCUMENT_INFO,
    });

    expect(document.components?.securitySchemes).toStrictEqual({
      ApiKeyAuth: { type: 'http', scheme: 'bearer' },
    });
    expect(document.paths?.['/secured']?.get?.security).toStrictEqual([
      { ApiKeyAuth: [] },
    ]);
  });

  test('登録しなければOpenAPI仕様に認証方式は現れない', () => {
    const api = createPublicApiApp<TestEnv>();

    const document = api.getOpenAPI31Document({
      openapi: '3.1.0',
      info: DOCUMENT_INFO,
    });

    expect(document.components?.securitySchemes).toBeUndefined();
  });
});

describe('createPublicApiAppの本文の形式の誤り', () => {
  test.each([
    ['形式の誤ったJSON', '{bad'],
    ['空の本文', ''],
  ])(
    '%sは400と項目ごとの詳細の共通のエラー形式で応答し、経路の処理を呼ばず、外側からはAppErrorに見える',
    async (_label, body) => {
      const handled = createHandledItems();
      const { app, observedErrors } = createObservedApp(handled);

      const response = await postRawItem(
        app,
        { 'Content-Type': 'application/json' },
        body,
      );

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toStrictEqual({
        error: {
          code: 'validation_error',
          message: VALIDATION_MESSAGE,
          details: [
            {
              field: '',
              code: 'invalid_json',
              message: '本文をJSONとして解析できません。',
            },
          ],
        },
      });
      expect(handled).toStrictEqual([]);
      expect(observedErrors).toHaveLength(1);
      expect(observedErrors[0]).toBeInstanceOf(AppError);
    },
  );

  test.each([
    ['text/plainのContent-Type', { 'Content-Type': 'text/plain' }],
    ['Content-Typeの無い本文', {}],
  ])(
    '%sは415とunsupported_media_typeの共通のエラー形式で応答し、経路の処理を呼ばず、外側からはAppErrorに見える',
    async (_label, headers: Record<string, string>) => {
      const handled = createHandledItems();
      const { app, observedErrors } = createObservedApp(handled);

      const response = await postRawItem(
        app,
        headers,
        JSON.stringify({ title: 'abc', tags: [] }),
      );

      expect(response.status).toBe(415);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toStrictEqual({
        error: {
          code: 'unsupported_media_type',
          message: 'Content-Typeにapplication/jsonを指定してください。',
        },
      });
      expect(handled).toStrictEqual([]);
      expect(observedErrors).toHaveLength(1);
      expect(observedErrors[0]).toBeInstanceOf(AppError);
    },
  );

  test.each([
    ['通常の例外', '/failing', Error],
    ['400・415以外のHTTPException', '/http-exception', HTTPException],
  ])(
    '想定外の例外(%s)は500のinternal_errorのままで、外側からは元の例外に見える',
    async (_label, path, errorClass) => {
      const { app, observedErrors } = createObservedApp(createHandledItems());

      const response = await app.request(
        `${BASE_URL}${PUBLIC_API_BASE_PATH}${path}`,
        {},
        env,
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
      expect(observedErrors).toHaveLength(1);
      expect(observedErrors[0]).not.toBeInstanceOf(AppError);
      expect(observedErrors[0]).toBeInstanceOf(errorClass);
    },
  );

  test('検証規則に合う要求では外側から例外は見えない', async () => {
    const { app, observedErrors } = createObservedApp(createHandledItems());

    const response = await postItem(app, '?page=1', {
      title: 'abc',
      tags: [],
    });

    expect(response.status).toBe(201);
    expect(observedErrors).toStrictEqual([undefined]);
  });
});
