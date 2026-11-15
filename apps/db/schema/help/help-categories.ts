import { sql } from 'drizzle-orm';
import { check, index, integer, snakeCase } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';

export const helpCategories = snakeCase.table(
  'help_categories',
  {
    id: ulidPrimaryKey(),
    name: textNoCase().notNull().unique(),
    systemDefault: integer({ mode: 'boolean' }).notNull().default(false),
    sortOrder: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('help_categories_sort_order_idx').on(table.sortOrder),
    check(
      'help_categories_system_default_check',
      sql`${table.systemDefault} in (0, 1)`,
    ),
    check('help_categories_sort_order_check', sql`${table.sortOrder} >= 1`),
  ],
);
