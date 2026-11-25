import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { REPORTING_PLATFORM_TYPES } from '../../../lib/core/reporting/identifiers.ts';
import type { ReportErasureStatements } from '../../../lib/workers/reporting/report-erasure-statements.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

// 退会した利用者の通報を退会と同じ一括の書き込みで論理削除し、物理削除はeventの物理削除の時期の処理に任せる
@injectable()
export class ReporterWithdrawalSyncHandler implements UserLifecycleSyncHandler {
  constructor(
    @inject(REPORTING_PLATFORM_TYPES.ReportErasureStatements)
    private readonly statements: ReportErasureStatements,
  ) {}

  statementsFor(
    event: UserLifecycleEvent,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      this.statements.logicalDeleteByReporterStatement(
        event.userId,
        event.occurredAt,
      ),
    ]);
  }
}
