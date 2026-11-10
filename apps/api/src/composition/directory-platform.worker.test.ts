import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

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

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

beforeEach(seedDirectoryPlatformSample);

describe('APIサーバーのディレクトリの共通の束縛', () => {
  test('処理単位のコンテナから一覧の照会をD1の実装に解決し、掲載中のプロダクトを引ける', async () => {
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

  test('処理単位のコンテナから記録のストアをD1の実装に解決し、記録して存在を確かめられる', async () => {
    const store = createContainer().get<DirectoryEntryStore>(
      DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore,
    );

    expect(store).toBeInstanceOf(D1DirectoryEntryStore);
    await store.record(
      [{ productId: SAMPLE_LISTED_PRODUCT_ID, ownerUserId: SAMPLE_OWNER_ID }],
      after(1),
    );
    await expect(store.exists(SAMPLE_LISTED_PRODUCT_ID)).resolves.toBe(true);
  });
});
