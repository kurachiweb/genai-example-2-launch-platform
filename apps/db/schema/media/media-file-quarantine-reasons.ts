import { index, snakeCase, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { mediaFiles } from './media-files.ts';

export const mediaFileQuarantineReasons = snakeCase.table(
  'media_file_quarantine_reasons',
  {
    id: ulidPrimaryKey(),
    fileId: text()
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    reason: text({
      enum: ['auto', 'product_hidden', 'user_suspended', 'admin_action'],
    }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('media_file_quarantine_reasons_file_id_reason_unique').on(
      table.fileId,
      table.reason,
    ),
    index('media_file_quarantine_reasons_reason_created_at_idx').on(
      table.reason,
      table.createdAt,
    ),
  ],
);
