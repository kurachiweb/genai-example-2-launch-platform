import { createRoute, z } from '@hono/zod-openapi';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
  toErrorResponse,
} from '../../../lib/core/errors/error-envelope.ts';
import { createPublicApiApp } from './public-api-app.ts';
import {
  cursorListEnvelope,
  dataEnvelope,
  ERROR_STATUSES,
  ErrorEnvelopeSchema,
  errorResponses,
  offsetListEnvelope,
} from './responses.ts';

type TestEnv = typeof env;

const DOCUMENT_INFO = { title: 'テスト用の公開API', version: '0.0.1' };
const ERROR_ENVELOPE_REF = { $ref: '#/components/schemas/ErrorEnvelope' };

const product = z.object({ id: z.string(), vote_count: z.int() });

const ITEM = { id: 'p1', vote_count: 3 };

function jsonResponse(schema: z.ZodType, description: string) {
  return { description, content: { 'application/json': { schema } } };
}

const getProductRoute = createRoute({
  method: 'get',
  path: '/products/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonResponse(dataEnvelope(product), '製品'),
    ...errorResponses([400, 404]),
  },
});

const listProductsRoute = createRoute({
  method: 'get',
  path: '/products',
  responses: {
    200: jsonResponse(offsetListEnvelope(product), '製品の一覧'),
    ...errorResponses([400]),
  },
});

const feedRoute = createRoute({
  method: 'get',
  path: '/feed',
  responses: {
    200: jsonResponse(cursorListEnvelope(product), '新着の製品'),
  },
});

function generateDocument() {
  const api = createPublicApiApp<TestEnv>();
  api.openapi(getProductRoute, (c) => c.json({ data: ITEM }, 200));
  api.openapi(listProductsRoute, (c) =>
    c.json(
      {
        data: [ITEM],
        meta: { total: 1, page: 1, per_page: 20, total_pages: 1 },
      },
      200,
    ),
  );
  api.openapi(feedRoute, (c) =>
    c.json({ data: [], meta: { has_next: false, next_cursor: null } }, 200),
  );
  return api.getOpenAPI31Document({ openapi: '3.1.0', info: DOCUMENT_INFO });
}

function successSchemaOf(
  document: ReturnType<typeof generateDocument>,
  path: string,
): unknown {
  const response = document.paths?.[path]?.get?.responses?.['200'] as
    { content: Record<string, { schema: unknown }> } | undefined;
  return response?.content['application/json']?.schema;
}

describe('成功応答のスキーマ部品', () => {
  test('単体のデータはdataに項目を持つ', () => {
    const schema = dataEnvelope(product);

    expect(schema.parse({ data: ITEM })).toStrictEqual({ data: ITEM });
    expect(schema.safeParse({ item: ITEM }).success).toBe(false);
  });

  test('オフセット型の一覧はdataの配列とmetaのtotal・page・per_page・total_pagesを持つ', () => {
    const schema = offsetListEnvelope(product);
    const body = {
      data: [ITEM],
      meta: { total: 41, page: 2, per_page: 20, total_pages: 3 },
    };

    expect(schema.parse(body)).toStrictEqual(body);
    expect(
      schema.safeParse({ data: [ITEM], meta: { total: 41, page: 2 } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [ITEM],
        meta: { total: -1, page: 0, per_page: 0, total_pages: 1.5 },
      }).success,
    ).toBe(false);
  });

  test('カーソル型の一覧はdataの配列とmetaのhas_next・next_cursorを持ち、最後のページのnext_cursorはnull', () => {
    const schema = cursorListEnvelope(product);
    const nextPage = {
      data: [ITEM],
      meta: { has_next: true, next_cursor: 'eyJpZCI6InAxIn0' },
    };
    const lastPage = { data: [], meta: { has_next: false, next_cursor: null } };

    expect(schema.parse(nextPage)).toStrictEqual(nextPage);
    expect(schema.parse(lastPage)).toStrictEqual(lastPage);
    expect(
      schema.safeParse({ data: [], meta: { has_next: false } }).success,
    ).toBe(false);
  });
});

describe('エラー応答のスキーマ部品', () => {
  test('共通のエラー形式は詳細の有無を問わず基盤の応答の本文に一致する', () => {
    const withDetails = toErrorResponse(
      new AppError({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: [{ field: 'title', code: 'too_big', message: '長すぎます。' }],
      }),
    );

    expect(ErrorEnvelopeSchema.safeParse(withDetails.body).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse(NOT_FOUND_RESPONSE.body).success).toBe(
      true,
    );
    expect(
      ErrorEnvelopeSchema.safeParse(INTERNAL_ERROR_RESPONSE.body).success,
    ).toBe(true);
    expect(
      ErrorEnvelopeSchema.safeParse({ error: { code: 'not_found' } }).success,
    ).toBe(false);
  });

  test('指定した状態コードだけを説明と共通のエラー形式のスキーマ付きで返す', () => {
    const responses = errorResponses([401, 429]);

    expect(Object.keys(responses)).toStrictEqual(['401', '429']);
    expect(responses['401']).toStrictEqual({
      description: expect.any(String) as string,
      content: { 'application/json': { schema: ErrorEnvelopeSchema } },
    });
    expect(responses['401'].description).not.toBe(responses['429'].description);
  });

  test('想定内の失敗の全状態コードに空でない説明がある', () => {
    const responses = errorResponses(ERROR_STATUSES);

    expect(ERROR_STATUSES).toStrictEqual([
      400, 401, 403, 404, 409, 413, 415, 422, 429, 503,
    ]);
    const descriptions = Object.values(responses).map(
      ({ description }) => description,
    );
    expect(descriptions).toHaveLength(ERROR_STATUSES.length);
    expect(new Set(descriptions).size).toBe(ERROR_STATUSES.length);
    expect(descriptions).not.toContain('');
  });
});

describe('OpenAPI仕様への反映', () => {
  test('単体・オフセット型・カーソル型の成功応答のスキーマが現れる', () => {
    const document = generateDocument();
    const item = {
      type: 'object',
      properties: { id: { type: 'string' }, vote_count: { type: 'integer' } },
      required: ['id', 'vote_count'],
    };

    expect(successSchemaOf(document, '/products/{id}')).toMatchObject({
      type: 'object',
      properties: { data: item },
      required: ['data'],
    });
    expect(successSchemaOf(document, '/products')).toMatchObject({
      type: 'object',
      properties: {
        data: { type: 'array', items: item },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'integer', minimum: 0 },
            page: { type: 'integer', minimum: 1 },
            per_page: { type: 'integer', minimum: 1 },
            total_pages: { type: 'integer', minimum: 0 },
          },
          required: ['total', 'page', 'per_page', 'total_pages'],
        },
      },
      required: ['data', 'meta'],
    });
    expect(successSchemaOf(document, '/feed')).toMatchObject({
      type: 'object',
      properties: {
        data: { type: 'array', items: item },
        meta: {
          type: 'object',
          properties: {
            has_next: { type: 'boolean' },
            next_cursor: { type: ['string', 'null'] },
          },
          required: ['has_next', 'next_cursor'],
        },
      },
      required: ['data', 'meta'],
    });
  });

  test('エラー応答は共通のエラー形式の部品を参照し、部品は項目ごとの詳細を任意で持つ', () => {
    const document = generateDocument();
    const responses = document.paths?.['/products/{id}']?.get?.responses;

    expect(Object.keys(responses ?? {})).toStrictEqual(['200', '400', '404']);
    expect(responses?.['404']).toStrictEqual({
      description: expect.any(String) as string,
      content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
    });
    expect(document.components?.schemas?.['ErrorEnvelope']).toMatchObject({
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['field', 'code', 'message'],
              },
            },
          },
          required: ['code', 'message'],
        },
      },
      required: ['error'],
    });
  });
});
