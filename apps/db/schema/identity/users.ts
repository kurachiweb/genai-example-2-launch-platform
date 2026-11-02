import { inArray, isNull } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';

export const USER_STATUSES = ['active', 'suspended'] as const;

export const DISPOSABLE_EMAIL_STATUSES = [
  'disposable',
  'regular',
  'undetermined',
] as const;

export const users = snakeCase.table(
  'users',
  {
    id: ulidPrimaryKey(),
    pseudonymousId: text().notNull().unique(),
    email: textNoCase().notNull(),
    passwordHash: text().notNull(),
    nickname: text().notNull(),
    handle: textNoCase().notNull().unique(),
    status: text({ enum: USER_STATUSES }).notNull().default('active'),
    suspendedAt: integer({ mode: 'timestamp_ms' }),
    emailVerifiedAt: integer({ mode: 'timestamp_ms' }),
    disposableEmailStatus: text({ enum: DISPOSABLE_EMAIL_STATUSES }),
    disposableEmailCheckedAt: integer({ mode: 'timestamp_ms' }),
    termsAgreedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    lifecycleVersion: integer().notNull().default(0),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    uniqueIndex('users_email_not_deleted_unique')
      .on(table.email)
      .where(isNull(table.deletedAt)),
    index('users_deleted_at_idx').on(table.deletedAt),
    index('users_status_deleted_at_idx').on(table.status, table.deletedAt),
    index('users_disposable_email_status_checked_at_idx').on(
      table.disposableEmailStatus,
      table.disposableEmailCheckedAt,
    ),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'users_status_check',
      inArray(table.status, USER_STATUSES).inlineParams(),
    ),
  ],
);
