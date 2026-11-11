import { env } from 'cloudflare:workers';
import { ne } from 'drizzle-orm';

import { HELP_CATEGORY_OTHER_ID } from '../../../../common-lib/help/help-category-constants.ts';
import { createDatabase } from '../../../../db/client.ts';
import { helpArticlePreviousHandles } from '../../../../db/schema/help/help-article-previous-handles.ts';
import { helpArticleSearchDocuments } from '../../../../db/schema/help/help-article-search-documents.ts';
import { helpArticles } from '../../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../../db/schema/help/help-categories.ts';

type HelpArticleRow = typeof helpArticles.$inferInsert;

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

// 初期データの標準カテゴリは残す
export async function clearHelpTables(): Promise<void> {
  await db.delete(helpArticleSearchDocuments);
  await db.delete(helpArticlePreviousHandles);
  await db.delete(helpArticles);
  await db
    .delete(helpCategories)
    .where(ne(helpCategories.id, HELP_CATEGORY_OTHER_ID));
}
