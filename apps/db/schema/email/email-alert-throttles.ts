import { integer, snakeCase } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';

export const emailAlertThrottles = snakeCase.table('email_alert_throttles', {
  id: ulidPrimaryKey(),
  name: textNoCase().notNull().unique(),
  lastReportedAt: integer({ mode: 'timestamp_ms' }).notNull(),
  ...timestamps(),
});
