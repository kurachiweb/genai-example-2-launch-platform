import { beforeEach, describe, expect, test } from 'vitest';

import type { ScheduledJobContext } from '../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import { D1ReportErasureStore } from '../../../lib/workers/reporting/d1-report-erasure-store.ts';
import {
  caseIdOf,
  clearReportingState,
  closedColumnsAt,
  db,
  detachedColumnsAt,
  guestReportOf,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  readCaseIds,
  readCases,
  readReportIds,
  readReports,
  reportIdOf,
  seed,
} from '../../../lib/workers/reporting/testing/report-erasure-fixtures.ts';
import { ReportRetentionJob } from '../../application/reporting/jobs/report-retention-job.ts';

// 業務日付2026-11-22の業務時刻4:21
const SCHEDULED_TIME = new Date('2026-11-22T12:21:00.000Z');
const FOURTEEN_DAYS_BEFORE = new Date('2026-11-08T12:21:00.000Z');
const THREE_YEARS_BEFORE = new Date('2023-11-22T12:21:00.000Z');

const context: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: toBusinessDateTime(SCHEDULED_TIME),
};

const after = (at: Date): Date => new Date(at.getTime() + 1);

const createJob = (): ReportRetentionJob =>
  new ReportRetentionJob(new D1ReportErasureStore(db));

beforeEach(async () => {
  await clearReportingState();
});

describe('ReportRetentionJob(D1の削除の操作を組み立てて実行)', () => {
  test('予定時刻から求めた閾値で、未ログインの通報・参照を消した案件・空の案件を消し、2回実行しても結果が変わらない', async () => {
    await insertReporters([1]);
    await seed(
      [
        openProductCaseOf(1, closedColumnsAt(FOURTEEN_DAYS_BEFORE)),
        openProductCaseOf(2, closedColumnsAt(after(FOURTEEN_DAYS_BEFORE))),
        openProductCaseOf(3, closedColumnsAt(THREE_YEARS_BEFORE)),
        openProductCaseOf(4),
        openProductCaseOf(5, {
          ...closedColumnsAt(THREE_YEARS_BEFORE),
          ...detachedColumnsAt(THREE_YEARS_BEFORE),
        }),
        openProductCaseOf(6, detachedColumnsAt(after(THREE_YEARS_BEFORE))),
        openProductCaseOf(7, closedColumnsAt(after(FOURTEEN_DAYS_BEFORE))),
      ],
      [
        guestReportOf(1, 1),
        guestReportOf(2, 2),
        memberReportOf(3, 3, 1),
        guestReportOf(4, 3),
        guestReportOf(5, 4, { reportedAt: THREE_YEARS_BEFORE }),
        memberReportOf(6, 5, 1),
        memberReportOf(7, 6, 1),
      ],
    );

    await createJob().run(context);
    const casesAfterFirst = await readCases();
    const reportsAfterFirst = await readReports();
    await createJob().run(context);

    expect(await readCaseIds()).toEqual([
      caseIdOf(2),
      caseIdOf(3),
      caseIdOf(4),
      caseIdOf(6),
    ]);
    expect(await readReportIds()).toEqual([
      reportIdOf(2),
      reportIdOf(3),
      reportIdOf(5),
      reportIdOf(7),
    ]);
    expect(await readCases()).toEqual(casesAfterFirst);
    expect(await readReports()).toEqual(reportsAfterFirst);
  });
});
