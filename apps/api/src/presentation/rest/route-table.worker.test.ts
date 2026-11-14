import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  createPublicApiApp,
  type PublicApiApp,
  registerApiKeySecurityScheme,
} from './public-api-app.ts';
import { createRouteTable } from './route-table.ts';

type TestEnv = typeof env;

type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options';

const itemParams = z.object({ itemId: z.string() });

function registerRoute(
  api: PublicApiApp<TestEnv>,
  method: RouteMethod,
  path: string,
  options: { readonly hide?: boolean } = {},
): void {
  api.openapi(
    createRoute({
      method,
      path,
      hide: options.hide,
      responses: { 204: { description: '内容なし' } },
    }),
    (c) => c.body(null, 204),
  );
}

function createItemsApp(): PublicApiApp<TestEnv> {
  const api = createPublicApiApp<TestEnv>();
  registerRoute(api, 'get', '/items');
  registerRoute(api, 'post', '/items');
  api.openapi(
    createRoute({
      method: 'get',
      path: '/items/{itemId}',
      request: { params: itemParams },
      responses: { 204: { description: '内容なし' } },
    }),
    (c) => c.body(null, 204),
  );
  registerRoute(api, 'delete', '/items/{itemId}');
  registerRoute(api, 'patch', '/items/{itemId}');
  registerRoute(api, 'put', '/items/{itemId}/tags/{tag}');
  return api;
}

describe('createRouteTable', () => {
  test('登録済みの経路のメソッドを、基準パスを含むパスに対して決まった順で返す', () => {
    const table = createRouteTable(createItemsApp());

    expect(table.methodsFor('/v1/items')).toStrictEqual(['GET', 'POST']);
  });

  test('パスの変数は1つの区切りの任意の値に一致する', () => {
    const table = createRouteTable(createItemsApp());

    expect(table.methodsFor('/v1/items/item-1')).toStrictEqual([
      'GET',
      'PATCH',
      'DELETE',
    ]);
    expect(table.methodsFor('/v1/items/%E5%95%86%E5%93%81')).toStrictEqual([
      'GET',
      'PATCH',
      'DELETE',
    ]);
    expect(table.methodsFor('/v1/items/item-1/tags/new')).toStrictEqual([
      'PUT',
    ]);
  });

  test('パスの変数は空の値や複数の区切りには一致しない', () => {
    const table = createRouteTable(createItemsApp());

    expect(table.methodsFor('/v1/items/')).toStrictEqual([]);
    expect(table.methodsFor('/v1/items//tags/new')).toStrictEqual([]);
    expect(table.methodsFor('/v1/items/item-1/extra')).toStrictEqual([]);
    expect(table.methodsFor('/v1/items/a/b/tags/new')).toStrictEqual([]);
  });

  test('同じパスに一致する複数の経路があれば、メソッドを重複なく合わせる', () => {
    const api = createItemsApp();
    registerRoute(api, 'post', '/items/export');
    registerRoute(api, 'get', '/items/export');
    const table = createRouteTable(api);

    expect(table.methodsFor('/v1/items/export')).toStrictEqual([
      'GET',
      'POST',
      'PATCH',
      'DELETE',
    ]);
  });

  test('仕様の経路はGETとして表に含める', () => {
    const table = createRouteTable(createPublicApiApp<TestEnv>());

    expect(table.methodsFor('/v1/openapi.json')).toStrictEqual(['GET']);
  });

  test('パスの文字は正規表現としてではなく文字どおりに照合する', () => {
    const api = createPublicApiApp<TestEnv>();
    registerRoute(api, 'get', '/reports/summary.csv');
    const table = createRouteTable(api);

    expect(table.methodsFor('/v1/reports/summary.csv')).toStrictEqual(['GET']);
    expect(table.methodsFor('/v1/reports/summaryXcsv')).toStrictEqual([]);
    expect(table.methodsFor('/v1/openapiXjson')).toStrictEqual([]);
  });

  test('未登録のパスと基準パスの外のパスでは空を返す', () => {
    const table = createRouteTable(createItemsApp());

    expect(table.methodsFor('/v1/unknown')).toStrictEqual([]);
    expect(table.methodsFor('/v1')).toStrictEqual([]);
    expect(table.methodsFor('/items')).toStrictEqual([]);
    expect(table.methodsFor('/v10/items')).toStrictEqual([]);
    expect(table.methodsFor('/health')).toStrictEqual([]);
  });

  test('OPTIONSの経路・仕様から隠した経路・経路以外の登録はメソッドに含めない', () => {
    const api = createPublicApiApp<TestEnv>();
    registerApiKeySecurityScheme(api);
    registerRoute(api, 'options', '/items');
    registerRoute(api, 'get', '/hidden', { hide: true });
    const table = createRouteTable(api);

    expect(table.methodsFor('/v1/items')).toStrictEqual([]);
    expect(table.methodsFor('/v1/hidden')).toStrictEqual([]);
  });

  test('子のアプリとして加えた経路も、加えた位置のパスで表に含める', () => {
    const api = createPublicApiApp<TestEnv>();
    const products = new OpenAPIHono<PlatformHonoEnv<TestEnv>>();
    products.openapi(
      createRoute({
        method: 'post',
        path: '/{productId}/votes',
        responses: { 204: { description: '内容なし' } },
      }),
      (c) => c.body(null, 204),
    );
    api.route('/products', products);
    const table = createRouteTable(api);

    expect(table.methodsFor('/v1/products/p-1/votes')).toStrictEqual(['POST']);
  });

  test('作った時点で登録済みの経路から表を作る', () => {
    const api = createItemsApp();
    const table = createRouteTable(api);
    registerRoute(api, 'get', '/later');

    expect(table.methodsFor('/v1/later')).toStrictEqual([]);
  });

  test('返すメソッドの一覧は変更できない', () => {
    const table = createRouteTable(createItemsApp());

    expect(Object.isFrozen(table.methodsFor('/v1/items'))).toBe(true);
    expect(Object.isFrozen(table.methodsFor('/v1/unknown'))).toBe(true);
  });
});
