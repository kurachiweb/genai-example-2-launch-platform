import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';
import { helpCategories } from './help-categories.ts';

// common-libのhelp/help-article-status.tsのHELP_ARTICLE_STATUSESの写しで(apps/dbはcommon-libを読み込まない)、一致はルートのconfig/help-contract-copies.unit.test.tsが確かめる
const HELP_ARTICLE_STATUSES = ['draft', 'published'] as const;

export const helpArticles = snakeCase.table(
  'help_articles',
  {
    id: ulidPrimaryKey(),
    handle: textNoCase().notNull().unique(),
    title: text().notNull(),
    subtitle: text().notNull(),
    bodyMarkdown: text().notNull(),
    categoryId: text()
      .notNull()
      .references(() => helpCategories.id),
    pinned: integer({ mode: 'boolean' }).notNull().default(false),
    status: text({ enum: HELP_ARTICLE_STATUSES }).notNull(),
    sortOrder: integer().notNull(),
    // 管理者の物理削除を妨げないよう外部キーにしない
    createdByAdminId: text().notNull(),
    revision: integer().notNull().default(1),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('help_articles_category_id_sort_order_idx').on(
      table.categoryId,
      table.sortOrder,
    ),
    index('help_articles_status_category_id_idx').on(
      table.status,
      table.categoryId,
    ),
    check('help_articles_pinned_check', sql`${table.pinned} in (0, 1)`),
    check(
      'help_articles_status_check',
      inArray(table.status, HELP_ARTICLE_STATUSES).inlineParams(),
    ),
    check('help_articles_sort_order_check', sql`${table.sortOrder} >= 1`),
    check('help_articles_revision_check', sql`${table.revision} >= 1`),
  ],
);

export const publishedHelpArticle: SQL = eq(helpArticles.status, 'published');
