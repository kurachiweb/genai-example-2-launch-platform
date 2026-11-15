import { inArray } from 'drizzle-orm';
import { check, snakeCase, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { notificationPreferences } from './notification-preferences.ts';

export const notificationUnsubscribeTokens = snakeCase.table(
  'notification_unsubscribe_tokens',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    topic: text({ enum: notificationPreferences.topic.enumValues }).notNull(),
    seed: text().notNull(),
    tokenHash: text().notNull(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('notification_unsubscribe_tokens_user_id_topic_unique').on(
      table.userId,
      table.topic,
    ),
    uniqueIndex('notification_unsubscribe_tokens_token_hash_unique').on(
      table.tokenHash,
    ),
    check(
      'notification_unsubscribe_tokens_topic_check',
      inArray(
        table.topic,
        notificationPreferences.topic.enumValues,
      ).inlineParams(),
    ),
  ],
);
