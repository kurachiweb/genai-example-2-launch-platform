import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { DIRECTORY_PLATFORM_TYPES } from '../../lib/core/directory/identifiers.ts';
import type {
  DirectoryEntryStore,
  DirectoryListingQuery,
} from '../../lib/core/directory/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1DirectoryEntryStore } from '../../lib/workers/directory/d1-directory-entry-store.ts';
import { D1DirectoryListing } from '../../lib/workers/directory/d1-directory-listing.ts';
import {
  SAMPLE_LISTED_PRODUCT_ID,
  SAMPLE_OWNER_ID,
  seedDirectoryPlatformSample,
} from '../../lib/workers/directory/testing/directory-platform-fixtures.ts';
import { after } from '../../lib/workers/product/testing/product-fixtures.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
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
    MODULES,
  );
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(seedDirectoryPlatformSample);

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのディレクトリの共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナから一覧の照会をD1の実装に解決し、掲載中のプロダクトを引ける', async () => {
      const listing = createContainer(kind).get<DirectoryListingQuery>(
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

    test('処理単位のコンテナから記録のストアをD1の実装に解決し、記録して投稿者ごとに引ける', async () => {
      const store = createContainer(kind).get<DirectoryEntryStore>(
        DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore,
      );

      expect(store).toBeInstanceOf(D1DirectoryEntryStore);
      await store.record(
        [{ productId: SAMPLE_LISTED_PRODUCT_ID, ownerUserId: SAMPLE_OWNER_ID }],
        after(1),
      );
      await expect(
        store.listProductIdsByOwner(SAMPLE_OWNER_ID, undefined, 10),
      ).resolves.toEqual([SAMPLE_LISTED_PRODUCT_ID]);
    });
  },
);
