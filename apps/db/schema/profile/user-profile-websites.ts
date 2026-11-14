import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

export const userProfileWebsites = snakeCase.table(
  'user_profile_websites',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    position: integer().notNull(),
    name: text(),
    url: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('user_profile_websites_user_id_position_unique').on(
      table.userId,
      table.position,
    ),
    // 上限の件数はcommon-libのPROFILE_WEBSITES_MAXと一致させる(apps/dbはcommon-libを読み込まない)
    check(
      'user_profile_websites_position_check',
      sql`${table.position} between 0 and 9`,
    ),
  ],
);
