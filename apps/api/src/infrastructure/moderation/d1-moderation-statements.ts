import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import type { NewModerationRecord } from '../../../lib/core/moderation/ports.ts';
import type { ModerationRecordStatements } from '../../../lib/workers/moderation/moderation-record-statements.ts';
import { buildAuditLogStatements } from '../admin/audit-log-statements.ts';

// 措置の記録と監査ログの文を、状態の変更と同じ一括の書き込みへ並べるために組み立てる。同期の処理と書き込みの単位の実装だけが使う
@injectable()
export class D1ModerationStatements {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(MODERATION_PLATFORM_TYPES.ModerationRecordStatements)
    private readonly records: ModerationRecordStatements,
  ) {}

  forRecord(
    record: NewModerationRecord,
    audit: PreparedAuditEntry,
  ): readonly BatchItem<'sqlite'>[] {
    return [
      this.records.insertStatement(record),
      ...buildAuditLogStatements(this.db, audit),
    ];
  }
}
