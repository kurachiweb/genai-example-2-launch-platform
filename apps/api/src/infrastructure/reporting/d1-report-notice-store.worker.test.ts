import { beforeEach, describe, expect, test } from 'vitest';

import { D1ReportNoticeStore } from './d1-report-notice-store.ts';
import {
  AT,
  caseIdOf,
  clearReportCaseWrites,
  db,
  guestReportOf,
  insertReporter,
  memberReportOf,
  openCaseOf,
  readCase,
  readReportRows,
  rejectedColumns,
  reportIdOf,
  seed,
  T0,
} from './testing/report-case-write-fixtures.ts';

const HOUR_MS = 60 * 60 * 1000;

const store = (): D1ReportNoticeStore => new D1ReportNoticeStore(db);

const closedAt = (hoursBeforeT0: number) => {
  const at = new Date(T0.getTime() - hoursBeforeT0 * HOUR_MS);
  return { ...rejectedColumns(), statusChangedAt: at, closedAt: at };
};

async function readNotice(reportIndex: number) {
  const rows = await readReportRows();
  const row = rows.find(({ id }) => id === reportIdOf(reportIndex));
  return {
    status: row?.outcomeNoticeStatus,
    requestedAt: row?.outcomeNoticeRequestedAt,
  };
}

beforeEach(async () => {
  await clearReportCaseWrites();
});

describe('D1ReportNoticeStore.listPendingOutcome', () => {
  test('案件の依頼待ちの通報だけを通報のIDの昇順で、宛先の手掛かりとともに返す', async () => {
    await insertReporter(1);
    await seed(
      [openCaseOf(1, closedAt(2)), openCaseOf(2, closedAt(2))],
      [
        guestReportOf(3, 1, { outcomeNoticeStatus: 'pending' }),
        memberReportOf(1, 1, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(2, 1, { outcomeNoticeStatus: 'requested' }),
        guestReportOf(4, 1, { outcomeNoticeStatus: 'skipped' }),
        guestReportOf(5, 2, { outcomeNoticeStatus: 'pending' }),
      ],
    );

    const pending = await store().listPendingOutcome(caseIdOf(1));

    expect(pending).toEqual([
      {
        reportId: reportIdOf(1),
        reporterUserId: memberReportOf(1, 1, 1).reporterUserId,
        contactEmail: null,
      },
      {
        reportId: reportIdOf(3),
        reporterUserId: null,
        contactEmail: 'guest3@mail.example',
      },
    ]);
  });

  test('退会で論理削除された申出者の依頼待ちの通報も、通知が送らなかった記録へ進められるよう返す', async () => {
    await insertReporter(1);
    await seed(
      [openCaseOf(1, closedAt(2))],
      [
        memberReportOf(1, 1, 1, {
          outcomeNoticeStatus: 'pending',
          deletedAt: T0,
        }),
      ],
    );

    const pending = await store().listPendingOutcome(caseIdOf(1));

    expect(pending.map(({ reportId }) => reportId)).toEqual([reportIdOf(1)]);
  });
});

describe('D1ReportNoticeStore.markOutcome', () => {
  test('依頼待ちの通報だけを依頼済みにして日時を残し、進めた件数を返す', async () => {
    await seed(
      [openCaseOf(1, closedAt(2))],
      [
        guestReportOf(1, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(2, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(3, 1, {
          outcomeNoticeStatus: 'requested',
          outcomeNoticeRequestedAt: T0,
        }),
      ],
    );

    const changed = await store().markOutcome(
      [reportIdOf(1), reportIdOf(2), reportIdOf(3)],
      'requested',
      AT,
    );

    expect(changed).toBe(2);
    expect(await readNotice(1)).toEqual({
      status: 'requested',
      requestedAt: AT,
    });
    expect(await readNotice(2)).toEqual({
      status: 'requested',
      requestedAt: AT,
    });
    expect(await readNotice(3)).toEqual({
      status: 'requested',
      requestedAt: T0,
    });
  });

  test('送らなかった記録は依頼の日時を持たず、同じ通報を2回進めない', async () => {
    await seed(
      [openCaseOf(1, closedAt(2))],
      [guestReportOf(1, 1, { outcomeNoticeStatus: 'pending' })],
    );

    const first = await store().markOutcome([reportIdOf(1)], 'skipped', AT);
    const second = await store().markOutcome([reportIdOf(1)], 'requested', AT);

    expect([first, second]).toEqual([1, 0]);
    expect(await readNotice(1)).toEqual({
      status: 'skipped',
      requestedAt: null,
    });
  });

  test('バインド変数の上限を超える数の宛先のまとまりの通報も1文で全部進める', async () => {
    const indexes = Array.from({ length: 120 }, (_, index) => index + 1);
    await seed(
      [openCaseOf(1, closedAt(2))],
      indexes.map((index) =>
        guestReportOf(index, 1, {
          contactEmail: 'same@mail.example',
          outcomeNoticeStatus: 'pending',
        }),
      ),
    );

    const changed = await store().markOutcome(
      indexes.map(reportIdOf),
      'requested',
      AT,
    );

    expect(changed).toBe(120);
    expect(
      new Set((await readReportRows()).map((row) => row.outcomeNoticeStatus)),
    ).toEqual(new Set(['requested']));
  });

  test('通報が無ければ何も更新せず0を返す', async () => {
    expect(await store().markOutcome([], 'requested', AT)).toBe(0);
  });
});

describe('D1ReportNoticeStore.markPoster・posterNoticePending', () => {
  test('依頼待ちのときだけ投稿者への通知を1回進める', async () => {
    await seed([
      openCaseOf(1, { ...closedAt(2), posterNoticeStatus: 'pending' }),
    ]);

    const pendingBefore = await store().posterNoticePending(caseIdOf(1));
    const first = await store().markPoster(caseIdOf(1), 'requested', AT);
    const second = await store().markPoster(caseIdOf(1), 'skipped', AT);
    const pendingAfter = await store().posterNoticePending(caseIdOf(1));

    expect([pendingBefore, first, second, pendingAfter]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(await readCase(1)).toMatchObject({
      posterNoticeStatus: 'requested',
      posterNoticeRequestedAt: AT,
    });
  });

  test('送らなかった記録は依頼の日時を持たない', async () => {
    await seed([
      openCaseOf(1, { ...closedAt(2), posterNoticeStatus: 'pending' }),
    ]);

    expect(await store().markPoster(caseIdOf(1), 'skipped', AT)).toBe(true);
    expect(await readCase(1)).toMatchObject({
      posterNoticeStatus: 'skipped',
      posterNoticeRequestedAt: null,
    });
  });

  test('案件が無ければ依頼待ちではなく、進めない', async () => {
    expect(await store().posterNoticePending(caseIdOf(1))).toBe(false);
    expect(await store().markPoster(caseIdOf(1), 'requested', AT)).toBe(false);
  });
});

describe('D1ReportNoticeStore.listCasesWithPendingNotices', () => {
  test('基準の日時までに完了し、申出者か投稿者への通知が依頼待ちの案件を完了の古い順に上限まで返す', async () => {
    const closedBefore = new Date(T0.getTime() - HOUR_MS);
    await seed(
      [
        openCaseOf(1, { ...closedAt(3), posterNoticeStatus: 'pending' }),
        openCaseOf(2, closedAt(5)),
        openCaseOf(3, closedAt(1)),
        openCaseOf(4, closedAt(0.5)),
        openCaseOf(5, closedAt(4)),
        openCaseOf(6, { status: 'in_progress' }),
        openCaseOf(7, closedAt(6)),
      ],
      [
        guestReportOf(2, 2, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(3, 3, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(4, 4, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(5, 5, { outcomeNoticeStatus: 'requested' }),
        guestReportOf(7, 7, { outcomeNoticeStatus: 'pending' }),
      ],
    );

    const all = await store().listCasesWithPendingNotices({
      closedBefore,
      limit: 10,
    });
    const limited = await store().listCasesWithPendingNotices({
      closedBefore,
      limit: 2,
    });

    expect(all).toEqual([caseIdOf(7), caseIdOf(2), caseIdOf(1), caseIdOf(3)]);
    expect(limited).toEqual([caseIdOf(7), caseIdOf(2)]);
  });

  test('退会で論理削除された申出者の依頼待ちの通報だけが残る案件も、送り直しで送らなかった記録へ進められるよう返す', async () => {
    await insertReporter(1);
    await seed(
      [openCaseOf(1, closedAt(2))],
      [
        memberReportOf(1, 1, 1, {
          outcomeNoticeStatus: 'pending',
          deletedAt: T0,
        }),
      ],
    );

    const cases = await store().listCasesWithPendingNotices({
      closedBefore: new Date(T0.getTime() - HOUR_MS),
      limit: 10,
    });

    expect(cases).toEqual([caseIdOf(1)]);
  });
});
