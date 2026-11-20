import type { BatchItem } from 'drizzle-orm/batch';

import type { NewModerationRecord } from '../../core/moderation/ports.ts';

export interface ModerationRecordStatements {
  insertStatement(record: NewModerationRecord): BatchItem<'sqlite'>;
}
