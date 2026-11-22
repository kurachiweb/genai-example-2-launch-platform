import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  REPORT_INQUIRE_ACTION,
  REPORT_REJECT_ACTION,
  REPORT_RESOLVE_ACTION,
  REPORT_STATUS_CHANGE_ACTION,
} from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import type {
  CaseClosing,
  ReportCaseInquiryRecord,
} from '../../application/reporting/ports.ts';
import { D1ReportCaseStatements } from './d1-report-case-statements.ts';
import { D1ReportCaseWriter } from './d1-report-case-writer.ts';
import {
  AT,
  auditIdOf,
  auditOf,
  type CaseRow,
  caseIdOf,
  clearReportCaseWrites,
  closingOf,
  db,
  detachedColumns,
  guestReportOf,
  insertReporter,
  measureResolvedColumns,
  memberReportOf,
  openCaseOf,
  productIdOf,
  readAudits,
  readCase,
  readCaseIds,
  readNoticeStatuses,
  REASON,
  rejectedColumns,
  reportIdOf,
  seed,
  statusChangeOf,
  T0,
} from './testing/report-case-write-fixtures.ts';

const writer = (): D1ReportCaseWriter =>
  new D1ReportCaseWriter(db, new D1ReportCaseStatements(db));

beforeEach(async () => {
  await clearReportCaseWrites();
});

describe('D1ReportCaseWriter.changeStatus', () => {
  test.each([
    ['open', 'in_progress'],
    ['in_progress', 'open'],
  ] as const)(
    '%sから%sへの変更は状態と変更の日時だけを変え、監査ログと一体で確定する',
    async (from, to) => {
      await seed([openCaseOf(1, { status: from })]);

      const result = await writer().changeStatus(statusChangeOf(1, from, to));

      expect(result).toBe('committed');
      expect(await readCase(1)).toMatchObject({
        status: to,
        statusChangedAt: AT,
        closedAt: null,
        resolution: null,
        closingReason: null,
        updatedAt: AT,
      });
      expect(await readAudits()).toEqual([
        {
          id: auditIdOf(1),
          action: REPORT_STATUS_CHANGE_ACTION.name,
          reason: REASON,
          detail: { fromStatus: from, toStatus: to },
          occurredAt: AT,
          targets: [{ targetKind: 'report', targetId: caseIdOf(1) }],
        },
      ]);
    },
  );

  test.each([
    ['open', 'resolved', 'none'],
    ['in_progress', 'rejected', null],
  ] as const)(
    '%sから%sへの手での完了は完了の日時・措置・理由を入れ、通知を依頼待ちにしない',
    async (from, to, resolution) => {
      await insertReporter(1);
      await seed(
        [openCaseOf(1, { status: from })],
        [memberReportOf(1, 1, 1), guestReportOf(2, 1)],
      );

      const result = await writer().changeStatus(statusChangeOf(1, from, to));

      expect(result).toBe('committed');
      expect(await readCase(1)).toMatchObject({
        status: to,
        statusChangedAt: AT,
        closedAt: AT,
        resolution,
        resolutionActionId: null,
        closingReason: REASON,
        posterNoticeStatus: 'none',
      });
      expect(await readNoticeStatuses()).toEqual({
        [reportIdOf(1)]: 'none',
        [reportIdOf(2)]: 'none',
      });
      expect((await readAudits()).map(({ action }) => action)).toEqual([
        to === 'resolved'
          ? REPORT_RESOLVE_ACTION.name
          : REPORT_REJECT_ACTION.name,
      ]);
    },
  );

  test('完了どうしの変更は措置の記録のIDを消し、依頼待ちの通知だけを取りやめて依頼済みの記録を残す', async () => {
    await insertReporter(1);
    await seed(
      [openCaseOf(1, measureResolvedColumns())],
      [
        memberReportOf(1, 1, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(2, 1, {
          outcomeNoticeStatus: 'requested',
          outcomeNoticeRequestedAt: T0,
        }),
        guestReportOf(3, 1, { outcomeNoticeStatus: 'skipped' }),
      ],
    );

    const result = await writer().changeStatus(
      statusChangeOf(1, 'resolved', 'rejected'),
    );

    expect(result).toBe('committed');
    expect(await readCase(1)).toMatchObject({
      status: 'rejected',
      closedAt: AT,
      resolution: null,
      resolutionActionId: null,
      closingReason: REASON,
      posterNoticeStatus: 'none',
    });
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'none',
      [reportIdOf(2)]: 'requested',
      [reportIdOf(3)]: 'skipped',
    });
  });

  test('却下から対応済への手での変更は措置なしの対応済にし、依頼済みの投稿者への通知を残す', async () => {
    await seed([openCaseOf(1, rejectedColumns())]);

    const result = await writer().changeStatus(
      statusChangeOf(1, 'rejected', 'resolved'),
    );

    expect(result).toBe('committed');
    expect(await readCase(1)).toMatchObject({
      status: 'resolved',
      closedAt: AT,
      resolution: 'none',
      resolutionActionId: null,
      posterNoticeStatus: 'requested',
      posterNoticeRequestedAt: T0,
    });
  });

  test.each(['open', 'in_progress'] as const)(
    '%sへの再開は完了の日時・措置・措置の記録のID・理由を消し、依頼待ちの通知だけを取りやめる',
    async (to) => {
      await insertReporter(1);
      await seed(
        [openCaseOf(1, measureResolvedColumns())],
        [
          memberReportOf(1, 1, 1, { outcomeNoticeStatus: 'pending' }),
          guestReportOf(2, 1, {
            outcomeNoticeStatus: 'requested',
            outcomeNoticeRequestedAt: T0,
          }),
        ],
      );

      const result = await writer().changeStatus(
        statusChangeOf(1, 'resolved', to),
      );

      expect(result).toBe('committed');
      expect(await readCase(1)).toMatchObject({
        status: to,
        statusChangedAt: AT,
        closedAt: null,
        resolution: null,
        resolutionActionId: null,
        closingReason: null,
        posterNoticeStatus: 'none',
      });
      expect(await readNoticeStatuses()).toEqual({
        [reportIdOf(1)]: 'none',
        [reportIdOf(2)]: 'requested',
      });
      expect((await readAudits()).map(({ action }) => action)).toEqual([
        REPORT_STATUS_CHANGE_ACTION.name,
      ]);
    },
  );

  test('再開は依頼済みの投稿者への通知の記録を残す', async () => {
    await seed([openCaseOf(1, rejectedColumns())]);

    await writer().changeStatus(statusChangeOf(1, 'rejected', 'open'));

    expect(await readCase(1)).toMatchObject({
      status: 'open',
      posterNoticeStatus: 'requested',
      posterNoticeRequestedAt: T0,
    });
  });

  test.each([
    ['open', 'in_progress', 'in_progress'],
    ['open', 'resolved', 'rejected'],
    ['resolved', 'open', 'in_progress'],
  ] as const)(
    '変更前の状態が%sでなければ%sへ変えずconflictを返し何も残さない(現在%s)',
    async (from, to, current) => {
      const columns: Partial<CaseRow> =
        current === 'rejected' ? rejectedColumns() : { status: current };
      await seed(
        [openCaseOf(1, columns)],
        [guestReportOf(1, 1, { outcomeNoticeStatus: 'pending' })],
      );
      const before = await readCase(1);

      const result = await writer().changeStatus(statusChangeOf(1, from, to));

      expect(result).toBe('conflict');
      expect(await readCase(1)).toEqual(before);
      expect(await readNoticeStatuses()).toEqual({
        [reportIdOf(1)]: 'pending',
      });
      expect(await readAudits()).toEqual([]);
    },
  );

  test('同じ対象に未完了の案件があるときの再開は何も残さずopen-case-existsを返す', async () => {
    await seed(
      [
        openCaseOf(1, measureResolvedColumns()),
        openCaseOf(2, { targetId: productIdOf(1), productId: productIdOf(1) }),
      ],
      [guestReportOf(1, 1, { outcomeNoticeStatus: 'pending' })],
    );
    const before = await readCase(1);

    const result = await writer().changeStatus(
      statusChangeOf(1, 'resolved', 'in_progress'),
    );

    expect(result).toBe('open-case-exists');
    expect(await readCase(1)).toEqual(before);
    expect(await readNoticeStatuses()).toEqual({ [reportIdOf(1)]: 'pending' });
    expect(await readAudits()).toEqual([]);
  });

  test('対象への参照を消した案件の再開は、同じ対象の種類の未完了の案件があっても確定する', async () => {
    await seed([
      openCaseOf(1, { ...rejectedColumns(), ...detachedColumns() }),
      openCaseOf(2, detachedColumns()),
    ]);

    const result = await writer().changeStatus(
      statusChangeOf(1, 'rejected', 'open'),
    );

    expect(result).toBe('committed');
    expect(await readCase(1)).toMatchObject({ status: 'open', targetId: null });
  });

  test.each([
    ['open', 'in_progress'],
    ['open', 'resolved'],
    ['resolved', 'open'],
  ] as const)(
    '読んだ後に物理削除された案件の%sから%sへの変更は監査ログを含めて何も残さずnot-foundを返す',
    async (from, to) => {
      const result = await writer().changeStatus(statusChangeOf(1, from, to));

      expect(result).toBe('not-found');
      expect(await readCaseIds()).toEqual([]);
      expect(await readAudits()).toEqual([]);
    },
  );
});

describe('D1ReportCaseWriter.close', () => {
  test('措置なしの対応済は完了の記録と申出者への通知の依頼待ちを監査ログと一体で確定し、措置の記録のIDはnull', async () => {
    await insertReporter(1);
    await seed(
      [openCaseOf(1, { status: 'in_progress' })],
      [
        memberReportOf(1, 1, 1),
        guestReportOf(2, 1),
        guestReportOf(3, 1, { contactEmail: null }),
        guestReportOf(4, 1, { deletedAt: T0 }),
      ],
    );

    const result = await writer().close(closingOf(1));

    expect(result).toBe('committed');
    expect(await readCase(1)).toMatchObject({
      status: 'resolved',
      statusChangedAt: AT,
      closedAt: AT,
      resolution: 'none',
      resolutionActionId: null,
      closingReason: REASON,
      posterNoticeStatus: 'none',
    });
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'pending',
      [reportIdOf(2)]: 'pending',
      [reportIdOf(3)]: 'none',
      [reportIdOf(4)]: 'none',
    });
    expect(await readAudits()).toEqual([
      {
        id: auditIdOf(1),
        action: REPORT_RESOLVE_ACTION.name,
        reason: REASON,
        detail: { resolution: 'none', mode: 'operation', fromStatus: 'open' },
        occurredAt: AT,
        targets: [{ targetKind: 'report', targetId: caseIdOf(1) }],
      },
    ]);
  });

  test('却下は投稿者への通知を依頼待ちにし、措置の記録のIDはnull', async () => {
    await seed([openCaseOf(1)], [guestReportOf(1, 1)]);

    const result = await writer().close(
      closingOf(1, {
        to: 'rejected',
        resolution: null,
        posterNotice: 'pending',
        audit: auditOf(1, REPORT_REJECT_ACTION.name, caseIdOf(1), {
          mode: 'operation',
          fromStatus: 'open',
        }),
      }),
    );

    expect(result).toBe('committed');
    expect(await readCase(1)).toMatchObject({
      status: 'rejected',
      closedAt: AT,
      resolution: null,
      resolutionActionId: null,
      posterNoticeStatus: 'pending',
    });
    expect(await readNoticeStatuses()).toEqual({ [reportIdOf(1)]: 'pending' });
  });

  test('対象への参照を消した案件の却下は投稿者への通知を送らなかった記録にする', async () => {
    await seed([openCaseOf(1, detachedColumns())]);

    const result = await writer().close(
      closingOf(1, {
        to: 'rejected',
        resolution: null,
        posterNotice: 'skipped',
        audit: auditOf(1, REPORT_REJECT_ACTION.name, caseIdOf(1)),
      }),
    );

    expect(result).toBe('committed');
    expect(await readCase(1)).toMatchObject({
      status: 'rejected',
      posterNoticeStatus: 'skipped',
    });
  });

  test.each([
    ['対応済', measureResolvedColumns()],
    ['却下', rejectedColumns()],
  ])('%sの案件の完了は何も残さずconflictを返す', async (_label, columns) => {
    await seed(
      [openCaseOf(1, columns)],
      [guestReportOf(1, 1, { outcomeNoticeStatus: 'requested' })],
    );
    const before = await readCase(1);

    const result = await writer().close(closingOf(1));

    expect(result).toBe('conflict');
    expect(await readCase(1)).toEqual(before);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'requested',
    });
    expect(await readAudits()).toEqual([]);
  });

  test('再開の後の操作による完了は、依頼済み・取りやめた通知を1回の完了につき1回だけ依頼待ちに戻す', async () => {
    await insertReporter(1);
    await seed(
      [openCaseOf(1, rejectedColumns())],
      [
        memberReportOf(1, 1, 1, {
          outcomeNoticeStatus: 'requested',
          outcomeNoticeRequestedAt: T0,
        }),
        guestReportOf(2, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(3, 1, { outcomeNoticeStatus: 'skipped' }),
      ],
    );
    await writer().changeStatus(statusChangeOf(1, 'rejected', 'in_progress'));
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'requested',
      [reportIdOf(2)]: 'none',
      [reportIdOf(3)]: 'skipped',
    });

    const first = await writer().close(
      closingOf(1, {
        audit: auditOf(2, REPORT_RESOLVE_ACTION.name, caseIdOf(1)),
      }),
    );
    await db
      .update(reports)
      .set({ outcomeNoticeStatus: 'requested' })
      .where(eq(reports.id, reportIdOf(1)));
    const second = await writer().close(
      closingOf(1, {
        audit: auditOf(3, REPORT_RESOLVE_ACTION.name, caseIdOf(1)),
      }),
    );

    expect([first, second]).toEqual(['committed', 'conflict']);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'requested',
      [reportIdOf(2)]: 'pending',
      [reportIdOf(3)]: 'pending',
    });
    expect((await readAudits()).map(({ id }) => id)).toEqual([
      auditIdOf(1),
      auditIdOf(2),
    ]);
  });

  test('読んだ後に物理削除された案件の完了は監査ログを含めて何も残さずnot-foundを返す', async () => {
    const result = await writer().close(closingOf(1));

    expect(result).toBe('not-found');
    expect(await readCaseIds()).toEqual([]);
    expect(await readAudits()).toEqual([]);
  });

  test('状態と存在の検査の違反以外の失敗はそのまま投げ、何も残さない', async () => {
    await seed([openCaseOf(1)]);

    await expect(
      writer().close(
        closingOf(1, {
          posterNotice: 'unknown' as CaseClosing['posterNotice'],
        }),
      ),
    ).rejects.toThrow(/CHECK constraint failed/u);
    expect(await readCase(1)).toMatchObject({ status: 'open', closedAt: null });
    expect(await readAudits()).toEqual([]);
  });
});

describe('D1ReportCaseWriter.recordInquiry', () => {
  const MESSAGE = '権利侵害の申し立てについて確認させてください';

  const inquiryOf = (caseIndex: number): ReportCaseInquiryRecord => ({
    caseId: caseIdOf(caseIndex),
    message: MESSAGE,
    at: AT,
    audit: auditOf(1, REPORT_INQUIRE_ACTION.name, caseIdOf(caseIndex)),
  });

  test('対応中の案件では照会の日時と内容を監査ログと一体で確定し、状態を変えない', async () => {
    await seed([openCaseOf(1, { status: 'in_progress' })]);

    const result = await writer().recordInquiry(inquiryOf(1));

    expect(result).toBe('committed');
    expect(await readCase(1)).toMatchObject({
      status: 'in_progress',
      statusChangedAt: T0,
      lastInquiredAt: AT,
      lastInquiryMessage: MESSAGE,
    });
    expect((await readAudits()).map(({ action }) => action)).toEqual([
      REPORT_INQUIRE_ACTION.name,
    ]);
  });

  test.each<[string, Partial<CaseRow>]>([
    ['未対応', { status: 'open' }],
    ['却下', rejectedColumns()],
  ])('%sの案件では何も残さずconflictを返す', async (_label, columns) => {
    await seed([openCaseOf(1, columns)]);
    const before = await readCase(1);

    const result = await writer().recordInquiry(inquiryOf(1));

    expect(result).toBe('conflict');
    expect(await readCase(1)).toEqual(before);
    expect(await readAudits()).toEqual([]);
  });

  test('読んだ後に物理削除された案件では監査ログを含めて何も残さずnot-foundを返す', async () => {
    const result = await writer().recordInquiry(inquiryOf(1));

    expect(result).toBe('not-found');
    expect(await readCaseIds()).toEqual([]);
    expect(await readAudits()).toEqual([]);
  });
});
