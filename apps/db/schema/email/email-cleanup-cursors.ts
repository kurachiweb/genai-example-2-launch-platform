import { snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';

export const emailCleanupCursors = snakeCase.table('email_cleanup_cursors', {
  id: ulidPrimaryKey(),
  name: textNoCase().notNull().unique(),
  afterKey: text(),
  ...timestamps(),
});
