import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from '../../../common-lib/search/search-terms.ts';
import { productSearchDocuments } from '../../../db/schema/directory/product-search-documents.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import type {
  DirectoryListingInput,
  DirectoryListingPage,
} from '../../core/directory/ports.ts';
import {
  after,
  db,
  insertProduct,
  insertUser,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1DirectoryListing } from './d1-directory-listing.ts';
import {
  clearDirectoryTables,
  indexProduct,
  insertQualifiers,
  type QualifierFixture,
  winOf,
} from './testing/directory-listing-fixtures.ts';

const OWNER = 1;
const SUSPENDING_OWNER = 2;
const WITHDRAWING_OWNER = 3;

const LOSER = 99;

const listing = new D1DirectoryListing(db);

interface SearchedProduct {
  readonly index: number;
  readonly name: string;
  readonly tagline: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly date: string;
  readonly owner?: number;
}

function matchExpressionOf(query: string): string {
  const expression = buildFtsMatchExpression(normalizeSearchTerms(query));
  if (expression === undefined) {
    throw new Error(`検索語「${query}」から検索式を作れない`);
  }
  return expression;
}

function search(
  query: string,
  conditions: Partial<DirectoryListingInput> = {},
): Promise<DirectoryListingPage> {
  return listing.page({
    matchExpression: matchExpressionOf(query),
    categoryId: undefined,
    from: undefined,
    to: undefined,
    sort: 'newest',
    page: 1,
    ...conditions,
  });
}

async function searchedIds(
  query: string,
  conditions: Partial<DirectoryListingInput> = {},
): Promise<string[]> {
  const { rows } = await search(query, conditions);
  return rows.map((row) => row.productId);
}

function idsOf(indexes: readonly number[]): string[] {
  return indexes.map(productIdOf);
}

function winOn(match: number, product: SearchedProduct): QualifierFixture {
  return winOf(match, {
    product: product.index,
    owner: product.owner ?? OWNER,
    date: product.date,
    opponent: LOSER,
  });
}

// 予選で勝利して掲載中になったプロダクトを、索引の更新の処理と同じ経路で索引に載せる
async function insertSearchedProducts(
  searched: readonly SearchedProduct[],
): Promise<void> {
  for (const product of searched) {
    await insertProduct(product.index, product.owner ?? OWNER, {
      name: product.name,
      tagline: product.tagline,
      descriptionMarkdown: product.description ?? `${product.name}の説明`,
    });
  }
  await insertQualifiers(
    searched.map((product, position) => winOn(position + 1, product)),
  );
  for (const product of searched) {
    await indexProduct(product.index, product.keywords);
  }
}

beforeEach(async () => {
  await clearDirectoryTables();
  await insertUser(OWNER);
  await insertProduct(LOSER, OWNER);
});

describe('検索語の照合', () => {
  const ROCKET = 1;
  const CAFE = 2;
  const KEYWORD_ONLY = 3;
  const OPERATORS = 4;
  const GARDEN = 5;

  beforeEach(async () => {
    await insertSearchedProducts([
      {
        index: ROCKET,
        name: 'Rocketship',
        tagline: 'Fly to the moon',
        date: '2026-11-20',
      },
      {
        index: CAFE,
        name: 'Café Résumé',
        tagline: 'カメラで撮る',
        date: '2026-11-19',
      },
      {
        index: KEYWORD_ONLY,
        name: 'Plain',
        tagline: 'Simple',
        description: 'A **telescope** for the night sky',
        keywords: ['Telescope'],
        date: '2026-11-18',
      },
      {
        index: OPERATORS,
        name: 'Rocket or not Moon',
        tagline: 'Plain',
        date: '2026-11-17',
      },
      {
        index: GARDEN,
        name: 'Garden',
        tagline: 'Plants',
        date: '2026-11-16',
      },
    ]);
  });

  test('名称・タグライン・抽出したキーワードを語の前方一致で照合し、総件数も検索で絞る', async () => {
    const byName = await search('rock');

    expect(byName.rows.map((row) => row.productId)).toEqual(
      idsOf([ROCKET, OPERATORS]),
    );
    expect(byName.totalCount).toBe(2);
    expect(await searchedIds('fly')).toEqual(idsOf([ROCKET]));
    expect(await searchedIds('tele')).toEqual(idsOf([KEYWORD_ONLY]));
  });

  test('空白で区切った全ての語に一致するプロダクトだけを返す', async () => {
    expect(await searchedIds('rocket moon')).toEqual(
      idsOf([ROCKET, OPERATORS]),
    );
    expect(await search('rocket　garden')).toEqual<DirectoryListingPage>({
      totalCount: 0,
      rows: [],
    });
  });

  test('大文字小文字の違いを無視する', async () => {
    expect(await searchedIds('ROCKETSHIP')).toEqual(idsOf([ROCKET]));
    expect(await searchedIds('gArDeN')).toEqual(idsOf([GARDEN]));
  });

  test('全角半角の違いを無視する', async () => {
    expect(await searchedIds('ｒｏｃｋｅｔｓ')).toEqual(idsOf([ROCKET]));
    expect(await searchedIds('ｶﾒﾗ')).toEqual(idsOf([CAFE]));
  });

  test('発音区別符号の違いを無視する', async () => {
    expect(await searchedIds('cafe resume')).toEqual(idsOf([CAFE]));
    expect(await searchedIds('mòón')).toEqual(idsOf([ROCKET, OPERATORS]));
  });

  test.each([
    ['閉じていない引用符', '"rocketship', [ROCKET]],
    ['OR', 'rocket OR moon', [OPERATORS]],
    ['NOT', 'rocket NOT moon', [OPERATORS]],
    ['NEAR', 'NEAR(rocket moon)', []],
    ['列の指定', 'name:garden', []],
    ['引用符と記号だけ', '" * -', []],
  ])(
    '検索の構文(%s)を演算子ではなく文字列として照合する',
    async (_label, query, expected) => {
      expect(await searchedIds(query)).toEqual(idsOf(expected));
    },
  );
});

describe('関連度の順', () => {
  const NAME_HIT = 1;
  const TAGLINE_HIT = 2;
  const KEYWORD_HIT = 3;
  const TIE_OLD = 4;
  const TIE_NEW_LOW_ID = 5;
  const TIE_NEW_HIGH_ID = 6;

  const tie = { name: 'Nebula', tagline: 'Plain', keywords: ['plain'] };

  beforeEach(async () => {
    await insertSearchedProducts([
      {
        index: NAME_HIT,
        name: 'Comet',
        tagline: 'Plain',
        keywords: ['plain'],
        date: '2026-11-16',
      },
      {
        index: TAGLINE_HIT,
        name: 'Plain',
        tagline: 'Comet',
        keywords: ['plain'],
        date: '2026-11-18',
      },
      {
        index: KEYWORD_HIT,
        name: 'Plain',
        tagline: 'Plain',
        keywords: ['comet'],
        date: '2026-11-20',
      },
      { index: TIE_OLD, ...tie, date: '2026-11-18' },
      { index: TIE_NEW_LOW_ID, ...tie, date: '2026-11-20' },
      { index: TIE_NEW_HIGH_ID, ...tie, date: '2026-11-20' },
    ]);
  });

  test('関連度は名称・タグライン・キーワードの一致の重みの高い順に並べる', async () => {
    expect(await searchedIds('comet', { sort: 'relevance' })).toEqual(
      idsOf([NAME_HIT, TAGLINE_HIT, KEYWORD_HIT]),
    );
  });

  test('関連度が同じ項目は基準勝利の実施日の新しい順、次にプロダクトのIDの降順に並べる', async () => {
    expect(await searchedIds('nebula', { sort: 'relevance' })).toEqual(
      idsOf([TIE_NEW_HIGH_ID, TIE_NEW_LOW_ID, TIE_OLD]),
    );
  });

  test('関連度以外の並び順では、検索で絞った項目を関連度に関わらずその並び順で並べる', async () => {
    expect(await searchedIds('comet', { sort: 'oldest' })).toEqual(
      idsOf([NAME_HIT, TAGLINE_HIT, KEYWORD_HIT]),
    );
    expect(await searchedIds('comet', { sort: 'newest' })).toEqual(
      idsOf([KEYWORD_HIT, TAGLINE_HIT, NAME_HIT]),
    );
  });
});

describe('索引文書と掲載の条件', () => {
  const LISTED = 1;
  const HIDDEN = 2;
  const DELETED = 3;
  const BY_SUSPENDED = 4;
  const BY_WITHDRAWN = 5;

  beforeEach(async () => {
    await insertUser(SUSPENDING_OWNER);
    await insertUser(WITHDRAWING_OWNER);
    await insertSearchedProducts([
      { index: LISTED, name: 'Rocket', tagline: 'One', date: '2026-11-20' },
      { index: HIDDEN, name: 'Rocket', tagline: 'Two', date: '2026-11-19' },
      { index: DELETED, name: 'Rocket', tagline: 'Three', date: '2026-11-18' },
      {
        index: BY_SUSPENDED,
        name: 'Rocket',
        tagline: 'Four',
        date: '2026-11-17',
        owner: SUSPENDING_OWNER,
      },
      {
        index: BY_WITHDRAWN,
        name: 'Rocket',
        tagline: 'Five',
        date: '2026-11-16',
        owner: WITHDRAWING_OWNER,
      },
    ]);
  });

  test('索引文書が残っていても、検索の時点で掲載中でないプロダクトは一覧にも総件数にも含めない', async () => {
    await db
      .update(products)
      .set({ hiddenAt: after(1) })
      .where(eq(products.id, productIdOf(HIDDEN)));
    await db
      .update(products)
      .set({ deletedAt: after(2) })
      .where(eq(products.id, productIdOf(DELETED)));
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: after(3) })
      .where(eq(users.id, userIdOf(SUSPENDING_OWNER)));
    await db
      .update(users)
      .set({ deletedAt: after(4) })
      .where(eq(users.id, userIdOf(WITHDRAWING_OWNER)));

    const page = await search('rocket');

    expect(await db.$count(productSearchDocuments)).toBe(5);
    expect(page).toEqual<DirectoryListingPage>({
      totalCount: 1,
      rows: [expect.objectContaining({ productId: productIdOf(LISTED) })],
    });
  });

  test('索引の更新が遅れていても、保存済みの索引文書で検索する', async () => {
    await db
      .update(products)
      .set({ name: 'Garden' })
      .where(eq(products.id, productIdOf(LISTED)));

    expect(await searchedIds('rocket')).toEqual(
      idsOf([LISTED, HIDDEN, DELETED, BY_SUSPENDED, BY_WITHDRAWN]),
    );
    expect(await searchedIds('garden')).toEqual([]);
  });
});
