import { inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

// 共用部品を読み込めないため、common-libのNOTIFICATION_TOPICSと同じ値・同じ順の写しを置く
const NOTIFICATION_TOPICS = [
  'match_preview',
  'match_result',
  'followed_user_match',
  'followed_user_award',
] as const;

export const notificationPreferences = snakeCase.table(
  'notification_preferences',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    topic: text({ enum: NOTIFICATION_TOPICS }).notNull(),
    enabled: integer({ mode: 'boolean' }).notNull(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('notification_preferences_user_id_topic_unique').on(
      table.userId,
      table.topic,
    ),
    index('notification_preferences_topic_enabled_user_id_idx').on(
      table.topic,
      table.enabled,
      table.userId,
    ),
    check(
      'notification_preferences_topic_check',
      inArray(table.topic, NOTIFICATION_TOPICS).inlineParams(),
    ),
    check(
      'notification_preferences_enabled_check',
      sql`${table.enabled} in (0, 1)`,
    ),
  ],
);
