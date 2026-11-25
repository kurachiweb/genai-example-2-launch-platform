import { beforeEach, describe, expect, test } from 'vitest';

import { D1ReportCaseStore } from './d1-report-case-store.ts';
import {
  caseIdOf,
  clearReportCaseWrites,
  db,
  guestReportOf,
  insertReporter,
  memberReportOf,
  openCaseOf,
  rejectedColumns,
  seed,
  T0,
} from './testing/report-case-write-fixtures.ts';

const HOUR_MS = 60 * 60 * 1000;

const LAST_REPORTED_AT = new Date(T0.getTime() - 3 * HOUR_MS);

const store = (): D1ReportCaseStore => new D1ReportCaseStore(db);

beforeEach(async () => {
  await clearReportCaseWrites();
  await insertReporter(1);
});

describe('D1ReportCaseStore.findForNotice', () => {
  test('論理削除を除く通報がある案件はfindと同じ値を返す', async () => {
    await seed(
      [openCaseOf(1, { ...rejectedColumns(), lastReportedAt: T0 })],
      [
        guestReportOf(1, 1),
        memberReportOf(2, 1, 1, {
          reportedAt: LAST_REPORTED_AT,
          deletedAt: T0,
        }),
      ],
    );

    const forNotice = await store().findForNotice(caseIdOf(1));

    expect(forNotice).toEqual(await store().find(caseIdOf(1)));
    expect(forNotice?.reportCount).toBe(1);
  });

  test('全ての通報が論理削除された案件も、案件の列とともに件数を0・内訳を空・最初の受付日時を最後の受付日時として返す', async () => {
    const row = openCaseOf(1, {
      ...rejectedColumns(),
      posterNoticeStatus: 'pending',
      lastReportedAt: LAST_REPORTED_AT,
    });
    await seed(
      [row],
      [
        memberReportOf(1, 1, 1, {
          reportedAt: LAST_REPORTED_AT,
          deletedAt: T0,
        }),
      ],
    );

    await expect(store().find(caseIdOf(1))).resolves.toBeUndefined();
    await expect(store().findForNotice(caseIdOf(1))).resolves.toEqual({
      caseId: caseIdOf(1),
      targetKind: row.targetKind,
      targetId: row.targetId,
      targetDetachedAt: null,
      targetOwnerUserId: row.targetOwnerUserId,
      productId: row.productId,
      status: 'rejected',
      statusChangedAt: T0,
      infringementReportedAt: null,
      closedAt: T0,
      resolution: null,
      closingReason: row.closingReason,
      lastInquiredAt: null,
      lastInquiryMessage: null,
      reportCount: 0,
      firstReportedAt: LAST_REPORTED_AT,
      lastReportedAt: LAST_REPORTED_AT,
      categoryCounts: [],
    });
  });

  test('存在しない案件はundefinedを返す', async () => {
    await expect(store().findForNotice(caseIdOf(9))).resolves.toBeUndefined();
  });
});
