import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { products } from '../product/products.ts';

export const directoryEntries = snakeCase.table(
  'directory_entries',
  {
    id: ulidPrimaryKey(),
    productId: text()
      .notNull()
      .unique()
      .references(() => products.id),
    // 利用者の物理削除の順に縛られないよう外部キーにしない。行はプロダクトの物理削除の前に消える
    ownerUserId: text().notNull(),
    firstWonAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('directory_entries_owner_user_id_idx').on(table.ownerUserId),
  ],
);
