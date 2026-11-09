import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { products } from './products.ts';

export const productScreenshots = snakeCase.table(
  'product_screenshots',
  {
    id: ulidPrimaryKey(),
    productId: text()
      .notNull()
      .references(() => products.id),
    position: integer().notNull(),
    // media_filesの行は保有者と別の時期に物理削除されるため、削除の順に縛られないよう外部キーにしない
    fileId: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('product_screenshots_product_id_position_unique').on(
      table.productId,
      table.position,
    ),
    // 上限の枚数はcommon-libのPRODUCT_SCREENSHOTS_MAXと一致させる(apps/dbはcommon-libを読み込まない)
    check(
      'product_screenshots_position_check',
      sql`${table.position} between 0 and 19`,
    ),
  ],
);
