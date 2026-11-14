import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { inquiryCategories } from './inquiry-categories.ts';

export const INQUIRY_STATUS_VALUES = [
  'open',
  'in_progress',
  'resolved',
  'rejected',
] as const;

export const memberInquiries = snakeCase.table(
  'member_inquiries',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    categoryId: text()
      .notNull()
      .references(() => inquiryCategories.id),
    status: text({ enum: INQUIRY_STATUS_VALUES }).notNull().default('open'),
    statusChangedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    lastMessageAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('member_inquiries_user_id_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
    index('member_inquiries_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
    index('member_inquiries_category_id_idx').on(table.categoryId),
    index('member_inquiries_created_at_idx').on(table.createdAt),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'member_inquiries_status_check',
      inArray(table.status, INQUIRY_STATUS_VALUES).inlineParams(),
    ),
  ],
);
