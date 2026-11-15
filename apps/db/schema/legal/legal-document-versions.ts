import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { legalDocuments } from './legal-documents.ts';

export const legalDocumentVersions = snakeCase.table(
  'legal_document_versions',
  {
    id: ulidPrimaryKey(),
    documentId: text()
      .notNull()
      .references(() => legalDocuments.id),
    versionNumber: integer().notNull(),
    body: text().notNull(),
    changeSummary: text().notNull(),
    publishedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    // 管理者の物理削除の後も公開した管理者のIDを残すため、外部キーにしない
    publishedByAdminId: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('legal_document_versions_document_id_version_number_unique').on(
      table.documentId,
      table.versionNumber,
    ),
    index('legal_document_versions_document_id_published_at_idx').on(
      table.documentId,
      table.publishedAt,
    ),
  ],
);
