import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

export const ultrasSettings = snakeCase.table(
  'ultras_settings',
  {
    id: ulidPrimaryKey(),
    settingKey: text().notNull(),
    enabled: integer({ mode: 'boolean' }).notNull().default(false),
    // 変更のたびに1つ進め、読み取った版との照合で他の管理者の変更との競合を検出する
    version: integer().notNull().default(0),
    // 管理者の物理削除の後も最後に変更した管理者のIDを残すため、外部キーにしない
    updatedByAdminId: text(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('ultras_settings_setting_key_unique').on(table.settingKey),
    check('ultras_settings_enabled_check', sql`${table.enabled} in (0, 1)`),
  ],
);
