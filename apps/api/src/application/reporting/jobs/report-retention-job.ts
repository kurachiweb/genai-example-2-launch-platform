import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { REPORTING_PLATFORM_TYPES } from '../../../../lib/core/reporting/identifiers.ts';
import type { ReportErasureStore } from '../../../../lib/core/reporting/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { REPORTING_TYPES } from '../reporting-types.ts';

export const REPORT_RETENTION_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'content-reporting.report-retention',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 2010,
    handler: REPORTING_TYPES.ReportRetentionJob,
  });

// 4:21の起動の時間の予算を他の機能のジョブと共有するため1回の起動で消す件数を区切り、残りは翌日の起動に任せる。参照を消した案件は案件ごとに通報もまとめて消すため、他の段より少なく区切る
export const REPORT_GUEST_REPORT_ERASE_BATCH_SIZE = 500;

export const REPORT_DETACHED_CASE_ERASE_BATCH_SIZE = 100;

export const REPORT_EMPTY_CASE_ERASE_BATCH_SIZE = 500;

export const REPORT_ERASE_MAX_BATCHES = 20;

const GUEST_REPORT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const DETACHED_CASE_RETENTION_YEARS = 3;

const logger = getAppLogger(['api', 'reporting', 'report-retention']);

interface ErasureSummary {
  readonly erased: number;
  readonly batches: number;
  readonly limitReached: boolean;
}

export function reportGuestRetentionThreshold(scheduledTime: Date): Date {
  return new Date(scheduledTime.getTime() - GUEST_REPORT_RETENTION_MS);
}

// UTCの暦で3年前の同じ時刻。同じ日が無い2月29日は月末へ寄せ、3年に満たない案件を消さない
export function reportDetachedCaseRetentionCutoff(scheduledTime: Date): Date {
  const year = scheduledTime.getUTCFullYear() - DETACHED_CASE_RETENTION_YEARS;
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

async function eraseInBatches(
  erase: (limit: number) => Promise<number>,
  batchSize: number,
): Promise<ErasureSummary> {
  let erased = 0;
  let batches = 0;
  let lastCount: number;
  do {
    lastCount = await erase(batchSize);
    erased += lastCount;
    batches += 1;
  } while (lastCount === batchSize && batches < REPORT_ERASE_MAX_BATCHES);
  return { erased, batches, limitReached: lastCount === batchSize };
}

@injectable()
export class ReportRetentionJob implements ScheduledJobHandler {
  constructor(
    @inject(REPORTING_PLATFORM_TYPES.ReportErasureStore)
    private readonly store: ReportErasureStore,
  ) {}

  // 閾値を予定時刻から求めて日時の条件で消すため、起動が遅れても同じ日に2回実行しても結果は変わらない。前の2段で通報が無くなった案件を同じ起動の最後の段で消す
  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const guestThreshold = reportGuestRetentionThreshold(scheduledTime);
    const detachedCutoff = reportDetachedCaseRetentionCutoff(scheduledTime);
    const guestReports = await eraseInBatches(
      (limit) =>
        this.store.eraseGuestReportsClosedBefore(guestThreshold, limit),
      REPORT_GUEST_REPORT_ERASE_BATCH_SIZE,
    );
    const detachedCases = await eraseInBatches(
      (limit) => this.store.eraseDetachedCasesBefore(detachedCutoff, limit),
      REPORT_DETACHED_CASE_ERASE_BATCH_SIZE,
    );
    const emptyCases = await eraseInBatches(
      (limit) => this.store.eraseEmptyCases(limit),
      REPORT_EMPTY_CASE_ERASE_BATCH_SIZE,
    );
    logger.info('保持期間を過ぎた通報と案件を削除しました', {
      guestReports,
      detachedCases,
      emptyCases,
    });
  }
}
