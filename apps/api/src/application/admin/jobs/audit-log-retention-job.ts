import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { utcYearsBefore } from '../../../../lib/core/time/utc-calendar.ts';
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

export function auditLogRetentionCutoff(scheduledTime: Date): Date {
  return utcYearsBefore(scheduledTime, AUDIT_LOG_RETENTION_YEARS);
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
