import { inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { ulidPrimaryKey } from '../_shared/columns.ts';
import { memberInquiries } from './member-inquiries.ts';

const INQUIRY_SENDER_KIND_VALUES = ['user', 'admin'] as const;

export const inquiryMessages = snakeCase.table(
  'inquiry_messages',
  {
    id: ulidPrimaryKey(),
    inquiryId: text()
      .notNull()
      .references(() => memberInquiries.id),
    senderKind: text({ enum: INQUIRY_SENDER_KIND_VALUES }).notNull(),
    // 管理者の物理削除の後も返信を残すため、外部キーにしない
    adminId: text(),
    body: text().notNull(),
    createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('inquiry_messages_inquiry_id_created_at_id_idx').on(
      table.inquiryId,
      table.createdAt,
      table.id,
    ),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'inquiry_messages_sender_kind_check',
      inArray(table.senderKind, INQUIRY_SENDER_KIND_VALUES).inlineParams(),
    ),
    check(
      'inquiry_messages_admin_id_check',
      sql`(${table.senderKind} = 'admin') = (${table.adminId} is not null)`,
    ),
  ],
);
