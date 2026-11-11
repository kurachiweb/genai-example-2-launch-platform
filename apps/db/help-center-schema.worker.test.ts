import { env } from 'cloudflare:workers';
import { eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { helpArticlePreviousHandles } from './schema/help/help-article-previous-handles.ts';
import { helpArticles } from './schema/help/help-articles.ts';
import { helpCategories } from './schema/help/help-categories.ts';

const OTHER_CATEGORY_ID = '01JC0000000000000000000001';

const ADMIN_ID = '01JC00000000000000000000A1';

const db = createDatabase(env.DB);

// Drizzleは単独のクエリの失敗をDrizzleQueryErrorで包んでD1のエラーをcauseに持つため、原因をたどって文言を集める
async function rejectionMessagesOf(
  pending: Promise<unknown>,
): Promise<string[]> {
  const reason: unknown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const messages: string[] = [];
  for (
    let current = reason;
    current instanceof Error;
    current = current.cause
  ) {
    messages.push(current.message);
  }
  return messages;
}

async function insertArticle(
  id: string,
  handle: string,
  overrides: Partial<typeof helpArticles.$inferInsert> = {},
): Promise<void> {
  await db.insert(helpArticles).values({
    id,
    handle,
    title: `タイトル${id}`,
    subtitle: 'サブタイトル',
    bodyMarkdown: '本文',
    categoryId: OTHER_CATEGORY_ID,
    status: 'draft',
    sortOrder: 1,
    createdByAdminId: ADMIN_ID,
    ...overrides,
  });
}

interface RawArticleValues {
  readonly pinned: number;
  readonly status: string;
  readonly sortOrder: number;
  readonly revision: number;
}

const VALID_RAW_ARTICLE: RawArticleValues = {
  pinned: 0,
  status: 'draft',
  sortOrder: 1,
  revision: 1,
};

// CHECKの違反を確かめるため、Drizzleの型を通さずに値を渡す
function insertRawArticle(overrides: Partial<RawArticleValues>) {
  const values = { ...VALID_RAW_ARTICLE, ...overrides };
  return env.DB.prepare(
    'INSERT INTO help_articles (id, handle, title, subtitle, body_markdown, category_id, pinned, status, sort_order, created_by_admin_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)',
  )
    .bind(
      '01JC00000000000000000000R1',
      'raw-article',
      'タイトル',
      'サブタイトル',
      '本文',
      OTHER_CATEGORY_ID,
      values.pinned,
      values.status,
      values.sortOrder,
      ADMIN_ID,
      values.revision,
    )
    .run();
}

function insertRawCategory(systemDefault: number, sortOrder: number) {
  return env.DB.prepare(
    "INSERT INTO help_categories (id, name, system_default, sort_order, created_at, updated_at) VALUES ('01JC00000000000000000000C9', 'Invalid', ?, ?, 0, 0)",
  )
    .bind(systemDefault, sortOrder)
    .run();
}

beforeEach(async () => {
  await db.delete(helpArticlePreviousHandles);
  await db.delete(helpArticles);
  await db
    .delete(helpCategories)
    .where(ne(helpCategories.id, OTHER_CATEGORY_ID));
});

describe('大文字小文字を区別しない一意の列', () => {
  test('大文字小文字だけが違う名前のカテゴリは作れない', async () => {
    await db.insert(helpCategories).values({ name: 'Account', sortOrder: 2 });

    expect(
      await rejectionMessagesOf(
        db.insert(helpCategories).values({ name: 'ACCOUNT', sortOrder: 3 }),
      ),
    ).toContainEqual(
      expect.stringContaining('UNIQUE constraint failed: help_categories.name'),
    );
  });

  test('大文字小文字だけが違うハンドルの記事は、下書きと公開を問わず作れない', async () => {
    await insertArticle('01JC00000000000000000000P1', 'Getting-Started');

    expect(
      await rejectionMessagesOf(
        insertArticle('01JC00000000000000000000P2', 'getting-started', {
          status: 'published',
        }),
      ),
    ).toContainEqual(
      expect.stringContaining('UNIQUE constraint failed: help_articles.handle'),
    );
  });

  test('大文字小文字だけが違う旧ハンドルは、別の記事でも作れない', async () => {
    await insertArticle('01JC00000000000000000000P1', 'first');
    await insertArticle('01JC00000000000000000000P2', 'second');
    await db
      .insert(helpArticlePreviousHandles)
      .values({ ownerId: '01JC00000000000000000000P1', handle: 'OldName' });

    expect(
      await rejectionMessagesOf(
        db
          .insert(helpArticlePreviousHandles)
          .values({ ownerId: '01JC00000000000000000000P2', handle: 'OLDNAME' }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: help_article_previous_handles.handle',
      ),
    );
  });
});

describe('記事の旧ハンドル', () => {
  test('1件の記事に2つ目の旧ハンドルは作れない', async () => {
    await insertArticle('01JC00000000000000000000P1', 'first');
    await db
      .insert(helpArticlePreviousHandles)
      .values({ ownerId: '01JC00000000000000000000P1', handle: 'older' });

    expect(
      await rejectionMessagesOf(
        db
          .insert(helpArticlePreviousHandles)
          .values({ ownerId: '01JC00000000000000000000P1', handle: 'oldest' }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: help_article_previous_handles.article_id',
      ),
    );
  });

  test('旧ハンドルを残したまま記事を消すと外部キーで拒否され、旧ハンドルを先に消せば消せる', async () => {
    await insertArticle('01JC00000000000000000000P1', 'first');
    await db
      .insert(helpArticlePreviousHandles)
      .values({ ownerId: '01JC00000000000000000000P1', handle: 'older' });

    expect(
      await rejectionMessagesOf(
        db
          .delete(helpArticles)
          .where(eq(helpArticles.id, '01JC00000000000000000000P1')),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));

    await db.batch([
      db
        .delete(helpArticlePreviousHandles)
        .where(
          eq(helpArticlePreviousHandles.ownerId, '01JC00000000000000000000P1'),
        ),
      db
        .delete(helpArticles)
        .where(eq(helpArticles.id, '01JC00000000000000000000P1')),
    ]);
    expect(await db.$count(helpArticles)).toBe(0);
  });
});

describe('記事のカテゴリと作成者', () => {
  test('存在しないカテゴリの記事は外部キーで拒否される', async () => {
    expect(
      await rejectionMessagesOf(
        insertArticle('01JC00000000000000000000P1', 'first', {
          categoryId: '01JC00000000000000000000X9',
        }),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));
  });

  test('作成者のIDは管理者の行が無くても保存でき、同じカテゴリで並び順が同じ値の記事も作れる', async () => {
    await insertArticle('01JC00000000000000000000P1', 'first', {
      createdByAdminId: '01JC00000000000000000000Z9',
    });
    await insertArticle('01JC00000000000000000000P2', 'second');

    expect(
      await db
        .select({
          revision: helpArticles.revision,
          pinned: helpArticles.pinned,
        })
        .from(helpArticles),
    ).toEqual([
      { revision: 1, pinned: false },
      { revision: 1, pinned: false },
    ]);
  });
});

describe('記事のCHECK制約', () => {
  test.each([
    ['pinned', { pinned: 2 }, 'help_articles_pinned_check'],
    ['status', { status: 'archived' }, 'help_articles_status_check'],
    ['sort_order', { sortOrder: 0 }, 'help_articles_sort_order_check'],
    ['revision', { revision: 0 }, 'help_articles_revision_check'],
  ] as const)(
    '%sの範囲外の値を拒否する',
    async (_column, overrides, constraint) => {
      expect(
        await rejectionMessagesOf(insertRawArticle(overrides)),
      ).toContainEqual(
        expect.stringContaining(`CHECK constraint failed: ${constraint}`),
      );
      expect(await db.$count(helpArticles)).toBe(0);
    },
  );

  test('範囲内の値は受け付ける', async () => {
    await insertRawArticle({ pinned: 1, status: 'published' });

    expect(await db.$count(helpArticles)).toBe(1);
  });
});

describe('カテゴリのCHECK制約', () => {
  test('標準カテゴリの印は0・1以外の値を拒否する', async () => {
    expect(await rejectionMessagesOf(insertRawCategory(2, 2))).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: help_categories_system_default_check',
      ),
    );
  });

  test('並び順は1未満の値を拒否する', async () => {
    expect(await rejectionMessagesOf(insertRawCategory(0, 0))).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: help_categories_sort_order_check',
      ),
    );
  });
});
