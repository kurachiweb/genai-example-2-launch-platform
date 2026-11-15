import { sql } from 'drizzle-orm';
import { check, integer, snakeCase } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';

export const productCategories = snakeCase.table(
  'product_categories',
  {
    id: ulidPrimaryKey(),
    name: textNoCase().notNull().unique(),
    handle: textNoCase().notNull().unique(),
    systemDefault: integer({ mode: 'boolean' }).notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    check(
      'product_categories_system_default_check',
      sql`${table.systemDefault} in (0, 1)`,
    ),
  ],
);
