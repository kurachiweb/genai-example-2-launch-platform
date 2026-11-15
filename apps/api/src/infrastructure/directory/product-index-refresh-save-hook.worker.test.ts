import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { productSearchDocuments } from '../../../db/schema/directory/product-search-documents.ts';
import { createUlidGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import { D1DirectoryEntryStore } from '../../../lib/workers/directory/d1-directory-entry-store.ts';
import {
  db,
  productIdOf,
  T0,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { createSearchIndexStatements } from '../../../lib/workers/search/search-index-statements.ts';
import { createSearchTargetRegistry } from '../../../lib/workers/search/search-target-definition.ts';
import { PRODUCT_SEARCH_TARGET } from '../../../lib/workers/search/targets/product.ts';
import type { ProductSaveHook } from '../product/product-save-hooks.ts';
import { ProductIndexRefreshSaveHook } from './product-index-refresh-save-hook.ts';
import {
  AFTER_DECISION,
  OWNER_FIRST_LISTED,
  seedIndexRemovalScenario,
} from './testing/index-removal-fixtures.ts';

// 予選で負けたため、勝利したプロダクトの記録と索引文書を持たない
const UNLISTED = 2;

type RefreshRequest = readonly [target: string, sourceId: string];

function createHook(): {
  readonly hook: ProductSaveHook;
  readonly requests: readonly RefreshRequest[];
} {
  const requests: RefreshRequest[] = [];
  const requester: SearchIndexRefreshRequester = {
    requestRefresh: (target, sourceId) => {
      requests.push([target, sourceId]);
      return Promise.resolve();
    },
  };
  return {
    hook: new ProductIndexRefreshSaveHook(
      new D1DirectoryEntryStore(db, createUlidGenerator({ now: () => T0 })),
      createSearchIndexStatements(
        db,
        createSearchTargetRegistry([PRODUCT_SEARCH_TARGET]),
      ),
      requester,
    ),
    requests,
  };
}

async function readDocument(index: number) {
  const [row] = await db
    .select({
      keywordStatus: productSearchDocuments.keywordStatus,
      statusChangedAt: productSearchDocuments.statusChangedAt,
    })
    .from(productSearchDocuments)
    .where(eq(productSearchDocuments.sourceId, productIdOf(index)));
  return row;
}

beforeEach(seedIndexRemovalScenario);

describe('ProductIndexRefreshSaveHook', () => {
  describe('statementsFor', () => {
    test('勝利したプロダクトの記録があれば1文を返し、組み立てでは書かず、実行すると索引文書を保存の時刻で更新待ちにする', async () => {
      const { hook } = createHook();

      const [statement, ...rest] = await hook.statementsFor(
        { productId: productIdOf(OWNER_FIRST_LISTED), at: AFTER_DECISION },
        db,
      );

      expect(statement).toBeDefined();
      expect(rest).toEqual([]);
      await expect(readDocument(OWNER_FIRST_LISTED)).resolves.toEqual({
        keywordStatus: 'pending',
        statusChangedAt: T0,
      });

      if (statement !== undefined) {
        await db.batch([statement]);
      }

      await expect(readDocument(OWNER_FIRST_LISTED)).resolves.toEqual({
        keywordStatus: 'pending',
        statusChangedAt: AFTER_DECISION,
      });
    });

    test('勝利したプロダクトの記録が無ければ文を返さない', async () => {
      const { hook } = createHook();

      await expect(
        hook.statementsFor(
          { productId: productIdOf(UNLISTED), at: AFTER_DECISION },
          db,
        ),
      ).resolves.toEqual([]);
      await expect(readDocument(UNLISTED)).resolves.toBeUndefined();
    });
  });

  describe('afterCommit', () => {
    test('勝利したプロダクトの記録があれば、そのプロダクトの索引の更新を要求する', async () => {
      const { hook, requests } = createHook();

      await hook.afterCommit({ productId: productIdOf(OWNER_FIRST_LISTED) });

      expect(requests).toEqual([
        [PRODUCT_SEARCH_TARGET.name, productIdOf(OWNER_FIRST_LISTED)],
      ]);
    });

    test('勝利したプロダクトの記録が無ければ要求しない', async () => {
      const { hook, requests } = createHook();

      await hook.afterCommit({ productId: productIdOf(UNLISTED) });

      expect(requests).toEqual([]);
    });
  });
});
