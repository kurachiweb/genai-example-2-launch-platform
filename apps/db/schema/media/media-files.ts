import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

export const mediaFiles = snakeCase.table(
  'media_files',
  {
    id: ulidPrimaryKey(),
    objectKey: text().notNull().unique(),
    purpose: text().notNull(),
    storage: text({ enum: ['images', 'files'] }).notNull(),
    location: text({ enum: ['images', 'files', 'quarantine'] }).notNull(),
    ownerKind: text({ enum: ['user', 'admin', 'system'] }).notNull(),
    ownerId: text(),
    originalFileName: text().notNull(),
    contentType: text().notNull(),
    byteSize: integer().notNull(),
    width: integer(),
    height: integer(),
    storedAt: integer({ mode: 'timestamp_ms' }),
    attachedAt: integer({ mode: 'timestamp_ms' }),
    moderationStatus: text({
      enum: ['not_required', 'pending', 'passed', 'flagged', 'undetermined'],
    }).notNull(),
    moderationDetail: text({ mode: 'json' }),
    moderatedAt: integer({ mode: 'timestamp_ms' }),
    eraseRequestedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('media_files_owner_kind_owner_id_idx').on(
      table.ownerKind,
      table.ownerId,
    ),
    index('media_files_attached_at_created_at_idx').on(
      table.attachedAt,
      table.createdAt,
    ),
    index('media_files_deleted_at_idx').on(table.deletedAt),
    index('media_files_moderation_status_created_at_idx').on(
      table.moderationStatus,
      table.createdAt,
    ),
    index('media_files_erase_requested_at_idx').on(table.eraseRequestedAt),
    index('media_files_storage_location_idx').on(table.storage, table.location),
  ],
);
