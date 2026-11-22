import { beforeEach, describe, expect, test } from 'vitest';

import type { ReportErasureStore } from '../../core/reporting/ports.ts';
import { D1ReportErasureStore } from './d1-report-erasure-store.ts';
import type { ReportErasureStatements } from './report-erasure-statements.ts';
import {
  caseIdOf,
  clearReportingState,
  closedColumnsAt,
  commentIdOf,
  daysBefore,
  db,
  detachedColumnsAt,
  guestReportOf,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  ownerIdOf,
  productIdOf,
  readCaseIds,
  readCases,
  readReportIds,
  readReports,
  reportIdOf,
  reporterIdOf,
  seed,
  T0,
} from './testing/report-erasure-fixtures.ts';

const implementation = new D1ReportErasureStore(db);

const store: ReportErasureStore = implementation;

const statements: ReportErasureStatements = implementation;

const GUEST_RETENTION_DAYS = 14;

const DETACHED_RETENTION_DAYS = 3 * 365;

const LATER = new Date(T0.getTime() + 60 * 1000);

beforeEach(async () => {
  await clearReportingState();
  await insertReporters([1, 2]);
});

describe('logicalDeleteByReporterStatement', () => {
  test('一括の書き込みで確定すると、その利用者の未削除の通報だけに退会の日時を入れ、他の利用者・未ログインの通報と削除済みの日時を変えない', async () => {
    const earlier = daysBefore(3);
    await seed(
      [openProductCaseOf(1)],
      [
        memberReportOf(1, 1, 1),
        memberReportOf(2, 1, 1, { deletedAt: earlier }),
        memberReportOf(3, 1, 2),
        guestReportOf(4, 1),
      ],
    );

    const statement = statements.logicalDeleteByReporterStatement(
      reporterIdOf(1),
      LATER,
    );
    expect(
      (await readReports()).filter((row) => row.deletedAt !== null),
    ).toHaveLength(1);
    await db.batch([statement]);

    const rows = await readReports();
    expect(
      rows.map((row) => ({
        id: row.id,
        deletedAt: row.deletedAt,
        updatedAt: row.updatedAt,
      })),
    ).toEqual([
      { id: reportIdOf(1), deletedAt: LATER, updatedAt: LATER },
      { id: reportIdOf(2), deletedAt: earlier, updatedAt: T0 },
      { id: reportIdOf(3), deletedAt: null, updatedAt: T0 },
      { id: reportIdOf(4), deletedAt: null, updatedAt: T0 },
    ]);
    expect(rows.every((row) => row.reason.startsWith('申出者の理由'))).toBe(
      true,
    );
  });
});

describe('eraseByReporter', () => {
  test('論理削除済みを含むその利用者の通報を上限ずつ物理削除し、残りの有無を返し、案件と他の通報を残す', async () => {
    await seed(
      [openProductCaseOf(1), openProductCaseOf(2)],
      [
        memberReportOf(1, 1, 1),
        memberReportOf(2, 2, 1, { deletedAt: daysBefore(1) }),
        memberReportOf(3, 2, 1),
        memberReportOf(4, 1, 2),
        guestReportOf(5, 2),
      ],
    );

    await expect(store.eraseByReporter(reporterIdOf(1), 2)).resolves.toEqual({
      remaining: true,
    });
    expect(await readReportIds()).toHaveLength(3);
    await expect(store.eraseByReporter(reporterIdOf(1), 2)).resolves.toEqual({
      remaining: false,
    });

    expect(await readReportIds()).toEqual([reportIdOf(4), reportIdOf(5)]);
    expect(await readCaseIds()).toEqual([caseIdOf(1), caseIdOf(2)]);
  });

  test('通報の無い利用者では何も消さず、残りが無いことを返す', async () => {
    await seed([openProductCaseOf(1)], [memberReportOf(1, 1, 2)]);

    await expect(store.eraseByReporter(reporterIdOf(1), 500)).resolves.toEqual({
      remaining: false,
    });
    expect(await readReportIds()).toEqual([reportIdOf(1)]);
  });
});

describe('detachCasesByOwner', () => {
  test('その利用者が投稿者である案件の対象への参照だけを上限ずつ消し、2回目は参照を消した案件を選ばず、案件・通報・理由・状態・完了の記録を残す', async () => {
    const closedAt = daysBefore(2);
    const userCase = openProductCaseOf(1, {
      targetKind: 'user',
      targetId: ownerIdOf(1),
      targetOwnerUserId: ownerIdOf(1),
      productId: null,
      status: 'in_progress',
    });
    const productCase = openProductCaseOf(2, {
      targetOwnerUserId: ownerIdOf(1),
      ...closedColumnsAt(closedAt),
    });
    const commentCase = openProductCaseOf(3, {
      targetKind: 'comment',
      targetId: commentIdOf(3),
      targetOwnerUserId: ownerIdOf(1),
      productId: productIdOf(9),
    });
    const otherCase = openProductCaseOf(4);
    await seed(
      [userCase, productCase, commentCase, otherCase],
      [
        guestReportOf(1, 1),
        memberReportOf(2, 2, 1),
        guestReportOf(3, 3),
        guestReportOf(4, 4),
      ],
    );
    const reportsBefore = await readReports();

    await expect(
      store.detachCasesByOwner(ownerIdOf(1), T0, 2),
    ).resolves.toEqual({ remaining: true });
    await expect(
      store.detachCasesByOwner(ownerIdOf(1), LATER, 2),
    ).resolves.toEqual({ remaining: false });
    await expect(
      store.detachCasesByOwner(ownerIdOf(1), LATER, 2),
    ).resolves.toEqual({ remaining: false });

    const cases = await readCases();
    const detached = cases.filter((row) => row.id !== caseIdOf(4));
    expect(
      detached.map((row) => row.targetDetachedAt?.getTime()).toSorted(),
    ).toEqual([T0.getTime(), T0.getTime(), LATER.getTime()].toSorted());
    for (const row of detached) {
      expect(row).toMatchObject({
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        updatedAt: row.targetDetachedAt,
      });
    }
    expect(cases.find((row) => row.id === caseIdOf(1))).toMatchObject({
      targetKind: 'user',
      status: 'in_progress',
      closedAt: null,
    });
    expect(cases.find((row) => row.id === caseIdOf(2))).toMatchObject({
      targetKind: 'product',
      status: 'rejected',
      closedAt,
      closingReason: '規約に違反しないため',
    });
    expect(cases.find((row) => row.id === caseIdOf(4))).toEqual({
      ...otherCase,
      targetDetachedAt: null,
      infringementReportedAt: null,
      closedAt: null,
      resolution: null,
      resolutionActionId: null,
      closingReason: null,
      posterNoticeStatus: 'none',
      posterNoticeRequestedAt: null,
      lastInquiredAt: null,
      lastInquiryMessage: null,
    });
    expect(await readReports()).toEqual(reportsBefore);
  });
});

describe('detachCasesByProduct', () => {
  test('そのプロダクトとそのコメントの案件の対象への参照だけを上限ずつ消し、他のプロダクトの案件を変えない', async () => {
    await seed(
      [
        openProductCaseOf(1),
        openProductCaseOf(2, {
          targetKind: 'comment',
          targetId: commentIdOf(2),
          targetOwnerUserId: ownerIdOf(2),
          productId: productIdOf(1),
        }),
        openProductCaseOf(3),
      ],
      [guestReportOf(1, 1), guestReportOf(2, 2), guestReportOf(3, 3)],
    );
    const reportsBefore = await readReports();

    await expect(
      store.detachCasesByProduct(productIdOf(1), T0, 1),
    ).resolves.toEqual({ remaining: true });
    await expect(
      store.detachCasesByProduct(productIdOf(1), LATER, 1),
    ).resolves.toEqual({ remaining: false });

    const cases = await readCases();
    expect(
      cases.map((row) => ({
        id: row.id,
        targetKind: row.targetKind,
        targetId: row.targetId,
        targetOwnerUserId: row.targetOwnerUserId,
        productId: row.productId,
        detached: row.targetDetachedAt !== null,
      })),
    ).toEqual([
      {
        id: caseIdOf(1),
        targetKind: 'product',
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        detached: true,
      },
      {
        id: caseIdOf(2),
        targetKind: 'comment',
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        detached: true,
      },
      {
        id: caseIdOf(3),
        targetKind: 'product',
        targetId: productIdOf(3),
        targetOwnerUserId: ownerIdOf(3),
        productId: productIdOf(3),
        detached: false,
      },
    ]);
    expect(await readReports()).toEqual(reportsBefore);
  });
});

describe('eraseGuestReportsClosedBefore', () => {
  const threshold = daysBefore(GUEST_RETENTION_DAYS);

  test('最後の完了から14日を過ぎた案件の未ログインの通報だけを消し、13日の案件・未完了の案件・完了から戻した案件の通報とログイン中の通報を残す', async () => {
    await seed(
      [
        openProductCaseOf(1, closedColumnsAt(daysBefore(14))),
        openProductCaseOf(2, closedColumnsAt(daysBefore(13))),
        openProductCaseOf(3, { createdAt: daysBefore(30) }),
        openProductCaseOf(4, {
          status: 'in_progress',
          statusChangedAt: daysBefore(10),
          createdAt: daysBefore(30),
        }),
        openProductCaseOf(5, closedColumnsAt(daysBefore(5))),
        openProductCaseOf(6, closedColumnsAt(daysBefore(20))),
      ],
      [
        guestReportOf(1, 1),
        memberReportOf(2, 1, 1),
        guestReportOf(3, 2),
        guestReportOf(4, 3, { reportedAt: daysBefore(30) }),
        guestReportOf(5, 4, { reportedAt: daysBefore(30) }),
        guestReportOf(6, 5, { reportedAt: daysBefore(30) }),
        guestReportOf(7, 6, { contactEmail: null }),
      ],
    );

    await expect(
      store.eraseGuestReportsClosedBefore(threshold, 500),
    ).resolves.toBe(2);

    expect(await readReportIds()).toEqual([
      reportIdOf(2),
      reportIdOf(3),
      reportIdOf(4),
      reportIdOf(5),
      reportIdOf(6),
    ]);
    expect(await readCaseIds()).toHaveLength(6);
  });

  test('1回に消す件数を上限で区切り、残りを次の実行で消す', async () => {
    await seed(
      [openProductCaseOf(1, closedColumnsAt(daysBefore(20)))],
      [guestReportOf(1, 1), guestReportOf(2, 1), guestReportOf(3, 1)],
    );

    await expect(
      store.eraseGuestReportsClosedBefore(threshold, 2),
    ).resolves.toBe(2);
    await expect(
      store.eraseGuestReportsClosedBefore(threshold, 2),
    ).resolves.toBe(1);
    await expect(
      store.eraseGuestReportsClosedBefore(threshold, 2),
    ).resolves.toBe(0);
    expect(await readReportIds()).toEqual([]);
  });
});

describe('eraseDetachedCasesBefore', () => {
  const threshold = daysBefore(DETACHED_RETENTION_DAYS);

  test('参照の消去から3年を過ぎた案件を通報ごと消し、境界の直後の案件と参照を消していない古い案件を残す', async () => {
    await seed(
      [
        openProductCaseOf(1, {
          ...closedColumnsAt(daysBefore(DETACHED_RETENTION_DAYS + 30)),
          ...detachedColumnsAt(threshold),
        }),
        openProductCaseOf(2, {
          ...detachedColumnsAt(new Date(threshold.getTime() + 1)),
        }),
        openProductCaseOf(3, {
          ...closedColumnsAt(daysBefore(DETACHED_RETENTION_DAYS + 30)),
          createdAt: daysBefore(DETACHED_RETENTION_DAYS + 60),
        }),
        openProductCaseOf(4, {
          ...detachedColumnsAt(daysBefore(DETACHED_RETENTION_DAYS + 1)),
        }),
      ],
      [
        guestReportOf(1, 1),
        memberReportOf(2, 1, 1, { deletedAt: daysBefore(100) }),
        guestReportOf(3, 2),
        memberReportOf(4, 3, 2),
        guestReportOf(5, 4),
      ],
    );

    await expect(store.eraseDetachedCasesBefore(threshold, 100)).resolves.toBe(
      2,
    );

    expect(await readCaseIds()).toEqual([caseIdOf(2), caseIdOf(3)]);
    expect(await readReportIds()).toEqual([reportIdOf(3), reportIdOf(4)]);
  });

  test('1回に消す案件の数を上限で区切り、選んだ案件の通報だけを消す', async () => {
    await seed(
      [1, 2, 3].map((index) =>
        openProductCaseOf(index, detachedColumnsAt(daysBefore(2000 - index))),
      ),
      [guestReportOf(1, 1), guestReportOf(2, 2), guestReportOf(3, 3)],
    );

    await expect(store.eraseDetachedCasesBefore(threshold, 2)).resolves.toBe(2);
    const leftCases = await readCaseIds();
    expect(leftCases).toHaveLength(1);
    expect((await readReports()).map((row) => row.caseId)).toEqual(leftCases);
    await expect(store.eraseDetachedCasesBefore(threshold, 2)).resolves.toBe(1);
    await expect(store.eraseDetachedCasesBefore(threshold, 2)).resolves.toBe(0);
    expect(await readCaseIds()).toEqual([]);
    expect(await readReportIds()).toEqual([]);
  });
});

describe('eraseEmptyCases', () => {
  test('通報が1件も無い案件だけを上限ずつ消し、論理削除済みの通報だけが残る案件を残す', async () => {
    await seed(
      [
        openProductCaseOf(1),
        openProductCaseOf(2, closedColumnsAt(daysBefore(1))),
        openProductCaseOf(3, detachedColumnsAt(daysBefore(1))),
        openProductCaseOf(4),
      ],
      [memberReportOf(1, 4, 1, { deletedAt: daysBefore(1) })],
    );

    await expect(store.eraseEmptyCases(2)).resolves.toBe(2);
    await expect(store.eraseEmptyCases(2)).resolves.toBe(1);
    await expect(store.eraseEmptyCases(2)).resolves.toBe(0);

    expect(await readCaseIds()).toEqual([caseIdOf(4)]);
    expect(await readReportIds()).toEqual([reportIdOf(1)]);
  });
});

describe('保持期間と物理削除の時期の削除の繰り返し', () => {
  async function runAll(): Promise<void> {
    await store.eraseByReporter(reporterIdOf(1), 500);
    await store.detachCasesByOwner(ownerIdOf(1), T0, 500);
    await store.detachCasesByProduct(productIdOf(2), T0, 500);
    await store.eraseGuestReportsClosedBefore(
      daysBefore(GUEST_RETENTION_DAYS),
      500,
    );
    await store.eraseDetachedCasesBefore(
      daysBefore(DETACHED_RETENTION_DAYS),
      100,
    );
    await store.eraseEmptyCases(500);
  }

  test('2回実行しても1回実行した結果と変わらない', async () => {
    await seed(
      [
        openProductCaseOf(1),
        openProductCaseOf(2),
        openProductCaseOf(3, closedColumnsAt(daysBefore(20))),
        openProductCaseOf(4, detachedColumnsAt(daysBefore(2000))),
        openProductCaseOf(5),
      ],
      [
        memberReportOf(1, 1, 2),
        guestReportOf(2, 2),
        guestReportOf(3, 3),
        memberReportOf(4, 3, 2),
        guestReportOf(5, 4),
        memberReportOf(6, 5, 1),
      ],
    );

    await runAll();
    const casesAfterFirst = await readCases();
    const reportsAfterFirst = await readReports();
    await runAll();

    expect(casesAfterFirst.map((row) => row.id)).toEqual([
      caseIdOf(1),
      caseIdOf(2),
      caseIdOf(3),
    ]);
    expect(reportsAfterFirst.map((row) => row.id)).toEqual([
      reportIdOf(1),
      reportIdOf(2),
      reportIdOf(4),
    ]);
    expect(await readCases()).toEqual(casesAfterFirst);
    expect(await readReports()).toEqual(reportsAfterFirst);
  });
});
