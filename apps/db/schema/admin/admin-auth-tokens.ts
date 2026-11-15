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
import { admins } from './admins.ts';

const ADMIN_AUTH_TOKEN_PURPOSE_VALUES = [
  'invitation',
  'email_change',
  'password_reset',
] as const;

export const adminAuthTokens = snakeCase.table(
  'admin_auth_tokens',
  {
    id: ulidPrimaryKey(),
    adminId: text()
      .notNull()
      .references(() => admins.id),
    purpose: text({ enum: ADMIN_AUTH_TOKEN_PURPOSE_VALUES }).notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    newEmail: textNoCase(),
    ...timestamps(),
  },
  (table) => [
    index('admin_auth_tokens_admin_id_purpose_idx').on(
      table.adminId,
      table.purpose,
    ),
    index('admin_auth_tokens_expires_at_idx').on(table.expiresAt),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'admin_auth_tokens_purpose_check',
      inArray(table.purpose, ADMIN_AUTH_TOKEN_PURPOSE_VALUES).inlineParams(),
    ),
  ],
);
