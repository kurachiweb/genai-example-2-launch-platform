import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

export const notificationSenderSettings = snakeCase.table(
  'notification_sender_settings',
  {
    id: ulidPrimaryKey(),
    settingKey: text().notNull(),
    businessName: text(),
    contactEmail: text(),
    postalAddress: text(),
    // 変更のたびに1つ進め、読み取った版との照合で他の管理者の変更との競合を検出する。版0は未設定を表す
    version: integer().notNull().default(0),
    // 管理者の物理削除の後も最後に変更した管理者のIDを残すため、外部キーにしない
    updatedByAdminId: text(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('notification_sender_settings_setting_key_unique').on(
      table.settingKey,
    ),
    check(
      'notification_sender_settings_version_check',
      sql`${table.version} >= 0`,
    ),
    check(
      'notification_sender_settings_values_by_version_check',
      sql`(${table.version} = 0 and ${table.businessName} is null and ${table.contactEmail} is null and ${table.postalAddress} is null) or (${table.version} >= 1 and ${table.businessName} is not null and ${table.contactEmail} is not null and ${table.postalAddress} is not null)`,
    ),
  ],
);
