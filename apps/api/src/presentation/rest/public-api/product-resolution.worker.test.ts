import { createRoute, z } from '@hono/zod-openapi';
import { beforeEach, describe, expect, test } from 'vitest';

import { PRODUCT_PLATFORM_TYPES } from '../../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../../lib/core/product/ports.ts';
import {
  clearProductTables,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertUser,
  productIdOf,
  T0,
} from '../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  createPublicApiRestHarness,
  createPublicApiTestContainer,
} from '../../../../test/support/public-api-rest-harness.ts';
import type { PublicRestRoutes } from '../public-api-app.ts';
import { dataEnvelope, errorResponses } from '../responses.ts';
import {
  redirectToCurrentHandle,
  resolvePublicProduct,
} from './product-resolution.ts';
import { publicApiError } from './public-api-errors.ts';

const OWNER = 1;
const SUSPENDED_OWNER = 2;

const LISTED = 1;
const UNLISTED = 2;
const HIDDEN = 3;
const DELETED = 4;
const SUSPENDED_OWNERS = 5;

const resolvedSchema = z.object({ product_id: z.string() });

const launchesRoute = createRoute({
  method: 'get',
  path: '/test/products/{handle}/launches',
  request: {
    params: z.object({ handle: z.string() }),
    query: z.object({ cursor: z.string().optional() }),
  },
  responses: {
    200: {
      description: '解決したプロダクト',
      content: { 'application/json': { schema: dataEnvelope(resolvedSchema) } },
    },
    302: { description: '現在のハンドルへの転送' },
    ...errorResponses([404]),
  },
});

const testRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(launchesRoute, async (c) => {
    const resolution = await resolvePublicProduct(
      c
        .get('container')
        .get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory),
      c.req.valid('param').handle,
    );
    switch (resolution.kind) {
      case 'current': {
        return c.json(
          { data: { product_id: resolution.product.productId } },
          200,
        );
      }
      case 'redirect': {
        return redirectToCurrentHandle(c, resolution.handle);
      }
      case 'not-found': {
        throw publicApiError('product_not_found');
      }
    }
  });
};

const harness = createPublicApiRestHarness([testRoutes]);

function createProductDirectory(): ProductDirectory {
  return createPublicApiTestContainer().get<ProductDirectory>(
    PRODUCT_PLATFORM_TYPES.ProductDirectory,
  );
}

async function insertListedProduct(
  index: number,
  ownerIndex: number,
  columns: Parameters<typeof insertProduct>[2] = {},
): Promise<void> {
  await insertProduct(index, ownerIndex, columns);
  await insertLaunch(index, index, { outcome: 'won', decidedAt: T0 });
}

async function expectProductNotFound(path: string): Promise<void> {
  const response = await harness.request(path);
  expect(response.status).toBe(404);
  expect(response.headers.get('Location')).toBeNull();
  expect(await response.json()).toMatchObject({
    error: { code: 'product_not_found' },
  });
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER, { handle: 'owner' });
  await insertUser(SUSPENDED_OWNER, {
    handle: 'suspended',
    emailVerifiedAt: T0,
    status: 'suspended',
    suspendedAt: T0,
  });
  await insertListedProduct(LISTED, OWNER, { handle: 'Alpha' });
  await insertProductPreviousHandle(1, LISTED, 'old-alpha');
  await insertProduct(UNLISTED, OWNER, { handle: 'Beta' });
  await insertProductPreviousHandle(2, UNLISTED, 'old-beta');
  await insertListedProduct(HIDDEN, OWNER, { handle: 'Gamma', hiddenAt: T0 });
  await insertProductPreviousHandle(3, HIDDEN, 'old-gamma');
  await insertListedProduct(DELETED, OWNER, {
    handle: 'Delta',
    deletedAt: T0,
  });
  await insertListedProduct(SUSPENDED_OWNERS, SUSPENDED_OWNER, {
    handle: 'Epsilon',
  });
});

describe('プロダクトのハンドルの解決', () => {
  test('掲載中のプロダクトの現在のハンドルは、大文字小文字を問わずそのプロダクトに解決する', async () => {
    for (const handle of ['Alpha', 'alpha']) {
      const response = await harness.request(
        `/test/products/${handle}/launches`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { product_id: productIdOf(LISTED) },
      });
    }
  });

  test('掲載中のプロダクトの旧ハンドルは、現在のハンドルに置き換えた同じパスへクエリを保って302で転送する', async () => {
    const response = await harness.request(
      '/test/products/old-alpha/launches?cursor=abc&extra=1',
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://api.launch.example/v1/test/products/Alpha/launches?cursor=abc&extra=1',
    );
  });

  test('未ログインの公開範囲の外(未掲載・非公開化・論理削除・投稿者の停止)のプロダクトは、現在・旧のハンドルを問わず404にする', async () => {
    for (const handle of [
      'Beta',
      'old-beta',
      'Gamma',
      'old-gamma',
      'Delta',
      'Epsilon',
      'missing',
    ]) {
      await expectProductNotFound(`/test/products/${handle}/launches`);
    }
  });

  test('形式に合わないハンドルは、ハンドルを照会せずに見つからないことにする', async () => {
    const directory = createProductDirectory();
    const resolved: string[] = [];
    const counting: ProductDirectory = {
      ...directory,
      findSummaries: (ids, scope) => directory.findSummaries(ids, scope),
      findDetail: (id) => directory.findDetail(id),
      listLaunches: (ids, now) => directory.listLaunches(ids, now),
      resolveHandle: (handle) => {
        resolved.push(handle);
        return directory.resolveHandle(handle);
      },
    };

    for (const handle of ['-alpha', 'al pha', 'a'.repeat(51)]) {
      expect(await resolvePublicProduct(counting, handle)).toEqual({
        kind: 'not-found',
      });
    }
    expect(resolved).toEqual([]);
    await expectProductNotFound('/test/products/_alpha/launches');
    expect(await resolvePublicProduct(counting, 'Alpha')).toMatchObject({
      kind: 'current',
      product: { productId: productIdOf(LISTED), handle: 'Alpha' },
    });
    expect(resolved).toEqual(['Alpha']);
  });
});
