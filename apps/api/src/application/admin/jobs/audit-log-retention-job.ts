import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { ADMIN_TYPES } from '../admin-types.ts';
import type { AuditLogStore } from '../ports.ts';

const AUDIT_LOG_RETENTION_YEARS = 3;

// Workersのcpu時間に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const AUDIT_LOG_DELETE_BATCH_SIZE = 500;

export const AUDIT_LOG_DELETE_MAX_BATCHES = 20;

const logger = getAppLogger(['api', 'admin', 'audit-log-retention']);

// UTCの暦で3年前の同じ時刻。同じ日が無い2月29日は月末へ寄せ、3年に満たない記録を消さない
export function auditLogRetentionCutoff(scheduledTime: Date): Date {
  const year = scheduledTime.getUTCFullYear() - AUDIT_LOG_RETENTION_YEARS;
  const month = scheduledTime.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(scheduledTime.getUTCDate(), lastDayOfMonth),
      scheduledTime.getUTCHours(),
      scheduledTime.getUTCMinutes(),
      scheduledTime.getUTCSeconds(),
      scheduledTime.getUTCMilliseconds(),
    ),
  );
}

@injectable()
export class AuditLogRetentionJob implements ScheduledJobHandler {
  constructor(
    @inject(ADMIN_TYPES.AuditLogStore)
    private readonly store: AuditLogStore,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const cutoff = auditLogRetentionCutoff(scheduledTime);
    let deleted = 0;
    let batches = 0;
    let lastCount: number;
    try {
      do {
        lastCount = await this.store.deleteOccurredUntil(
          cutoff,
          AUDIT_LOG_DELETE_BATCH_SIZE,
        );
        deleted += lastCount;
        batches += 1;
      } while (
        lastCount === AUDIT_LOG_DELETE_BATCH_SIZE &&
        batches < AUDIT_LOG_DELETE_MAX_BATCHES
      );
    } catch (error: unknown) {
      logger.error('保持期限を過ぎた監査ログを削除できませんでした', {
        error,
        deleted,
      });
      throw error;
    }
    logger.info('保持期限を過ぎた監査ログを削除しました', {
      deleted,
      batches,
      limitReached: lastCount === AUDIT_LOG_DELETE_BATCH_SIZE,
    });
  }
}
