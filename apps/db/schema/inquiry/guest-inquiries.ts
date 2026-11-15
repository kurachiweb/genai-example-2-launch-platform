import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { inquiryCategories } from './inquiry-categories.ts';
import { INQUIRY_STATUS_VALUES } from './member-inquiries.ts';

export const guestInquiries = snakeCase.table(
  'guest_inquiries',
  {
    id: ulidPrimaryKey(),
    categoryId: text()
      .notNull()
      .references(() => inquiryCategories.id),
    nickname: text().notNull(),
    email: text().notNull(),
    body: text().notNull(),
    status: text({ enum: INQUIRY_STATUS_VALUES }).notNull().default('open'),
    statusChangedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('guest_inquiries_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
    index('guest_inquiries_status_status_changed_at_idx').on(
      table.status,
      table.statusChangedAt,
    ),
    index('guest_inquiries_category_id_idx').on(table.categoryId),
    index('guest_inquiries_created_at_idx').on(table.createdAt),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'guest_inquiries_status_check',
      inArray(table.status, INQUIRY_STATUS_VALUES).inlineParams(),
    ),
  ],
);
