import { inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { reportCases } from './report-cases.ts';
import { reportCategories } from './report-categories.ts';

const NOTICE_STATUSES = reportCases.posterNoticeStatus.enumValues;

const timestampMs = () => integer({ mode: 'timestamp_ms' });

export const reports = snakeCase.table(
  'reports',
  {
    id: ulidPrimaryKey(),
    caseId: text()
      .notNull()
      .references(() => reportCases.id),
    reporterUserId: text().references(() => users.id),
    contactEmail: text(),
    categoryId: text()
      .notNull()
      .references(() => reportCategories.id),
    categoryName: text().notNull(),
    reason: text().notNull(),
    reportedAt: timestampMs().notNull(),
    outcomeNoticeStatus: text({ enum: NOTICE_STATUSES })
      .notNull()
      .default('none'),
    outcomeNoticeRequestedAt: timestampMs(),
    ...timestamps(),
    ...softDelete(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('reports_case_id_reported_at_idx').on(table.caseId, table.reportedAt),
    index('reports_reporter_user_id_idx').on(table.reporterUserId),
    index('reports_category_id_idx').on(table.categoryId),
    index('reports_outcome_notice_status_case_id_idx').on(
      table.outcomeNoticeStatus,
      table.caseId,
    ),
    check(
      'reports_outcome_notice_status_check',
      inArray(table.outcomeNoticeStatus, NOTICE_STATUSES).inlineParams(),
    ),
    check(
      'reports_contact_email_check',
      sql`not (${table.reporterUserId} is not null and ${table.contactEmail} is not null)`,
    ),
  ],
);
