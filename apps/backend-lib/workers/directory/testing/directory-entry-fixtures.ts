import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';

import { createDatabase, type Database } from '../../../../db/client.ts';
import { directoryEntries } from '../../../../db/schema/directory/directory-entries.ts';
import { productSearchDocuments } from '../../../../db/schema/directory/product-search-documents.ts';
import { db, T0 } from '../../product/testing/product-fixtures.ts';
import { createSearchIndexStatements } from '../../search/search-index-statements.ts';
import { createSearchTargetRegistry } from '../../search/search-target-definition.ts';
import { PRODUCT_SEARCH_TARGET } from '../../search/targets/product.ts';

const productIndexStatements = createSearchIndexStatements(
  db,
  createSearchTargetRegistry([PRODUCT_SEARCH_TARGET]),
);

// 索引の更新の処理を通さず、更新待ちの印で索引文書の行だけを作る
export async function insertIndexDocuments(
  productIds: readonly string[],
): Promise<void> {
  const [first, ...rest] = productIds.map((productId) =>
    productIndexStatements.markPending(
      PRODUCT_SEARCH_TARGET.name,
      productId,
      T0,
    ),
  );
  if (first === undefined) {
    return;
  }
  await db.batch([first, ...rest]);
}

export async function readIndexedProductIds(): Promise<string[]> {
  const rows = await db
    .select({ sourceId: productSearchDocuments.sourceId })
    .from(productSearchDocuments)
    .orderBy(asc(productSearchDocuments.sourceId));
  return rows.map((row) => row.sourceId);
}

export function readDirectoryEntries() {
  return db
    .select({
      productId: directoryEntries.productId,
      ownerUserId: directoryEntries.ownerUserId,
      firstWonAt: directoryEntries.firstWonAt,
      createdAt: directoryEntries.createdAt,
      updatedAt: directoryEntries.updatedAt,
    })
    .from(directoryEntries)
    .orderBy(asc(directoryEntries.productId));
}

export interface StatementRecordingDatabase {
  readonly db: Database;
  // 一括の書き込みごとの文の数
  readonly batchSizes: readonly number[];
  // 一括の書き込みの中の文も含めた、組み立てた文ごとのプレースホルダーの数
  readonly placeholderCounts: readonly number[];
}

export function createStatementRecordingDatabase(): StatementRecordingDatabase {
  const batchSizes: number[] = [];
  const placeholderCounts: number[] = [];
  const d1 = env.DB;
  const database = createDatabase({
    prepare: (query) => {
      placeholderCounts.push(query.match(/\?/g)?.length ?? 0);
      return d1.prepare(query);
    },
    batch: (statements) => {
      batchSizes.push(statements.length);
      return d1.batch(statements);
    },
    exec: d1.exec.bind(d1),
    withSession: d1.withSession.bind(d1),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: d1.dump.bind(d1),
  });
  return {
    db: database,
    batchSizes,
    placeholderCounts,
  };
}
