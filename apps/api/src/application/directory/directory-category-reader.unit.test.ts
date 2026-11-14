import { describe, expect, test } from 'bun:test';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/product/product-category-constants.ts';
import type { DirectoryListingQuery } from '../../../lib/core/directory/ports.ts';
import type {
  ProductCategoryDirectory,
  ProductCategoryRecord,
} from '../../../lib/core/product/ports.ts';
import { CountedDirectoryCategoryReader } from './directory-category-reader.ts';

const categoryOf = (
  id: string,
  name: string,
  handle: string,
): ProductCategoryRecord => ({
  id,
  name,
  handle,
  systemDefault: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const OTHER: ProductCategoryRecord = {
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
  handle: PRODUCT_CATEGORY_OTHER_HANDLE,
  systemDefault: true,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
};

const DEVTOOLS = categoryOf('cat-devtools', '開発ツール', 'devtools');
const AI = categoryOf('cat-ai', 'AI', 'ai');
const DESIGN = categoryOf('cat-design', 'デザイン', 'design');
const GAMES = categoryOf('cat-games', 'ゲーム', 'games');

const unexpected = (): never => {
  throw new Error('呼ばれない想定の照会');
};

function setup(
  categories: readonly ProductCategoryRecord[],
  counts: ReadonlyMap<string, number>,
) {
  const calls = { list: 0, countByCategory: 0 };
  const directory: ProductCategoryDirectory = {
    list: () => {
      calls.list += 1;
      return Promise.resolve(categories);
    },
    findByHandle: unexpected,
  };
  const listing: DirectoryListingQuery = {
    page: unexpected,
    countByCategory: () => {
      calls.countByCategory += 1;
      return Promise.resolve(counts);
    },
  };
  return {
    reader: new CountedDirectoryCategoryReader(directory, listing),
    calls,
  };
}

const handlesOf = (categories: readonly ProductCategoryRecord[]) =>
  categories.map(({ handle }) => handle);

describe('DirectoryCategoryReader.list', () => {
  test('掲載中のプロダクトの数が多い順に並べる', async () => {
    const { reader } = setup(
      [DEVTOOLS, AI, DESIGN],
      new Map([
        [DEVTOOLS.id, 2],
        [AI.id, 5],
        [DESIGN.id, 3],
      ]),
    );

    expect(handlesOf(await reader.list())).toEqual([
      'ai',
      'design',
      'devtools',
    ]);
  });

  test('同数は名称順に並べる', async () => {
    const { reader } = setup(
      [DEVTOOLS, GAMES, DESIGN, AI],
      new Map([
        [DEVTOOLS.id, 1],
        [GAMES.id, 1],
        [DESIGN.id, 1],
        [AI.id, 1],
      ]),
    );

    expect(handlesOf(await reader.list())).toEqual([
      'ai',
      'games',
      'design',
      'devtools',
    ]);
  });

  test('「その他」は掲載数によらず末尾に置く', async () => {
    const { reader } = setup(
      [DEVTOOLS, AI, OTHER],
      new Map([
        [OTHER.id, 9],
        [DEVTOOLS.id, 1],
      ]),
    );

    expect(handlesOf(await reader.list())).toEqual([
      'devtools',
      'ai',
      PRODUCT_CATEGORY_OTHER_HANDLE,
    ]);
  });

  test('掲載の無いカテゴリも0件として含める', async () => {
    const { reader } = setup([OTHER, DESIGN, AI], new Map());

    expect(handlesOf(await reader.list())).toEqual([
      'ai',
      'design',
      PRODUCT_CATEGORY_OTHER_HANDLE,
    ]);
  });

  test('カテゴリの一覧と掲載数をそれぞれ1回ずつ照会し、カテゴリの記録をそのまま返す', async () => {
    const { reader, calls } = setup([AI], new Map([[AI.id, 1]]));

    expect(await reader.list()).toEqual([AI]);
    expect(calls).toEqual({ list: 1, countByCategory: 1 });
  });
});
