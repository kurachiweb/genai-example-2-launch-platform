import { createRoute, z } from '@hono/zod-openapi';
import { describe, expect, test } from 'vitest';

import {
  decodeCursor,
  encodeCursor,
} from '../../../../../lib/core/pagination/opaque-cursor.ts';
import { createPublicApiRestHarness } from '../../../../../test/support/public-api-rest-harness.ts';
import type { PublicRestRoutes } from '../../public-api-app.ts';
import { cursorListEnvelope, errorResponses } from '../../responses.ts';
import {
  CursorQuerySchema,
  PUBLIC_API_CURSOR_MAX,
  publicApiCursorOf,
} from './common.ts';

const positionSchema = z.object({ id: z.string() });

const cursorRoute = createRoute({
  method: 'get',
  path: '/test/cursor-items',
  request: { query: CursorQuerySchema },
  responses: {
    200: {
      description: 'カーソルの位置',
      content: {
        'application/json': {
          schema: cursorListEnvelope(z.object({ after: z.string() })),
        },
      },
    },
    ...errorResponses([400]),
  },
});

const testRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(cursorRoute, (c) => {
    const cursor = publicApiCursorOf(c.req.valid('query').cursor);
    const position =
      cursor === undefined ? undefined : decodeCursor(positionSchema, cursor);
    return c.json(
      {
        data: position === undefined ? [] : [{ after: position.id }],
        meta: { has_next: false, next_cursor: null },
      },
      200,
    );
  });
};

const harness = createPublicApiRestHarness([testRoutes]);

// {"id":"a"}をbase64urlで符号化した値
const VALID_CURSOR = 'eyJpZCI6ImEifQ';

describe('カーソルの経路の不正なカーソル', () => {
  test('省略と正しい値は処理する', async () => {
    const first = await harness.request('/test/cursor-items');
    const next = await harness.request(
      `/test/cursor-items?cursor=${VALID_CURSOR}`,
    );

    expect(first.status).toBe(200);
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ data: [{ after: 'a' }] });
  });

  test.each([
    ['空の値', ''],
    [
      '復号できる形で上限を超える長さ',
      encodeCursor({ id: 'a'.repeat(PUBLIC_API_CURSOR_MAX) }),
    ],
    ['復号できない値', '!!'],
  ])(
    '%sは共通のエラー形式の400のinvalid_cursorにする',
    async (_label, cursor) => {
      const response = await harness.request(
        `/test/cursor-items?cursor=${encodeURIComponent(cursor)}`,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: 'invalid_cursor',
          message: 'ページの位置の指定が正しくありません。',
        },
      });
    },
  );
});
