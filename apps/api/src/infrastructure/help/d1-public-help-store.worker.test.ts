import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from '../../../common-lib/help/help-category-constants.ts';
import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from '../../../common-lib/search/search-terms.ts';
import { createDatabase } from '../../../db/client.ts';
import { helpArticles } from '../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../db/schema/help/help-categories.ts';
import {
  db,
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpArticlePreviousHandle,
  insertHelpCategory,
  T0,
} from '../../../lib/workers/help/testing/help-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type {
  PublicHelpSearchHitRecord,
  PublishedHelpArticleRecord,
} from '../../application/help/ports.ts';
import { D1PublicHelpStore } from './d1-public-help-store.ts';
import {
  createArticleStore,
  indexPublishedHelpArticle,
  resetHelpArticleTables,
  savedRecordOf,
  updateInputOf,
} from './testing/help-article-store-fixtures.ts';

const USAGE = 1;
const EMPTY = 2;

const CREATED_LATER = new Date('2026-11-02T00:00:00.000Z');
const UPDATED_AT = new Date('2026-11-03T04:05:06.000Z');

const store = new D1PublicHelpStore(db);

function publishedOf(
  articleIndex: number,
  overrides: Partial<PublishedHelpArticleRecord> = {},
): PublishedHelpArticleRecord {
  return {
    id: helpArticleIdOf(articleIndex),
    handle: `article${String(articleIndex)}`,
    title: `タイトル${String(articleIndex)}`,
    subtitle: `サブタイトル${String(articleIndex)}`,
    pinned: false,
    categoryId: HELP_CATEGORY_OTHER_ID,
    sortOrder: articleIndex,
    createdAt: T0,
    ...overrides,
  };
}

function matchExpressionOf(query: string): string {
  const expression = buildFtsMatchExpression(normalizeSearchTerms(query));
  if (expression === undefined) {
    throw new Error(`検索語「${query}」から検索式を作れない`);
  }
  return expression;
}

async function searchedIds(query: string, limit = 100): Promise<string[]> {
  const hits = await store.search(matchExpressionOf(query), limit);
  return hits.map(({ id }) => id);
}

const idsOf = (indexes: readonly number[]): string[] =>
  indexes.map(helpArticleIdOf);

beforeEach(async () => {
  await resetHelpArticleTables();
  await insertHelpCategory(USAGE, { name: '使い方', sortOrder: 3 });
  await insertHelpCategory(EMPTY, {
    name: '空のカテゴリ',
    sortOrder: 2,
    createdAt: CREATED_LATER,
  });
});

describe('D1PublicHelpStore', () => {
  describe('listPublished', () => {
    test('全カテゴリと公開の記事を並び順の列を含めて1回の一括の読み取りで返し、下書きを含まない', async () => {
      await insertHelpArticle(1, {
        categoryId: helpCategoryIdOf(USAGE),
        pinned: true,
        sortOrder: 2,
        createdAt: CREATED_LATER,
      });
      await insertHelpArticle(2, { categoryId: helpCategoryIdOf(USAGE) });
      await insertHelpArticle(3, { status: 'draft' });
      await insertHelpArticle(4);
      const recording = createBatchRecordingD1(env.DB);

      const published = await new D1PublicHelpStore(
        createDatabase(recording.d1),
      ).listPublished();

      expect(published).toEqual({
        categories: [
          {
            id: HELP_CATEGORY_OTHER_ID,
            name: HELP_CATEGORY_OTHER_NAME,
            sortOrder: 1,
            createdAt: expect.any(Date) as Date,
          },
          {
            id: helpCategoryIdOf(USAGE),
            name: '使い方',
            sortOrder: 3,
            createdAt: T0,
          },
          {
            id: helpCategoryIdOf(EMPTY),
            name: '空のカテゴリ',
            sortOrder: 2,
            createdAt: CREATED_LATER,
          },
        ],
        articles: [
          publishedOf(1, {
            categoryId: helpCategoryIdOf(USAGE),
            pinned: true,
            sortOrder: 2,
            createdAt: CREATED_LATER,
          }),
          publishedOf(2, { categoryId: helpCategoryIdOf(USAGE) }),
          publishedOf(4),
        ],
      });
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('公開の記事が無ければ記事を空にしてカテゴリを返す', async () => {
      await insertHelpArticle(1, { status: 'draft' });

      const published = await store.listPublished();

      expect(published.articles).toEqual([]);
      expect(published.categories.map(({ id }) => id)).toEqual([
        HELP_CATEGORY_OTHER_ID,
        helpCategoryIdOf(USAGE),
        helpCategoryIdOf(EMPTY),
      ]);
    });
  });

  describe('resolve', () => {
    test('公開の記事の現在のハンドルを大文字小文字を区別せずに解決する', async () => {
      await insertHelpArticle(1, { handle: 'Reset-Password' });

      expect(await store.resolve('reset-PASSWORD')).toEqual({
        kind: 'current',
        articleId: helpArticleIdOf(1),
      });
    });

    test('下書きの記事の現在のハンドルと存在しないハンドルは解決しない', async () => {
      await insertHelpArticle(1, { handle: 'draft-guide', status: 'draft' });

      expect(await store.resolve('draft-guide')).toEqual({ kind: 'none' });
      expect(await store.resolve('missing')).toEqual({ kind: 'none' });
    });

    test('旧ハンドルは保持者の状態によらず保持者へ解決する', async () => {
      await insertHelpArticle(1);
      await insertHelpArticle(2, { status: 'draft' });
      await insertHelpArticlePreviousHandle(1, 'Old-Guide');
      await insertHelpArticlePreviousHandle(2, 'old-draft');

      expect(await store.resolve('old-guide')).toEqual({
        kind: 'previous',
        articleId: helpArticleIdOf(1),
      });
      expect(await store.resolve('OLD-DRAFT')).toEqual({
        kind: 'previous',
        articleId: helpArticleIdOf(2),
      });
    });

    test('他の記事に解放された旧ハンドルの文字列は、新しい保持者の現在のハンドルとして解決する', async () => {
      await insertHelpArticle(1, { handle: 'new-guide' });
      await insertHelpArticlePreviousHandle(1, 'old-guide');
      await insertHelpArticle(2);
      savedRecordOf(
        await createArticleStore().update(
          updateInputOf(2, { handle: 'Old-Guide' }),
        ),
      );

      expect(await store.resolve('old-guide')).toEqual({
        kind: 'current',
        articleId: helpArticleIdOf(2),
      });
    });
  });

  describe('findPublishedDetail', () => {
    test('記事・カテゴリ名と、自身と下書きと他のカテゴリを除く公開の記事を1回の一括の読み取りで返す', async () => {
      await insertHelpArticle(1, {
        handle: 'Reset-Password',
        bodyMarkdown: '## 手順',
        categoryId: helpCategoryIdOf(USAGE),
        updatedAt: UPDATED_AT,
        createdByAdminId: '01JD0ADMN00000000000000009',
      });
      await insertHelpArticle(2, {
        categoryId: helpCategoryIdOf(USAGE),
        pinned: true,
      });
      await insertHelpArticle(3, {
        categoryId: helpCategoryIdOf(USAGE),
        status: 'draft',
      });
      await insertHelpArticle(4);
      await insertHelpArticle(5, { categoryId: helpCategoryIdOf(USAGE) });
      const recording = createBatchRecordingD1(env.DB);

      const detail = await new D1PublicHelpStore(
        createDatabase(recording.d1),
      ).findPublishedDetail(helpArticleIdOf(1));

      expect(detail).toEqual({
        ...publishedOf(1, {
          handle: 'Reset-Password',
          categoryId: helpCategoryIdOf(USAGE),
        }),
        bodyMarkdown: '## 手順',
        categoryName: '使い方',
        createdByAdminId: '01JD0ADMN00000000000000009',
        updatedAt: UPDATED_AT,
        sameCategory: [
          publishedOf(2, { categoryId: helpCategoryIdOf(USAGE), pinned: true }),
          publishedOf(5, { categoryId: helpCategoryIdOf(USAGE) }),
        ],
      });
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('同じカテゴリに他の公開の記事が無ければ同カテゴリの記事を空にする', async () => {
      await insertHelpArticle(1);

      expect(await store.findPublishedDetail(helpArticleIdOf(1))).toMatchObject(
        { sameCategory: [] },
      );
    });

    test.each([
      ['下書きの', { status: 'draft' } as const],
      ['存在しない', undefined],
    ])('%s記事はundefinedにする', async (_label, columns) => {
      await insertHelpArticle(2);
      if (columns !== undefined) {
        await insertHelpArticle(1, columns);
      }

      expect(
        await store.findPublishedDetail(helpArticleIdOf(1)),
      ).toBeUndefined();
    });
  });

  describe('findPublishedHandle', () => {
    test('公開の記事の現在のハンドルを保存した表記で返す', async () => {
      await insertHelpArticle(1, { handle: 'Reset-Password' });

      expect(await store.findPublishedHandle(helpArticleIdOf(1))).toBe(
        'Reset-Password',
      );
    });

    test('下書きの記事と存在しない記事はundefinedにする', async () => {
      await insertHelpArticle(1, { status: 'draft' });

      expect(
        await store.findPublishedHandle(helpArticleIdOf(1)),
      ).toBeUndefined();
      expect(
        await store.findPublishedHandle(helpArticleIdOf(9)),
      ).toBeUndefined();
    });
  });

  describe('search', () => {
    const ROCKET = 1;
    const OPERATORS = 2;
    const KEYWORD_ONLY = 3;
    const GARDEN = 4;
    const STALE_DRAFT = 5;

    beforeEach(async () => {
      await insertHelpArticle(ROCKET, {
        handle: 'rocketship',
        title: 'Rocketship',
        subtitle: 'Fly to the moon',
        categoryId: helpCategoryIdOf(USAGE),
      });
      await insertHelpArticle(OPERATORS, {
        title: 'Rocket or not Moon',
        subtitle: 'Plain',
      });
      await insertHelpArticle(KEYWORD_ONLY, {
        title: 'Plain',
        subtitle: 'Simple',
        bodyMarkdown: 'A **telescope** for the night sky',
      });
      await insertHelpArticle(GARDEN, { title: 'Garden', subtitle: 'Plants' });
      await insertHelpArticle(STALE_DRAFT, {
        title: 'Rocket draft',
        subtitle: 'Moon',
      });
      await indexPublishedHelpArticle(ROCKET);
      await indexPublishedHelpArticle(OPERATORS);
      await indexPublishedHelpArticle(KEYWORD_ONLY, ['Telescope']);
      await indexPublishedHelpArticle(GARDEN);
      await indexPublishedHelpArticle(STALE_DRAFT);
      // 下書きへ戻した後、索引から消える前の状態
      await db
        .update(helpArticles)
        .set({ status: 'draft' })
        .where(eq(helpArticles.id, helpArticleIdOf(STALE_DRAFT)));
    });

    test('タイトル・サブタイトル・キーワードを語の前方一致で照合し、下書きを除く', async () => {
      expect(await searchedIds('rock')).toEqual(idsOf([ROCKET, OPERATORS]));
      expect(await searchedIds('fly')).toEqual(idsOf([ROCKET]));
      expect(await searchedIds('tele')).toEqual(idsOf([KEYWORD_ONLY]));
      expect(await searchedIds('draft')).toEqual([]);
    });

    test('空白で区切った全ての語に一致する記事だけを、大文字小文字と全角半角の違いを無視して返す', async () => {
      expect(await searchedIds('ROCKET ｍｏｏｎ')).toEqual(
        idsOf([OPERATORS, ROCKET]),
      );
      expect(await searchedIds('rocket　garden')).toEqual([]);
    });

    test('タイトルの一致をサブタイトルの一致より関連度の高い順に返し、上限件数で打ち切る', async () => {
      expect(await searchedIds('moon')).toEqual(idsOf([OPERATORS, ROCKET]));
      expect(await searchedIds('moon', 1)).toEqual(idsOf([OPERATORS]));
    });

    test('現在のタイトル・ハンドル・カテゴリ名で返す', async () => {
      await db
        .update(helpArticles)
        .set({ title: 'Spaceship', handle: 'Spaceship' })
        .where(eq(helpArticles.id, helpArticleIdOf(ROCKET)));
      await db
        .update(helpCategories)
        .set({ name: 'はじめに' })
        .where(eq(helpCategories.id, helpCategoryIdOf(USAGE)));

      const hits = await store.search(matchExpressionOf('rocketship'), 100);

      expect(hits).toEqual<readonly PublicHelpSearchHitRecord[]>([
        {
          ...publishedOf(ROCKET, {
            handle: 'Spaceship',
            title: 'Spaceship',
            subtitle: 'Fly to the moon',
            categoryId: helpCategoryIdOf(USAGE),
          }),
          categoryName: 'はじめに',
        },
      ]);
    });

    test.each([
      ['閉じていない引用符', '"rocketship', [ROCKET]],
      ['OR', 'rocket OR moon', [OPERATORS]],
      ['NOT', 'rocket NOT moon', [OPERATORS]],
      ['NEAR', 'NEAR(rocket moon)', []],
      ['列の指定', 'title:garden', []],
      ['引用符と記号だけ', '" * -', []],
    ])(
      '検索の構文(%s)を演算子ではなく文字列として照合する',
      async (_label, query, expected) => {
        expect(await searchedIds(query)).toEqual(idsOf(expected));
      },
    );
  });
});
