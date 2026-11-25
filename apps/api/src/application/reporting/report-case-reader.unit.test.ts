import { describe, expect, test } from 'bun:test';

import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';
import {
  REPORT_REJECT_ACTION,
  REPORT_RESOLVE_ACTION,
} from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import { REPORT_LIST_PAGE_SIZE } from '../../../common-lib/reporting/report-case-rules.ts';
import type { UserSummaryRecord } from '../../../lib/core/profile/ports.ts';
import type {
  ProductReportSummary,
  ReportCaseFilter,
  ReportCaseRecord,
  ReportCaseReporterView,
  ReportTargetView,
} from './ports.ts';
import {
  ago,
  CATEGORY_ID,
  caseOf,
  DAY_MS,
  HOUR_MS,
  keyOf,
  NOW,
  OWNER_ID,
  PRODUCT_ID,
  reportOf,
  setupReportCaseReader as setup,
  UNAVAILABLE_VIEW,
  viewOf,
} from './testing/report-case-reader-fakes.ts';

const REPORTER_ID = '01JQ0USR000000000000000002';
const WITHDRAWN_REPORTER_ID = '01JQ0USR000000000000000003';
const COMMENT_ID = '01JQ0CMT000000000000000001';
const NEXT_CURSOR = 'next-page-cursor';

const REPORT_TARGET_KIND: AuditTargetKind = 'report';

const CLOSING_ACTIONS = [
  REPORT_REJECT_ACTION.name,
  REPORT_RESOLVE_ACTION.name,
].toSorted((a, b) => a.localeCompare(b));

const startOf = (record: ReportCaseRecord): Date => {
  if (record.infringementReportedAt === null) {
    throw new Error('権利侵害の案件ではありません');
  }
  return record.infringementReportedAt;
};

const byAction = <T extends { readonly action: string }>(
  lookups: readonly T[],
): readonly T[] => lookups.toSorted((a, b) => a.action.localeCompare(b.action));

describe('DefaultReportCaseReader.list', () => {
  const open = caseOf({ caseId: '01JQ0CAS000000000000000001' });
  const resolvedInfringement = caseOf({
    caseId: '01JQ0CAS000000000000000002',
    targetKind: 'comment',
    targetId: COMMENT_ID,
    status: 'resolved',
    infringementReportedAt: ago(10 * DAY_MS),
    closedAt: ago(4 * DAY_MS),
    resolution: 'comment.hide',
    closingReason: '権利侵害を確認しました',
  });
  const rejectedInfringement = caseOf({
    caseId: '01JQ0CAS000000000000000003',
    targetKind: 'user',
    targetId: OWNER_ID,
    productId: null,
    status: 'rejected',
    infringementReportedAt: ago(20 * DAY_MS),
    closedAt: ago(DAY_MS),
    closingReason: '権利侵害にあたりません',
  });
  const reopenedInfringement = caseOf({
    caseId: '01JQ0CAS000000000000000004',
    status: 'in_progress',
    infringementReportedAt: ago(30 * HOUR_MS),
  });
  const unknownCompletion = caseOf({
    caseId: '01JQ0CAS000000000000000005',
    targetId: null,
    targetDetachedAt: ago(DAY_MS),
    targetOwnerUserId: null,
    status: 'resolved',
    infringementReportedAt: ago(200 * DAY_MS),
    closedAt: ago(100 * DAY_MS),
    resolution: 'none',
    closingReason: '対応済みです',
  });
  const closedPlain = caseOf({
    caseId: '01JQ0CAS000000000000000006',
    status: 'rejected',
    closedAt: ago(HOUR_MS),
    closingReason: '問題ありません',
  });
  const allCases = [
    open,
    resolvedInfringement,
    rejectedInfringement,
    reopenedInfringement,
    unknownCompletion,
    closedPlain,
  ];

  const resolvedInfringementAt = ago(3 * DAY_MS);
  const rejectedInfringementAt = ago(DAY_MS);
  const options = {
    cases: allCases,
    nextCursor: NEXT_CURSOR,
    views: new Map([
      [keyOf(open), viewOf('プロダクト')],
      [keyOf(resolvedInfringement), viewOf('コメント')],
      [keyOf(rejectedInfringement), viewOf('ユーザー')],
    ]),
    // 手での完了も同じ操作種別で記録されるため、対応済の後の手での却下が新しい方になる
    resolvedAt: new Map([
      [resolvedInfringement.caseId, resolvedInfringementAt],
      [rejectedInfringement.caseId, ago(5 * DAY_MS)],
      [reopenedInfringement.caseId, ago(2 * HOUR_MS)],
      [closedPlain.caseId, ago(HOUR_MS)],
    ]),
    rejectedAt: new Map([
      [resolvedInfringement.caseId, ago(6 * DAY_MS)],
      [rejectedInfringement.caseId, rejectedInfringementAt],
    ]),
  };

  test('案件・表示・完了の日時をそれぞれ1回でまとめて引く', async () => {
    const { reader, calls, searches, describes, manyLookups } = setup(options);
    const filter: ReportCaseFilter = {
      status: 'resolved',
      categoryId: CATEGORY_ID,
    };

    const page = await reader.list(filter, { after: 'cursor', first: 50 }, NOW);

    expect(calls.toSorted()).toEqual([
      `audit.latestForMany:${REPORT_REJECT_ACTION.name}`,
      `audit.latestForMany:${REPORT_RESOLVE_ACTION.name}`,
      'store.search',
      'targets.describe',
    ]);
    expect(searches).toEqual([
      { filter, page: { after: 'cursor', limit: 50 } },
    ]);
    expect(describes).toEqual([
      allCases.map((record) => ({
        kind: record.targetKind,
        targetId: record.targetId,
        productId: record.productId,
      })),
    ]);
    expect(byAction(manyLookups)).toEqual(
      CLOSING_ACTIONS.map((action) => ({
        action,
        targetKind: REPORT_TARGET_KIND,
        targetIds: [
          resolvedInfringement.caseId,
          rejectedInfringement.caseId,
          unknownCompletion.caseId,
        ],
      })),
    );
    expect(page.nextCursor).toBe(NEXT_CURSOR);
    expect(page.items.map((item) => item.caseId)).toEqual(
      allCases.map((record) => record.caseId),
    );
  });

  test('案件の値と対象の表示を返し、表示を得られない対象は表示できないとする', async () => {
    const { reader } = setup(options);

    const { items } = await reader.list({}, { first: 50 }, NOW);

    expect(items[0]).toEqual({
      caseId: open.caseId,
      target: {
        kind: 'product',
        targetId: PRODUCT_ID,
        productId: PRODUCT_ID,
        view: viewOf('プロダクト'),
      },
      status: 'open',
      reportCount: 2,
      categoryCounts: [{ categoryId: CATEGORY_ID, name: 'スパム', count: 2 }],
      firstReportedAt: open.firstReportedAt,
      lastReportedAt: open.lastReportedAt,
      infringement: false,
      responseTime: null,
    });
    expect(items[4]?.target).toEqual({
      kind: 'product',
      targetId: null,
      productId: PRODUCT_ID,
      view: UNAVAILABLE_VIEW,
    });
  });

  test('完了した権利侵害の案件は対応済と却下の新しい方を最後の完了とする', async () => {
    const { reader } = setup(options);

    const { items } = await reader.list({}, { first: 50 }, NOW);

    expect(items[1]?.responseTime).toEqual({
      startedAt: startOf(resolvedInfringement),
      completedAt: resolvedInfringementAt,
      elapsedMs: 7 * DAY_MS,
      alerts: [],
    });
    expect(items[2]?.responseTime).toEqual({
      startedAt: startOf(rejectedInfringement),
      completedAt: rejectedInfringementAt,
      elapsedMs: 19 * DAY_MS,
      alerts: ['decision-overdue'],
    });
  });

  test('完了から戻した権利侵害の案件は現在までを対応中の期間とする', async () => {
    const { reader } = setup(options);

    const { items } = await reader.list({}, { first: 50 }, NOW);

    expect(items[3]?.responseTime).toEqual({
      startedAt: startOf(reopenedInfringement),
      completedAt: null,
      elapsedMs: 30 * HOUR_MS,
      alerts: [],
    });
  });

  test('完了の日時を監査ログから得られない完了した案件は不明とする', async () => {
    const { reader } = setup(options);

    const { items } = await reader.list({}, { first: 50 }, NOW);

    expect(items[4]?.responseTime).toEqual({
      startedAt: startOf(unknownCompletion),
      completedAt: null,
      elapsedMs: null,
      alerts: [],
    });
  });

  test('権利侵害でない案件には対応期間を付けない', async () => {
    const { reader } = setup(options);

    const { items } = await reader.list({}, { first: 50 }, NOW);

    expect(items[0]?.responseTime).toBeNull();
    expect(items[5]?.responseTime).toBeNull();
    expect(items[5]?.infringement).toBe(false);
    expect(items[1]?.infringement).toBe(true);
  });

  test('未対応のまま24時間を超えた権利侵害の案件は確認開始の目標の超過とする', async () => {
    const overdue = caseOf({ infringementReportedAt: ago(25 * HOUR_MS) });
    const { reader } = setup({ cases: [overdue] });

    const { items } = await reader.list({}, { first: 50 }, NOW);

    expect(items[0]?.responseTime).toEqual({
      startedAt: startOf(overdue),
      completedAt: null,
      elapsedMs: 25 * HOUR_MS,
      alerts: ['start-overdue'],
    });
  });

  test('完了した権利侵害の案件が無いページでは監査ログを引かない', async () => {
    const { reader, calls } = setup({
      cases: [open, closedPlain, reopenedInfringement],
    });

    await reader.list({}, { first: 50 }, NOW);

    expect(calls.toSorted()).toEqual(['store.search', 'targets.describe']);
  });

  test('1ページの件数を一覧の上限に抑える', async () => {
    const { reader, searches } = setup();

    await reader.list({}, { first: REPORT_LIST_PAGE_SIZE + 1 }, NOW);

    expect(searches[0]?.page).toEqual({ limit: REPORT_LIST_PAGE_SIZE });
  });
});

describe('DefaultReportCaseReader.detail', () => {
  const CASE_ID = '01JQ0CAS000000000000000010';
  const base = caseOf({
    caseId: CASE_ID,
    targetKind: 'comment',
    targetId: COMMENT_ID,
    status: 'in_progress',
    statusChangedAt: ago(2 * HOUR_MS),
    infringementReportedAt: ago(3 * DAY_MS),
  });
  const reporter: UserSummaryRecord = {
    userId: REPORTER_ID,
    handle: 'reporter',
    nickname: '通報したひと',
    avatarFileId: null,
    suspended: true,
  };

  test('存在しない案件はundefinedを返し、他を照会しない', async () => {
    const { reader, calls } = setup({ cases: [] });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(detail).toBeUndefined();
    expect(calls).toEqual(['store.find']);
  });

  test('通報を受付の古い順に申出者の表示とともに返し、表示名を1回でまとめて引く', async () => {
    const reports = [
      reportOf({ reportId: 'report-1', reporterUserId: REPORTER_ID }),
      reportOf({ reportId: 'report-2', reporterUserId: WITHDRAWN_REPORTER_ID }),
      reportOf({ reportId: 'report-3', hasContact: true }),
      reportOf({ reportId: 'report-4', hasContact: false }),
      reportOf({ reportId: 'report-5', reporterUserId: REPORTER_ID }),
    ];
    const { reader, summaryLookups } = setup({
      cases: [base],
      reports,
      reporters: [reporter],
    });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(summaryLookups).toEqual([
      { ids: [REPORTER_ID, WITHDRAWN_REPORTER_ID], scope: 'not-withdrawn' },
    ]);
    const member: ReportCaseReporterView = {
      kind: 'member',
      nickname: '通報したひと',
      handle: 'reporter',
    };
    const expected: readonly [string, ReportCaseReporterView][] = [
      ['report-1', member],
      ['report-2', { kind: 'member', nickname: null, handle: null }],
      ['report-3', { kind: 'guest', hasContact: true }],
      ['report-4', { kind: 'guest', hasContact: false }],
      ['report-5', member],
    ];
    expect(detail?.reports).toEqual(
      expected.map(([reportId, reporterView]) => ({
        reportId,
        categoryName: 'スパム',
        reason: '宣伝の投稿が続いています',
        reportedAt: reportOf().reportedAt,
        reporter: reporterView,
      })),
    );
  });

  test('未ログインの通報だけなら表示名を引かない', async () => {
    const { reader, calls } = setup({
      cases: [base],
      reports: [reportOf({ hasContact: true })],
    });

    await reader.detail(CASE_ID, NOW);

    expect(calls).not.toContain('profiles.findSummaries');
  });

  test('対象の表示と案件の状態を返す', async () => {
    const view: ReportTargetView = {
      ...UNAVAILABLE_VIEW,
      available: true,
      excerpt: 'コメントの抜粋',
      productName: 'プロダクト',
      productHandle: 'product',
    };
    const { reader, describes } = setup({
      cases: [base],
      views: new Map([[keyOf(base), view]]),
    });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(describes).toEqual([
      [{ kind: 'comment', targetId: COMMENT_ID, productId: PRODUCT_ID }],
    ]);
    expect(detail).toMatchObject({
      caseId: CASE_ID,
      target: {
        kind: 'comment',
        targetId: COMMENT_ID,
        productId: PRODUCT_ID,
        view,
      },
      status: 'in_progress',
      statusChangedAt: base.statusChangedAt,
      reportCount: 2,
      categoryCounts: base.categoryCounts,
      firstReportedAt: base.firstReportedAt,
      lastReportedAt: base.lastReportedAt,
      infringement: true,
      resolution: null,
      closingReason: null,
      closedAt: null,
      lastInquiry: null,
    });
  });

  test('完了した権利侵害の案件は完了の種類と理由と日時、監査ログの新しい方の完了を返す', async () => {
    const closed = caseOf({
      ...base,
      status: 'resolved',
      closedAt: ago(DAY_MS),
      resolution: 'comment.hide',
      closingReason: '権利侵害を確認しました',
    });
    const completedAt = ago(DAY_MS);
    const { reader, singleLookups } = setup({
      cases: [closed],
      resolvedAt: new Map([[CASE_ID, completedAt]]),
      rejectedAt: new Map([[CASE_ID, ago(2 * DAY_MS)]]),
    });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(byAction(singleLookups)).toEqual(
      CLOSING_ACTIONS.map((action) => ({
        action,
        targetKind: REPORT_TARGET_KIND,
        targetId: CASE_ID,
      })),
    );
    expect(detail).toMatchObject({
      status: 'resolved',
      resolution: 'comment.hide',
      closingReason: '権利侵害を確認しました',
      closedAt: closed.closedAt,
      responseTime: {
        startedAt: closed.infringementReportedAt,
        completedAt,
        elapsedMs: 2 * DAY_MS,
        alerts: [],
      },
    });
  });

  test('完了の日時を監査ログから得られない完了した権利侵害の案件は対応期間を不明とする', async () => {
    const closed = caseOf({
      ...base,
      status: 'rejected',
      closedAt: ago(DAY_MS),
      closingReason: '権利侵害にあたりません',
    });
    const { reader } = setup({ cases: [closed] });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(detail?.responseTime).toEqual({
      startedAt: startOf(closed),
      completedAt: null,
      elapsedMs: null,
      alerts: [],
    });
  });

  test('完了していない権利侵害の案件は監査ログを引かずに現在までを対応中の期間とする', async () => {
    const { reader, calls } = setup({
      cases: [base],
      resolvedAt: new Map([[CASE_ID, ago(DAY_MS)]]),
    });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(calls.filter((call) => call.startsWith('audit.'))).toEqual([]);
    expect(detail?.responseTime).toEqual({
      startedAt: startOf(base),
      completedAt: null,
      elapsedMs: 3 * DAY_MS,
      alerts: [],
    });
  });

  test('権利侵害でない完了した案件は監査ログを引かず対応期間を付けない', async () => {
    const closed = caseOf({
      ...base,
      status: 'rejected',
      infringementReportedAt: null,
      closedAt: ago(DAY_MS),
      closingReason: '問題ありません',
    });
    const { reader, calls } = setup({ cases: [closed] });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(calls.filter((call) => call.startsWith('audit.'))).toEqual([]);
    expect(detail?.responseTime).toBeNull();
    expect(detail?.infringement).toBe(false);
  });

  test('最後の照会の期限を求め、対応中で期限を過ぎていれば超過とする', async () => {
    const sentAt = ago(8 * DAY_MS);
    const inquired = caseOf({
      ...base,
      lastInquiredAt: sentAt,
      lastInquiryMessage: '権利の根拠を教えてください',
    });
    const { reader } = setup({ cases: [inquired], contacts: [OWNER_ID] });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(detail?.lastInquiry).toEqual({
      sentAt,
      message: '権利の根拠を教えてください',
      deadline: new Date(sentAt.getTime() + 7 * DAY_MS),
      overdue: true,
    });
  });

  test('期限の前と、対応中でない案件の照会は超過としない', async () => {
    const recent = caseOf({
      ...base,
      lastInquiredAt: ago(6 * DAY_MS),
      lastInquiryMessage: '照会の内容',
    });
    const closed = caseOf({
      ...base,
      caseId: '01JQ0CAS000000000000000011',
      status: 'resolved',
      closedAt: ago(HOUR_MS),
      resolution: 'none',
      closingReason: '対応しました',
      lastInquiredAt: ago(8 * DAY_MS),
      lastInquiryMessage: '照会の内容',
    });
    const { reader } = setup({ cases: [recent, closed] });

    const recentDetail = await reader.detail(recent.caseId, NOW);
    const closedDetail = await reader.detail(closed.caseId, NOW);

    expect(recentDetail?.lastInquiry?.overdue).toBe(false);
    expect(closedDetail?.lastInquiry?.overdue).toBe(false);
  });

  const commentView: ReportTargetView = {
    ...UNAVAILABLE_VIEW,
    available: true,
    excerpt: 'コメントの抜粋',
    productName: 'プロダクト',
    productHandle: 'product',
  };
  const inquirable = { views: new Map([[keyOf(base), commentView]]) };

  test('権利侵害・対応中・利用者側のURLを示せる対象・投稿者の宛先があるときだけ照会できる', async () => {
    const { reader, contactLookups } = setup({
      ...inquirable,
      cases: [base],
      contacts: [OWNER_ID],
    });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(detail?.inquiryAvailable).toBe(true);
    expect(contactLookups).toEqual([OWNER_ID]);
  });

  test('投稿者の宛先が無ければ照会できない', async () => {
    const { reader } = setup({ ...inquirable, cases: [base], contacts: [] });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(detail?.inquiryAvailable).toBe(false);
  });

  test.each([
    ['表示できない対象', base, UNAVAILABLE_VIEW],
    [
      'プロダクトのハンドルが無いコメント',
      base,
      { ...commentView, productHandle: null },
    ],
    [
      'ハンドルが無いプロダクト',
      caseOf({ ...base, targetKind: 'product', targetId: PRODUCT_ID }),
      { ...viewOf('プロダクト'), handle: null },
    ],
    [
      'ハンドルが無いユーザー',
      caseOf({
        ...base,
        targetKind: 'user',
        targetId: OWNER_ID,
        productId: null,
      }),
      { ...viewOf('ユーザー'), handle: null },
    ],
  ])('宛先があっても%sの案件は照会できない', async (_label, record, view) => {
    const { reader } = setup({
      cases: [record],
      views: new Map([[keyOf(record), view]]),
      contacts: [OWNER_ID],
    });

    const detail = await reader.detail(CASE_ID, NOW);

    expect(detail?.inquiryAvailable).toBe(false);
  });

  test.each([
    ['未対応', { status: 'open' as const }],
    ['権利侵害でない', { infringementReportedAt: null }],
    [
      '対象への参照を消した',
      {
        targetId: null,
        targetDetachedAt: ago(HOUR_MS),
        targetOwnerUserId: null,
      },
    ],
  ])(
    '%sの案件は宛先を引かずに照会できないとする',
    async (_label, overrides) => {
      const record = caseOf({ ...base, ...overrides });
      const { reader, calls } = setup({
        cases: [record],
        views: new Map([[keyOf(record), commentView]]),
        contacts: [OWNER_ID],
      });

      const detail = await reader.detail(CASE_ID, NOW);

      expect(detail?.inquiryAvailable).toBe(false);
      expect(calls).not.toContain('contacts.findContact');
    },
  );
});

describe('DefaultReportCaseReader.unhandledSummary', () => {
  test('未対応の件数と権利侵害の件数を返す', async () => {
    const { reader, calls } = setup({
      unhandled: { open: 12, infringementOpen: 3 },
    });

    const summary = await reader.unhandledSummary();

    expect(summary).toEqual({ open: 12, infringementOpen: 3 });
    expect(calls).toEqual(['store.countUnhandled']);
  });
});

describe('DefaultReportCaseReader.productSummary', () => {
  test('プロダクトの通報の件数と未完了の案件を返す', async () => {
    const productSummary: ProductReportSummary = {
      reportCount: 7,
      openCase: {
        caseId: '01JQ0CAS000000000000000020',
        status: 'in_progress',
      },
    };
    const { reader, calls, productLookups } = setup({ productSummary });

    const summary = await reader.productSummary(PRODUCT_ID);

    expect(summary).toEqual(productSummary);
    expect(calls).toEqual(['store.productSummary']);
    expect(productLookups).toEqual([PRODUCT_ID]);
  });
});
