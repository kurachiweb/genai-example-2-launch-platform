import { inArray } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

const LEGAL_DOCUMENT_KIND_VALUES = [
  'terms',
  'privacy',
  'legal-notice',
] as const;

export const legalDocuments = snakeCase.table(
  'legal_documents',
  {
    id: ulidPrimaryKey(),
    kind: text({ enum: LEGAL_DOCUMENT_KIND_VALUES }).notNull(),
    stateVersion: integer().notNull().default(0),
    latestVersionNumber: integer().notNull().default(0),
    draftBody: text(),
    draftSavedAt: integer({ mode: 'timestamp_ms' }),
    // 管理者の物理削除の後も保存した管理者のIDを残すため、外部キーにしない
    draftSavedByAdminId: text(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('legal_documents_kind_unique').on(table.kind),
    // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
    check(
      'legal_documents_kind_check',
      inArray(table.kind, LEGAL_DOCUMENT_KIND_VALUES).inlineParams(),
    ),
  ],
);
