import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { productSearchDocuments } from '../../../db/schema/directory/product-search-documents.ts';
import { createStatementRecordingDatabase } from '../../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import { clearDirectoryTables } from '../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  after,
  db,
  productIdOf,
  T0,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { createSearchIndexStatements } from '../../../lib/workers/search/search-index-statements.ts';
import { createSearchTargetRegistry } from '../../../lib/workers/search/search-target-definition.ts';
import { PRODUCT_SEARCH_TARGET } from '../../../lib/workers/search/targets/product.ts';
import {
  MAX_PRODUCTS_PER_PENDING_MARK,
  PRODUCT_SEARCH_TARGET_NAME,
} from '../../application/directory/ports.ts';
import { D1ProductIndexPendingMarker } from './d1-product-index-pending-marker.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const MARKED_AT = after(5_000);

const EXTRACTED_AT = after(1_000);

function createMarker(database: Database = db): D1ProductIndexPendingMarker {
  return new D1ProductIndexPendingMarker(
    database,
    createSearchIndexStatements(
      database,
      createSearchTargetRegistry([PRODUCT_SEARCH_TARGET]),
    ),
  );
}

function readDocuments() {
  return db
    .select({
      sourceId: productSearchDocuments.sourceId,
      sourceVersion: productSearchDocuments.sourceVersion,
      name: productSearchDocuments.name,
      keywords: productSearchDocuments.keywords,
      keywordStatus: productSearchDocuments.keywordStatus,
      extractionInputHash: productSearchDocuments.extractionInputHash,
      statusChangedAt: productSearchDocuments.statusChangedAt,
    })
    .from(productSearchDocuments)
    .orderBy(asc(productSearchDocuments.sourceId));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(clearDirectoryTables);

describe('D1ProductIndexPendingMarker', () => {
  test('application層が持つ検索対象の名前は、プロダクトの検索対象の定義の名前と一致する', () => {
    expect(PRODUCT_SEARCH_TARGET_NAME).toBe(PRODUCT_SEARCH_TARGET.name);
  });

  test('索引文書の無いプロダクトに、版0・本文とキーワードが空の更新待ちの行を作る', async () => {
    await createMarker().mark([productIdOf(1)], MARKED_AT);

    await expect(readDocuments()).resolves.toStrictEqual([
      {
        sourceId: productIdOf(1),
        sourceVersion: 0,
        name: '',
        keywords: '',
        keywordStatus: 'pending',
        extractionInputHash: null,
        statusChangedAt: MARKED_AT,
      },
    ]);
  });

  test('既存の索引文書は状態と状態の日時だけを更新待ちにし、版・本文・キーワード・抽出の入力のハッシュを残す', async () => {
    await db.insert(productSearchDocuments).values({
      sourceId: productIdOf(1),
      sourceVersion: 7,
      name: 'Rocket Launcher',
      keywords: 'orbital',
      keywordStatus: 'extracted',
      extractionInputHash: 'hash-1',
      statusChangedAt: EXTRACTED_AT,
    });

    await createMarker().mark([productIdOf(1)], MARKED_AT);

    await expect(readDocuments()).resolves.toStrictEqual([
      {
        sourceId: productIdOf(1),
        sourceVersion: 7,
        name: 'Rocket Launcher',
        keywords: 'orbital',
        keywordStatus: 'pending',
        extractionInputHash: 'hash-1',
        statusChangedAt: MARKED_AT,
      },
    ]);
  });

  test(`上限の${String(MAX_PRODUCTS_PER_PENDING_MARK)}件のプロダクトを1回の一括の書き込みで更新待ちにする`, async () => {
    const productIds = Array.from(
      { length: MAX_PRODUCTS_PER_PENDING_MARK },
      (_, index) => productIdOf(index + 1),
    );
    const recording = createStatementRecordingDatabase();

    await createMarker(recording.db).mark(productIds, MARKED_AT);

    expect(recording.batchSizes).toStrictEqual([MAX_PRODUCTS_PER_PENDING_MARK]);
    const documents = await readDocuments();
    expect(documents.map(({ sourceId }) => sourceId)).toStrictEqual(
      [...productIds].sort(),
    );
    expect(
      documents.every(
        ({ keywordStatus, statusChangedAt }) =>
          keywordStatus === 'pending' &&
          statusChangedAt.getTime() === MARKED_AT.getTime(),
      ),
    ).toBe(true);
  });

  test('空の配列では書き込まない', async () => {
    const recording = createStatementRecordingDatabase();

    await createMarker(recording.db).mark([], MARKED_AT);

    expect(recording.batchSizes).toStrictEqual([]);
    expect(recording.placeholderCounts).toStrictEqual([]);
    await expect(readDocuments()).resolves.toStrictEqual([]);
  });

  test('上限を超える件数は書き込まずにRangeErrorにする', async () => {
    const productIds = Array.from(
      { length: MAX_PRODUCTS_PER_PENDING_MARK + 1 },
      (_, index) => productIdOf(index + 1),
    );
    const recording = createStatementRecordingDatabase();

    await expect(
      createMarker(recording.db).mark(productIds, MARKED_AT),
    ).rejects.toBeInstanceOf(RangeError);
    expect(recording.batchSizes).toStrictEqual([]);
    await expect(readDocuments()).resolves.toStrictEqual([]);
  });

  test('空の識別子を含む書き込みは、他のプロダクトも書かずにRangeErrorにする', async () => {
    await expect(
      createMarker().mark([productIdOf(1), ''], T0),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(readDocuments()).resolves.toStrictEqual([]);
  });
});
