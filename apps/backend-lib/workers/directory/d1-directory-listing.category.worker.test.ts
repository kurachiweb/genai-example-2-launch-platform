import { beforeEach, describe, expect, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from '../../../common-lib/search/search-terms.ts';
import type {
  DirectoryListingInput,
  DirectoryListingPage,
} from '../../core/directory/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import {
  after,
  categoryIdOf,
  db,
  insertCategory,
  insertProduct,
  insertUser,
  productIdOf,
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
const SUSPENDED_OWNER = 2;
const WITHDRAWN_OWNER = 3;

const LOSER = 99;

const TOOLS = 1;
const GAMES = 2;
const LOSERS_ONLY = 3;
const EMPTY = 4;

const listing = new D1DirectoryListing(db);

const NO_CONDITIONS: DirectoryListingInput = {
  matchExpression: undefined,
  categoryId: undefined,
  from: undefined,
  to: undefined,
  sort: 'newest',
  page: 1,
};

function inCategory(
  category: number,
  conditions: Partial<DirectoryListingInput> = {},
): Promise<DirectoryListingPage> {
  return listing.page({
    ...NO_CONDITIONS,
    categoryId: categoryIdOf(category),
    ...conditions,
  });
}

async function listedIdsIn(
  category: number,
  conditions: Partial<DirectoryListingInput> = {},
): Promise<string[]> {
  const { rows } = await inCategory(category, conditions);
  return rows.map((row) => row.productId);
}

function idsOf(indexes: readonly number[]): string[] {
  return indexes.map(productIdOf);
}

function matchExpressionOf(query: string): string {
  const expression = buildFtsMatchExpression(normalizeSearchTerms(query));
  if (expression === undefined) {
    throw new Error(`検索語「${query}」から検索式を作れない`);
  }
  return expression;
}

function winAt(
  match: number,
  product: number,
  date: string,
  upvotes = 1,
  owner = OWNER,
): QualifierFixture {
  return winOf(match, { product, owner, date, upvotes, opponent: LOSER });
}

// 相手のLOSERは「その他」のカテゴリで、勝利して掲載中になる
function lossAt(
  match: number,
  product: number,
  date: string,
): QualifierFixture {
  return {
    match,
    date,
    sides: [
      { product: LOSER, owner: OWNER, result: 'won' },
      { product, owner: OWNER, result: 'lost' },
    ],
  };
}

beforeEach(async () => {
  await clearDirectoryTables();
  await insertUser(OWNER);
  await insertCategory(TOOLS);
  await insertCategory(GAMES);
  await insertCategory(LOSERS_ONLY);
  await insertCategory(EMPTY);
  await insertProduct(LOSER, OWNER);
});

describe('カテゴリの絞り込み', () => {
  const ROCKET_TOOL = 1;
  const QUIET_TOOL = 2;
  const OLD_ROCKET_TOOL = 3;
  const LOST_TOOL = 4;
  const ROCKET_GAME = 5;

  beforeEach(async () => {
    const tools = { categoryId: categoryIdOf(TOOLS) };
    await insertProduct(ROCKET_TOOL, OWNER, {
      ...tools,
      name: 'Rocket Notes',
    });
    await insertProduct(QUIET_TOOL, OWNER, { ...tools, name: 'Quiet Notes' });
    await insertProduct(OLD_ROCKET_TOOL, OWNER, {
      ...tools,
      name: 'Rocket Ledger',
    });
    await insertProduct(LOST_TOOL, OWNER, { ...tools, name: 'Rocket Lost' });
    await insertProduct(ROCKET_GAME, OWNER, {
      categoryId: categoryIdOf(GAMES),
      name: 'Rocket Arcade',
    });
    await insertQualifiers([
      winAt(1, ROCKET_TOOL, '2026-11-18', 3),
      winAt(2, QUIET_TOOL, '2026-11-20', 9),
      winAt(3, OLD_ROCKET_TOOL, '2026-11-10', 5),
      lossAt(4, LOST_TOOL, '2026-11-19'),
      winAt(5, ROCKET_GAME, '2026-11-21', 7),
    ]);
    await indexProduct(ROCKET_TOOL);
    await indexProduct(QUIET_TOOL);
    await indexProduct(OLD_ROCKET_TOOL);
    await indexProduct(ROCKET_GAME);
  });

  test('指定したカテゴリの掲載中のプロダクトだけを返し、総件数もカテゴリで絞る', async () => {
    const page = await inCategory(TOOLS);

    expect(page.rows.map((row) => row.productId)).toEqual(
      idsOf([QUIET_TOOL, ROCKET_TOOL, OLD_ROCKET_TOOL]),
    );
    expect(page.totalCount).toBe(3);
    expect(await listedIdsIn(GAMES)).toEqual(idsOf([ROCKET_GAME]));
  });

  test('期間と組み合わせると、カテゴリと期間の両方を満たすプロダクトだけを数える', async () => {
    const page = await inCategory(TOOLS, {
      from: parseBusinessDate('2026-11-15'),
      to: parseBusinessDate('2026-11-21'),
    });

    expect(page.rows.map((row) => row.productId)).toEqual(
      idsOf([QUIET_TOOL, ROCKET_TOOL]),
    );
    expect(page.totalCount).toBe(2);
  });

  test('検索と関連度の並び順と組み合わせると、カテゴリ内で検索語に一致するプロダクトだけを数える', async () => {
    const page = await inCategory(TOOLS, {
      matchExpression: matchExpressionOf('rocket'),
      sort: 'relevance',
    });

    expect(page.rows.map((row) => row.productId).toSorted()).toEqual(
      idsOf([ROCKET_TOOL, OLD_ROCKET_TOOL]).toSorted(),
    );
    expect(page.totalCount).toBe(2);
  });

  test('並び順と組み合わせると、カテゴリ内で並び順に従って並べる', async () => {
    expect(await listedIdsIn(TOOLS, { sort: 'upvotes' })).toEqual(
      idsOf([QUIET_TOOL, OLD_ROCKET_TOOL, ROCKET_TOOL]),
    );
    expect(await listedIdsIn(TOOLS, { sort: 'oldest' })).toEqual(
      idsOf([OLD_ROCKET_TOOL, ROCKET_TOOL, QUIET_TOOL]),
    );
  });

  test('掲載中のプロダクトが無いカテゴリは空の一覧と0件を返す', async () => {
    expect(await inCategory(EMPTY)).toEqual<DirectoryListingPage>({
      totalCount: 0,
      rows: [],
    });
  });
});

describe('カテゴリごとの掲載数', () => {
  const LISTED_TOOL = 1;
  const TWICE_WON_TOOL = 2;
  const LOST_TOOL = 3;
  const HIDDEN_TOOL = 4;
  const DELETED_TOOL = 5;
  const SUSPENDED_TOOL = 6;
  const WITHDRAWN_TOOL = 7;
  const UNDECIDED_TOOL = 8;
  const LISTED_GAME = 9;
  const LOST_IN_LOSERS_ONLY = 10;

  beforeEach(async () => {
    const tools = { categoryId: categoryIdOf(TOOLS) };
    await insertUser(SUSPENDED_OWNER, {
      status: 'suspended',
      suspendedAt: after(1),
    });
    await insertUser(WITHDRAWN_OWNER, { deletedAt: after(2) });
    await insertProduct(LISTED_TOOL, OWNER, tools);
    await insertProduct(TWICE_WON_TOOL, OWNER, tools);
    await insertProduct(LOST_TOOL, OWNER, tools);
    await insertProduct(HIDDEN_TOOL, OWNER, { ...tools, hiddenAt: after(3) });
    await insertProduct(DELETED_TOOL, OWNER, {
      ...tools,
      deletedAt: after(4),
    });
    await insertProduct(SUSPENDED_TOOL, SUSPENDED_OWNER, tools);
    await insertProduct(WITHDRAWN_TOOL, WITHDRAWN_OWNER, tools);
    await insertProduct(UNDECIDED_TOOL, OWNER, tools);
    await insertProduct(LISTED_GAME, OWNER, {
      categoryId: categoryIdOf(GAMES),
    });
    await insertProduct(LOST_IN_LOSERS_ONLY, OWNER, {
      categoryId: categoryIdOf(LOSERS_ONLY),
    });
    await insertQualifiers([
      winAt(1, LISTED_TOOL, '2026-11-20'),
      winAt(2, TWICE_WON_TOOL, '2026-11-10'),
      winAt(3, TWICE_WON_TOOL, '2026-11-19'),
      lossAt(4, LOST_TOOL, '2026-11-18'),
      winAt(5, HIDDEN_TOOL, '2026-11-17'),
      winAt(6, DELETED_TOOL, '2026-11-16'),
      winAt(7, SUSPENDED_TOOL, '2026-11-15', 1, SUSPENDED_OWNER),
      winAt(8, WITHDRAWN_TOOL, '2026-11-14', 1, WITHDRAWN_OWNER),
      {
        match: 9,
        date: '2026-11-21',
        sides: [{ product: UNDECIDED_TOOL, owner: OWNER, result: null }],
      },
      winAt(10, LISTED_GAME, '2026-11-13'),
      lossAt(11, LOST_IN_LOSERS_ONLY, '2026-11-12'),
    ]);
  });

  test('掲載中のプロダクトだけをカテゴリごとに1つずつ数え、敗北だけ・未確定・非公開・論理削除・停止中や退会済みの投稿者のプロダクトを数えない', async () => {
    expect(await listing.countByCategory()).toEqual(
      new Map([
        [categoryIdOf(TOOLS), 2],
        [categoryIdOf(GAMES), 1],
        [PRODUCT_CATEGORY_OTHER_ID, 1],
      ]),
    );
  });

  test('掲載中のプロダクトが無いカテゴリは結果に含めない', async () => {
    const counts = await listing.countByCategory();

    expect(counts.has(categoryIdOf(LOSERS_ONLY))).toBe(false);
    expect(counts.has(categoryIdOf(EMPTY))).toBe(false);
  });

  test('掲載の数とカテゴリの絞り込みの総件数が一致する', async () => {
    const counts = await listing.countByCategory();

    expect((await inCategory(TOOLS)).totalCount).toBe(
      counts.get(categoryIdOf(TOOLS)),
    );
    expect((await inCategory(GAMES)).totalCount).toBe(
      counts.get(categoryIdOf(GAMES)),
    );
  });
});
