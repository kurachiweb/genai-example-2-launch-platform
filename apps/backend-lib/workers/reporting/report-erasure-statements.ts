import type { BatchItem } from 'drizzle-orm/batch';

export interface ReportErasureStatements {
  logicalDeleteByReporterStatement(
    userId: string,
    at: Date,
  ): BatchItem<'sqlite'>;
}
