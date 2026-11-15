import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';
import { users } from '../identity/users.ts';
import { productCategories } from './product-categories.ts';

export const products = snakeCase.table(
  'products',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    categoryId: text()
      .notNull()
      .references(() => productCategories.id),
    handle: textNoCase().notNull().unique(),
    name: text().notNull(),
    tagline: text().notNull(),
    websiteUrl: text().notNull(),
    descriptionMarkdown: text().notNull(),
    // media_filesの行は保有者と別の時期に物理削除されるため、削除の順に縛られないよう外部キーにしない
    logoFileId: text().notNull(),
    latestLaunchDate: text().notNull(),
    version: integer().notNull().default(0),
    hiddenAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('products_user_id_latest_launch_date_id_idx').on(
      table.userId,
      table.latestLaunchDate,
      table.id,
    ),
    index('products_category_id_idx').on(table.categoryId),
    index('products_deleted_at_idx').on(table.deletedAt),
  ],
);
