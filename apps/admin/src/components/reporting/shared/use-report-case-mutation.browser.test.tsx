import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../../styles.css';
import { failure, success } from '../../../../test/admin-accounts-fixtures.ts';
import { watchAuditLogQueries } from '../../../../test/audit-log-queries.ts';
import { variablesOf } from '../../../../test/moderation-fixtures.ts';
import {
  REPORT_CASE_ID,
  REPORT_REASON,
  reportCaseOutcomeOf,
  type ReportingGraphQLHandler,
  respondReportingGraphQL,
  watchReportingQueries,
} from '../../../../test/reporting-fixtures.ts';
import { renderReportCasePart } from '../../../../test/reporting-render.tsx';
import type { ReportCaseStatus } from '../../../../common-lib/reporting/report-case-rules.ts';
import {
  AdminChangeReportCaseStatusDocument,
  AdminResolveReportCaseWithMeasureDocument,
  AdminSendInfringementInquiryDocument,
} from '../../../graphql/generated/graphql.ts';
import { useReportCaseMutation } from './use-report-case-mutation.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const INQUIRY_MESSAGE = '権利の侵害の申出について、ご確認をお願いします。';

function StatusChangeHarness({
  from,
  to,
  deferRefresh,
}: {
  readonly from: ReportCaseStatus;
  readonly to: ReportCaseStatus;
  readonly deferRefresh: boolean;
}) {
  const { run, refreshAfter } = useReportCaseMutation('change-status', {
    targetKind: 'product',
    deferRefresh,
  });
  const [failed, setFailed] = useState<unknown>();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          run({
            caseId: REPORT_CASE_ID,
            from,
            to,
            reason: REPORT_REASON,
          }).catch((error: unknown) => {
            setFailed(() => error);
          });
        }}
      >
        状態を変える
      </button>
      {failed === undefined ? null : (
        <>
          <p role="alert">失敗しました</p>
          <button
            type="button"
            onClick={() => {
              void refreshAfter(failed);
            }}
          >
            取り直す
          </button>
        </>
      )}
    </>
  );
}

function InquiryHarness() {
  const { run } = useReportCaseMutation('send-inquiry', {
    targetKind: 'product',
  });
  return (
    <button
      type="button"
      onClick={() => {
        void run({ caseId: REPORT_CASE_ID, message: INQUIRY_MESSAGE });
      }}
    >
      照会する
    </button>
  );
}

function MeasureHarness() {
  const { run } = useReportCaseMutation('resolve-with-measure', {
    targetKind: 'user',
  });
  return (
    <button
      type="button"
      onClick={() => {
        void run({ caseId: REPORT_CASE_ID, reason: REPORT_REASON });
      }}
    >
      停止する
    </button>
  );
}

const renderHarness = async (
  element: ReactNode,
  handlers: ReadonlyMap<unknown, ReportingGraphQLHandler>,
) => {
  respondReportingGraphQL(executeGraphQL, { role: 'MODERATOR', handlers });
  const router = await renderReportCasePart(element, {
    role: 'MODERATOR',
    withHost: false,
  });
  const { queryClient } = router.options.context;
  return {
    queries: watchReportingQueries(queryClient),
    auditLogsInvalidated: watchAuditLogQueries(queryClient),
  };
};

const click = async (name: string): Promise<void> => {
  await page.getByRole('button', { name, exact: true }).click();
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
});

describe('対応ステータスの変更', () => {
  test.each([
    {
      from: 'open',
      to: 'in_progress',
      status: 'IN_PROGRESS',
      message: '対応中にしました。',
    },
    {
      from: 'in_progress',
      to: 'open',
      status: 'OPEN',
      message: '未対応に戻しました。',
    },
    {
      from: 'open',
      to: 'resolved',
      status: 'RESOLVED',
      message: '対応済にしました。',
    },
    {
      from: 'resolved',
      to: 'rejected',
      status: 'REJECTED',
      message: '却下しました。',
    },
  ] as const)(
    '$fromから$toへの変更の成功は「$message」と知らせ、本specの照会と監査ログの照会を無効にする',
    async ({ from, to, status, message }) => {
      const { queries, auditLogsInvalidated } = await renderHarness(
        <StatusChangeHarness from={from} to={to} deferRefresh={false} />,
        new Map([
          [
            AdminChangeReportCaseStatusDocument,
            () => reportCaseOutcomeOf('changeReportCaseStatus', status),
          ],
        ]),
      );

      await click('状態を変える');

      await expect.element(page.getByText(message)).toBeVisible();
      expect(
        variablesOf(executeGraphQL, AdminChangeReportCaseStatusDocument),
      ).toStrictEqual([
        {
          id: REPORT_CASE_ID,
          from: from.toUpperCase(),
          to: status,
          reason: REPORT_REASON,
        },
      ]);
      expect(queries.cases()).toBe(true);
      expect(queries.detail()).toBe(true);
      expect(queries.summaries()).toBe(true);
      expect(auditLogsInvalidated()).toBe(true);
      expect(queries.moderationProducts()).toBe(false);
    },
  );

  test('再開の拒否(未完了の別の案件)は照会を無効にしない', async () => {
    const { queries, auditLogsInvalidated } = await renderHarness(
      <StatusChangeHarness from="resolved" to="open" deferRefresh={false} />,
      new Map([
        [
          AdminChangeReportCaseStatusDocument,
          () =>
            failure({
              code: 'report_case_open_exists',
              message:
                'この対象には未完了の別の案件があります。その案件で対応してください。',
              status: 409,
            }),
        ],
      ]),
    );

    await click('状態を変える');

    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(queries.cases()).toBe(false);
    expect(auditLogsInvalidated()).toBe(false);
  });

  test('取り直しを遅らせると、競合の失敗で照会を無効にせず、呼び出し元が取り直しを頼んだ時に無効にする', async () => {
    const { queries, auditLogsInvalidated } = await renderHarness(
      <StatusChangeHarness from="open" to="in_progress" deferRefresh />,
      new Map([
        [
          AdminChangeReportCaseStatusDocument,
          () =>
            failure({
              code: 'report_case_state_conflict',
              message:
                '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
              status: 409,
            }),
        ],
      ]),
    );

    await click('状態を変える');
    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(queries.detail()).toBe(false);

    await click('取り直す');

    await expect.poll(queries.detail).toBe(true);
    expect(queries.cases()).toBe(true);
    expect(queries.summaries()).toBe(true);
    expect(queries.moderationProducts()).toBe(false);
    expect(auditLogsInvalidated()).toBe(false);
  });
});

describe('照会と措置', () => {
  test('照会の成功は「照会を送りました。」と知らせ、本specの照会と監査ログの照会を無効にする', async () => {
    const { queries, auditLogsInvalidated } = await renderHarness(
      <InquiryHarness />,
      new Map([
        [
          AdminSendInfringementInquiryDocument,
          () =>
            success({
              sendInfringementInquiry: {
                sentAt: '2026-11-03T00:00:00.000Z',
                deadline: '2026-11-10T00:00:00.000Z',
              },
            }),
        ],
      ]),
    );

    await click('照会する');

    await expect.element(page.getByText('照会を送りました。')).toBeVisible();
    expect(queries.detail()).toBe(true);
    expect(queries.summaries()).toBe(true);
    expect(auditLogsInvalidated()).toBe(true);
  });

  test('ユーザーへの措置の成功は、停止の影響するUGC管理のユーザーとプロダクトの照会も無効にする', async () => {
    const { queries } = await renderHarness(
      <MeasureHarness />,
      new Map([
        [
          AdminResolveReportCaseWithMeasureDocument,
          () => reportCaseOutcomeOf('resolveReportCaseWithMeasure', 'RESOLVED'),
        ],
      ]),
    );

    await click('停止する');

    await expect.element(page.getByText('対応済にしました。')).toBeVisible();
    expect(queries.moderationUsers()).toBe(true);
    expect(queries.moderationProducts()).toBe(true);
  });
});
