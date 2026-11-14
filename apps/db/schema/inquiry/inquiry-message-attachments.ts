import {
  index,
  integer,
  primaryKey,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { inquiryMessages } from './inquiry-messages.ts';

export const inquiryMessageAttachments = snakeCase.table(
  'inquiry_message_attachments',
  {
    messageId: text()
      .notNull()
      .references(() => inquiryMessages.id),
    // ファイルの物理削除を妨げないため、外部キーにしない
    fileId: text().notNull(),
    position: integer().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'inquiry_message_attachments_message_id_file_id_pk',
      columns: [table.messageId, table.fileId],
    }),
    index('inquiry_message_attachments_file_id_idx').on(table.fileId),
  ],
);
