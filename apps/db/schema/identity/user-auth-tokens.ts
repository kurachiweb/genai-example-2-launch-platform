import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';
import { users } from './users.ts';

const AUTH_TOKEN_PURPOSES = [
  'email_verification',
  'email_change',
  'password_reset',
  'password_change',
] as const;

export const userAuthTokens = snakeCase.table(
  'user_auth_tokens',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    purpose: text({ enum: AUTH_TOKEN_PURPOSES }).notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    newEmail: textNoCase(),
    pendingPasswordHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('user_auth_tokens_user_id_purpose_idx').on(
      table.userId,
      table.purpose,
    ),
    index('user_auth_tokens_expires_at_idx').on(table.expiresAt),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'user_auth_tokens_purpose_check',
      inArray(table.purpose, AUTH_TOKEN_PURPOSES).inlineParams(),
    ),
  ],
);
