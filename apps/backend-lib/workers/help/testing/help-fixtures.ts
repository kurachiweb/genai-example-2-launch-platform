import { env } from 'cloudflare:workers';
import { ne } from 'drizzle-orm';

import { HELP_CATEGORY_OTHER_ID } from '../../../../common-lib/help/help-category-constants.ts';
import { createDatabase } from '../../../../db/client.ts';
import { helpArticlePreviousHandles } from '../../../../db/schema/help/help-article-previous-handles.ts';
import { helpArticleSearchDocuments } from '../../../../db/schema/help/help-article-search-documents.ts';
import { helpArticles } from '../../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../../db/schema/help/help-categories.ts';

type HelpArticleRow = typeof helpArticles.$inferInsert;

type HelpCategoryRow = typeof helpCategories.$inferInsert;

export const T0 = new Date('2026-11-01T00:00:00.000Z');

export const db = createDatabase(env.DB);

export const HELP_AUTHOR_ADMIN_ID = '01JD0ADMN00000000000000001';

export function helpArticleIdOf(index: number): string {
  return `01JD0HART${String(index).padStart(17, '0')}`;
}

export async function insertHelpArticle(
  index: number,
  columns: Partial<HelpArticleRow> = {},
): Promise<void> {
  await db.insert(helpArticles).values({
    id: helpArticleIdOf(index),
    handle: `article${String(index)}`,
    title: `タイトル${String(index)}`,
    subtitle: `サブタイトル${String(index)}`,
    bodyMarkdown: `本文${String(index)}`,
    categoryId: HELP_CATEGORY_OTHER_ID,
    status: 'published',
    sortOrder: index,
    createdByAdminId: HELP_AUTHOR_ADMIN_ID,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

export function helpCategoryIdOf(index: number): string {
  return `01JD0HCAT${String(index).padStart(17, '0')}`;
}

// 初期データの標準カテゴリ(並び順1)の後ろに並ぶ
export async function insertHelpCategory(
  index: number,
  columns: Partial<HelpCategoryRow> = {},
): Promise<void> {
  await db.insert(helpCategories).values({
    id: helpCategoryIdOf(index),
    name: `カテゴリ${String(index)}`,
    sortOrder: index + 1,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

export function helpPreviousHandleIdOf(articleIndex: number): string {
  return `01JD0HPRV${String(articleIndex).padStart(17, '0')}`;
}

export async function insertHelpArticlePreviousHandle(
  articleIndex: number,
  handle: string,
): Promise<void> {
  await db.insert(helpArticlePreviousHandles).values({
    id: helpPreviousHandleIdOf(articleIndex),
    ownerId: helpArticleIdOf(articleIndex),
    handle,
    createdAt: T0,
    updatedAt: T0,
  });
}

// 初期データの標準カテゴリは残す
export async function clearHelpTables(): Promise<void> {
  await db.delete(helpArticleSearchDocuments);
  await db.delete(helpArticlePreviousHandles);
  await db.delete(helpArticles);
  await db
    .delete(helpCategories)
    .where(ne(helpCategories.id, HELP_CATEGORY_OTHER_ID));
}
