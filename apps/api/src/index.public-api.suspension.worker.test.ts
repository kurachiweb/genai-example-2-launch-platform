import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test } from 'vitest';

import { users } from '../db/schema/identity/users.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  T0,
  userIdOf,
} from '../lib/workers/product/testing/product-fixtures.ts';
import { callPublic } from '../test/support/gateway-test-harness.ts';
import {
  ALL_SCOPES,
  createPublicApiRouteCaller,
  errorCodeOf,
  expectCors,
  LISTED_HANDLE,
  OWN_ROUTES,
  PUBLIC_ROUTES,
  type RouteCase,
  routeLabelOf,
  seedWorld,
} from '../test/support/public-api-route-cases.ts';

const { createKeyHolder, routeRequest } = createPublicApiRouteCaller({
  firstHolderIndex: 2000,
  ipGroup: 2,
});

beforeAll(seedWorld);

// 説明文の更新を成功させるため、/v1/meの下の経路のプロダクトをキーの持ち主のローンチを持つプロダクトに替える
function ownRoutesOf(productHandle: string): readonly RouteCase[] {
  return OWN_ROUTES.map((route) => ({
    ...route,
    path: route.path.replace(LISTED_HANDLE, productHandle),
  }));
}

async function reactivateUser(userIndex: number): Promise<void> {
  await db
    .update(users)
    .set({ status: 'active', suspendedAt: null })
    .where(eq(users.id, userIdOf(userIndex)));
}

describe('停止中の持ち主のキー(既定のエクスポート)', () => {
  test('公開データの9経路は処理してCORSのヘッダー付きで返し、/v1/meの下の4経路は403(account_unavailable)で拒否し、停止の解除の後は13経路の全てを処理する', async () => {
    const holder = await createKeyHolder(ALL_SCOPES, {
      status: 'suspended',
      suspendedAt: T0,
    });
    await insertProduct(holder.index, holder.index);
    await insertLaunch(holder.index, holder.index, {
      launchDate: '2026-11-10',
    });
    const ownRoutes = ownRoutesOf(`product${String(holder.index)}`);

    for (const route of PUBLIC_ROUTES) {
      const response = await callPublic(
        routeRequest(route, holder.authorization),
      );

      expect.soft(response.status, routeLabelOf(route)).toBe(200);
      expectCors(response, route);
      await response.body?.cancel();
    }
    for (const route of ownRoutes) {
      const response = await callPublic(
        routeRequest(route, holder.authorization),
      );

      expect.soft(response.status, routeLabelOf(route)).toBe(403);
      expect
        .soft(await errorCodeOf(response), routeLabelOf(route))
        .toBe('account_unavailable');
      expectCors(response, route);
    }

    await reactivateUser(holder.index);

    for (const route of [...PUBLIC_ROUTES, ...ownRoutes]) {
      const response = await callPublic(
        routeRequest(route, holder.authorization),
      );

      expect.soft(response.status, routeLabelOf(route)).toBe(200);
      expectCors(response, route);
      await response.body?.cancel();
    }
    expect(PUBLIC_ROUTES).toHaveLength(9);
    expect(ownRoutes.every(({ path }) => path.startsWith('/me/'))).toBe(true);
    expect(ownRoutes).toHaveLength(4);
  });
});
