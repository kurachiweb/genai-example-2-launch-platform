import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { REPORTING_PLATFORM_TYPES } from '../../../lib/core/reporting/identifiers.ts';
import type { ReportErasureStore } from '../../../lib/core/reporting/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

export const USER_REPORT_ERASURE_BATCH_SIZE = 500;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 空の案件の削除は件数だけを返すため、上限ちょうどを消した回は残りがあり得るとみなして続きを返す。
// 対象を毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class UserReportErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(REPORTING_PLATFORM_TYPES.ReportErasureStore)
    private readonly store: ReportErasureStore,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const reports = await this.store.eraseByReporter(
      event.userId,
      USER_REPORT_ERASURE_BATCH_SIZE,
    );
    const cases = await this.store.detachCasesByOwner(
      event.userId,
      this.clock.now(),
      USER_REPORT_ERASURE_BATCH_SIZE,
    );
    const emptyErased = await this.store.eraseEmptyCases(
      USER_REPORT_ERASURE_BATCH_SIZE,
    );
    return reports.remaining ||
      cases.remaining ||
      emptyErased >= USER_REPORT_ERASURE_BATCH_SIZE
      ? CONTINUE
      : DONE;
  }
}
