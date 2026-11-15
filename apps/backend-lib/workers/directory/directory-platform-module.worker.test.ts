import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../core/directory/identifiers.ts';
import type {
  DirectoryEntryStore,
  DirectoryListingQuery,
} from '../../core/directory/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { after } from '../product/testing/product-fixtures.ts';
import { D1DirectoryEntryStore } from './d1-directory-entry-store.ts';
import { D1DirectoryListing } from './d1-directory-listing.ts';
import { DIRECTORY_PLATFORM_MODULE } from './directory-platform-module.ts';
import {
  SAMPLE_LISTED_PRODUCT_ID,
  SAMPLE_OWNER_ID,
  SAMPLE_UNLISTED_PRODUCT_ID,
  seedDirectoryPlatformSample,
} from './testing/directory-platform-fixtures.ts';

const BOUND_IDENTIFIERS = Object.values(DIRECTORY_PLATFORM_TYPES);

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [DIRECTORY_PLATFORM_MODULE],
  );
}

beforeEach(seedDirectoryPlatformSample);

describe('DIRECTORY_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      DIRECTORY_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(DIRECTORY_PLATFORM_MODULE.name).toBe('directory-platform');
    expect('routes' in DIRECTORY_PLATFORM_MODULE).toBe(false);
  });

  test('一覧の照会をD1の実装に解決し、掲載中のプロダクトを引ける', async () => {
    const listing = createContainer().get<DirectoryListingQuery>(
      DIRECTORY_PLATFORM_TYPES.DirectoryListingQuery,
    );

    expect(listing).toBeInstanceOf(D1DirectoryListing);
    await expect(
      listing.page({
        matchExpression: undefined,
        categoryId: undefined,
        from: undefined,
        to: undefined,
        sort: 'newest',
        page: 1,
      }),
    ).resolves.toMatchObject({
      totalCount: 1,
      rows: [{ productId: SAMPLE_LISTED_PRODUCT_ID }],
    });
  });

  test('記録のストアをD1の実装に解決し、記録して投稿者ごとに引ける', async () => {
    const store = createContainer().get<DirectoryEntryStore>(
      DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore,
    );

    expect(store).toBeInstanceOf(D1DirectoryEntryStore);
    await store.record(
      [{ productId: SAMPLE_LISTED_PRODUCT_ID, ownerUserId: SAMPLE_OWNER_ID }],
      after(1),
    );
    await expect(store.exists(SAMPLE_LISTED_PRODUCT_ID)).resolves.toBe(true);
    await expect(store.exists(SAMPLE_UNLISTED_PRODUCT_ID)).resolves.toBe(false);
    await expect(
      store.listProductIdsByOwner(SAMPLE_OWNER_ID, undefined, 10),
    ).resolves.toEqual([SAMPLE_LISTED_PRODUCT_ID]);
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した2つの識別子をすべて解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(BOUND_IDENTIFIERS).toHaveLength(2);
      for (const identifier of BOUND_IDENTIFIERS) {
        expect(container.get(identifier)).toBeDefined();
      }
    },
  );

  test('照会と記録は処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const identifier of BOUND_IDENTIFIERS) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });
});
