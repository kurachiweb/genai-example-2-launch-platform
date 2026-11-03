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

const ADMIN_ROLE_VALUES = ['viewer', 'moderator', 'super_admin'] as const;

const ADMIN_STATUS_VALUES = ['invited', 'active'] as const;

export const admins = snakeCase.table(
  'admins',
  {
    id: ulidPrimaryKey(),
    email: textNoCase().notNull().unique(),
    passwordHash: text(),
    nickname: text(),
    title: text(),
    avatarFileId: text(),
    role: text({ enum: ADMIN_ROLE_VALUES }).notNull(),
    status: text({ enum: ADMIN_STATUS_VALUES }).notNull().default('invited'),
    invitationExpiresAt: integer({ mode: 'timestamp_ms' }),
    activatedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  (table) => [
    index('admins_role_status_idx').on(table.role, table.status),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'admins_role_check',
      inArray(table.role, ADMIN_ROLE_VALUES).inlineParams(),
    ),
    check(
      'admins_status_check',
      inArray(table.status, ADMIN_STATUS_VALUES).inlineParams(),
    ),
  ],
);
