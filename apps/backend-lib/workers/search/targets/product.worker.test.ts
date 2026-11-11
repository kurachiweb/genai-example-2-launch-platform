import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { productSearchDocuments } from '../../../../db/schema/directory/product-search-documents.ts';
import { PRODUCT_SEARCH_INDEX } from '../../../../db/schema/directory/product-search-index.ts';
import { products } from '../../../../db/schema/product/products.ts';
import type { IndexWrite } from '../../../core/search/ports.ts';
import {
  after,
  clearProductTables,
  db,
  insertLaunch,
  insertLaunches,
  insertProduct,
  insertUser,
  productIdOf,
} from '../../product/testing/product-fixtures.ts';
import { D1SearchIndexRepository } from '../search-index-repository.ts';
import { createSearchTargetRegistry } from '../search-target-definition.ts';
import { SEARCH_TARGETS } from './index.ts';
import { PRODUCT_SEARCH_TARGET } from './product.ts';

const LISTED = 1;
const NO_LAUNCH = 2;
const LOST_ONLY = 3;
const CANCELLED_WIN = 4;
const HIDDEN = 5;
const DELETED = 6;
const SUSPENDED_OWNER = 7;
const WITHDRAWN_OWNER = 8;
const UNDECIDED = 9;
const MISSING = 99;

const NOW = new Date('2026-11-10T03:04:05.678Z');

const writeOf = (sourceVersion: number): IndexWrite => ({
  sourceVersion,
  texts: { name: 'アルファ', tagline: 'タグライン' },
  keywords: { kind: 'set', value: 'rocket' },
  keywordStatus: 'extracted',
  extractionInputHash: 'hash-1',
  statusChangedAt: NOW,
});

async function isIndexable(productIndex: number): Promise<boolean> {
  const [row] = await db.all<{ indexable: number }>(
    sql`SELECT EXISTS (${PRODUCT_SEARCH_TARGET.isIndexable(productIdOf(productIndex))}) AS indexable`,
  );
  return row?.indexable === 1;
}

async function readDocument(productIndex: number) {
  const [row] = await db
    .select()
    .from(productSearchDocuments)
    .where(eq(productSearchDocuments.sourceId, productIdOf(productIndex)));
  return row;
}

beforeEach(async () => {
  await db.delete(productSearchDocuments);
  await clearProductTables();
  await insertUser(1, { handle: 'alice' });
  await insertUser(2, {
    handle: 'bob',
    status: 'suspended',
    suspendedAt: after(1),
  });
  await insertUser(3, { handle: 'carol', deletedAt: after(2) });
  await insertProduct(LISTED, 1, {
    name: 'アルファ',
    tagline: '速く出す',
    descriptionMarkdown: '**宇宙**へ向かう',
  });
  await insertProduct(NO_LAUNCH, 1);
  await insertProduct(LOST_ONLY, 1);
  await insertProduct(CANCELLED_WIN, 1);
  await insertProduct(HIDDEN, 1, { hiddenAt: after(3) });
  await insertProduct(DELETED, 1, { deletedAt: after(4) });
  await insertProduct(SUSPENDED_OWNER, 2);
  await insertProduct(WITHDRAWN_OWNER, 3);
  await insertProduct(UNDECIDED, 1);
  const won = { outcome: 'won', decidedAt: after(10) } as const;
  await insertLaunches([
    { index: LISTED, productIndex: LISTED, columns: won },
    {
      index: LOST_ONLY,
      productIndex: LOST_ONLY,
      columns: { outcome: 'lost', decidedAt: after(10) },
    },
    {
      index: CANCELLED_WIN,
      productIndex: CANCELLED_WIN,
      columns: { ...won, cancelledAt: after(11) },
    },
    { index: HIDDEN, productIndex: HIDDEN, columns: won },
    { index: DELETED, productIndex: DELETED, columns: won },
    { index: SUSPENDED_OWNER, productIndex: SUSPENDED_OWNER, columns: won },
    { index: WITHDRAWN_OWNER, productIndex: WITHDRAWN_OWNER, columns: won },
  ]);
  await insertLaunch(UNDECIDED, UNDECIDED);
});

describe('PRODUCT_SEARCH_TARGET', () => {
  test('名前productで、索引文書のテーブルproduct_search_documentsの索引の定義を使い、検索対象の集約点に登録される', () => {
    const registry = createSearchTargetRegistry(SEARCH_TARGETS);

    expect(PRODUCT_SEARCH_TARGET.name).toBe('product');
    expect(PRODUCT_SEARCH_TARGET.index).toBe(PRODUCT_SEARCH_INDEX);
    expect(PRODUCT_SEARCH_TARGET.documents).toBe(productSearchDocuments);
    expect(registry.definition('product')).toBe(PRODUCT_SEARCH_TARGET);
  });

  test('名称は元テキストの列に保存して抽出に使わず、タグラインは元テキストの列に保存して抽出にも使い、説明文はマークダウンとして抽出だけに使う', () => {
    expect(PRODUCT_SEARCH_TARGET.fields).toEqual({
      name: { format: 'plain', textColumn: true, extract: false },
      tagline: { format: 'plain', textColumn: true, extract: true },
      description: { format: 'markdown', textColumn: false, extract: true },
    });
  });

  describe('read', () => {
    test('掲載中のプロダクトの名称・タグライン・説明文の原文を、読み取りの時刻を版にして返す', async () => {
      const before = Date.now();

      const source = await PRODUCT_SEARCH_TARGET.read(db, productIdOf(LISTED));

      const afterRead = Date.now();
      expect(source?.fields).toStrictEqual({
        name: 'アルファ',
        tagline: '速く出す',
        description: '**宇宙**へ向かう',
      });
      expect(source?.version).toBeGreaterThanOrEqual(before);
      expect(source?.version).toBeLessThanOrEqual(afterRead);
      expect(Number.isInteger(source?.version)).toBe(true);
    });

    test.each([
      ['ローンチが無い', NO_LAUNCH],
      ['予選の敗北だけ', LOST_ONLY],
      ['勝利したローンチが取り消された', CANCELLED_WIN],
      ['結果が未確定', UNDECIDED],
      ['非公開化された', HIDDEN],
      ['論理削除された', DELETED],
      ['投稿者が停止中', SUSPENDED_OWNER],
      ['投稿者が退会した', WITHDRAWN_OWNER],
      ['存在しない', MISSING],
    ])('%sプロダクトは読み取りが空になる', async (_label, productIndex) => {
      const source = await PRODUCT_SEARCH_TARGET.read(
        db,
        productIdOf(productIndex),
      );

      expect(source).toBeUndefined();
    });
  });

  describe('isIndexable', () => {
    test('掲載中のプロダクトで真になる', async () => {
      expect(await isIndexable(LISTED)).toBe(true);
    });

    test.each([
      ['ローンチが無い', NO_LAUNCH],
      ['予選の敗北だけ', LOST_ONLY],
      ['勝利したローンチが取り消された', CANCELLED_WIN],
      ['結果が未確定', UNDECIDED],
      ['非公開化された', HIDDEN],
      ['論理削除された', DELETED],
      ['投稿者が停止中', SUSPENDED_OWNER],
      ['投稿者が退会した', WITHDRAWN_OWNER],
      ['存在しない', MISSING],
    ])('%sプロダクトで偽になる', async (_label, productIndex) => {
      expect(await isIndexable(productIndex)).toBe(false);
    });

    test('索引文書の条件付きの書き込みが、掲載中のプロダクトだけを書き、掲載中でなくなった後の書き込みを捨てる', async () => {
      const repository = new D1SearchIndexRepository(
        db,
        createSearchTargetRegistry([PRODUCT_SEARCH_TARGET]),
      );

      const listed = await repository.upsert(
        'product',
        productIdOf(LISTED),
        writeOf(1),
      );
      const hidden = await repository.upsert(
        'product',
        productIdOf(HIDDEN),
        writeOf(1),
      );
      await db
        .update(products)
        .set({ hiddenAt: after(20) })
        .where(eq(products.id, productIdOf(LISTED)));
      const afterHidden = await repository.upsert(
        'product',
        productIdOf(LISTED),
        writeOf(2),
      );

      expect([listed, hidden, afterHidden]).toEqual([
        'written',
        'skipped',
        'skipped',
      ]);
      expect(await readDocument(LISTED)).toMatchObject({ sourceVersion: 1 });
      expect(await readDocument(HIDDEN)).toBeUndefined();
    });
  });
});
