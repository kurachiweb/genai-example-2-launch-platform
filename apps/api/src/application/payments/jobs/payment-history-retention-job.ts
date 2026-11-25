import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { utcYearsBefore } from '../../../../lib/core/time/utc-calendar.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import type { PaymentRecordStore } from '../../../../lib/core/payments/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { API_PAYMENTS_TYPES } from '../payments-types.ts';

const PAYMENT_HISTORY_RETENTION_YEARS = 7;

// Workersのcpu時間に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const PAYMENT_HISTORY_DELETE_BATCH_SIZE = 500;

export const PAYMENT_HISTORY_DELETE_MAX_BATCHES = 20;

export const PAYMENT_HISTORY_RETENTION_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'payments.history-retention',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 410,
    handler: API_PAYMENTS_TYPES.PaymentHistoryRetentionJob,
  });

const logger = getAppLogger(['api', 'payments', 'history-retention']);

export function paymentHistoryRetentionCutoff(scheduledTime: Date): Date {
  return utcYearsBefore(scheduledTime, PAYMENT_HISTORY_RETENTION_YEARS);
}

@injectable()
export class PaymentHistoryRetentionJob implements ScheduledJobHandler {
  constructor(
    @inject(PAYMENTS_TYPES.PaymentRecordStore)
    private readonly records: PaymentRecordStore,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const cutoff = paymentHistoryRetentionCutoff(scheduledTime);
    let deleted = 0;
    let batches = 0;
    let lastCount: number;
    do {
      lastCount = await this.records.deleteRecordedBefore(
        cutoff,
        PAYMENT_HISTORY_DELETE_BATCH_SIZE,
      );
      deleted += lastCount;
      batches += 1;
    } while (
      lastCount === PAYMENT_HISTORY_DELETE_BATCH_SIZE &&
      batches < PAYMENT_HISTORY_DELETE_MAX_BATCHES
    );
    logger.info('保持期間を過ぎた決済履歴を削除しました', {
      deleted,
      batches,
      limitReached: lastCount === PAYMENT_HISTORY_DELETE_BATCH_SIZE,
    });
  }
}
