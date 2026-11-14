import { index, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { admins } from './admins.ts';

export const adminRecoveryCodes = snakeCase.table(
  'admin_recovery_codes',
  {
    id: ulidPrimaryKey(),
    adminId: text()
      .notNull()
      .references(() => admins.id),
    codeHash: text().notNull().unique(),
    ...timestamps(),
  },
  (table) => [index('admin_recovery_codes_admin_id_idx').on(table.adminId)],
);
