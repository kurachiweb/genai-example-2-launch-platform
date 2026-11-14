import { index, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from './users.ts';

export const userRecoveryCodes = snakeCase.table(
  'user_recovery_codes',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    codeHash: text().notNull().unique(),
    ...timestamps(),
  },
  (table) => [index('user_recovery_codes_user_id_idx').on(table.userId)],
);
