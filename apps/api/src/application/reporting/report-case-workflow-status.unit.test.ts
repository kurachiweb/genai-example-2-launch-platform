import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  REPORT_CASE_STATUSES,
  type ReportCaseStatus,
} from '../../../common-lib/reporting/report-case-rules.ts';
import type { ReportCaseStatusChangeCommand } from './ports.ts';
import {
  ADMIN_ID,
  appErrorOf,
  AT,
  CASE_ID,
  CASE_NOT_FOUND,
  captureLogs,
  closedCaseOf,
  detachedCaseOf,
  OPEN_CASE_EXISTS,
  openCaseOf,
  REASON,
  reasonRejected,
  rejectionOf,
  setupWorkflow,
  STATE_CONFLICT,
  summaryOf,
} from './testing/report-case-workflow-harness.ts';

const logs = captureLogs();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

const commandOf = (
  from: ReportCaseStatus,
  to: ReportCaseStatus,
  reason: string | undefined = REASON,
): ReportCaseStatusChangeCommand => ({
  caseId: CASE_ID,
  operator: { adminId: ADMIN_ID },
  at: AT,
  from,
  to,
  reason,
});

const caseIn = (status: ReportCaseStatus) =>
  status === 'resolved' || status === 'rejected'
    ? closedCaseOf(status)
    : openCaseOf({ status });

const isClosed = (status: ReportCaseStatus): boolean =>
  status === 'resolved' || status === 'rejected';

const PAIRS = REPORT_CASE_STATUSES.flatMap((from) =>
  REPORT_CASE_STATUSES.filter((to) => to !== from).map(
    (to) => [from, to] as const,
  ),
);

const PROGRESS_PAIRS = PAIRS.filter(
  ([from, to]) => !isClosed(from) && !isClosed(to),
);

const REASON_REQUIRED_PAIRS = PAIRS.filter(
  ([from, to]) => isClosed(from) || isClosed(to),
);

const STATUS_UNCHANGED = {
  kind: 'bad_request',
  code: 'validation_error',
  message: '入力内容を確認してください。',
  details: [
    {
      field: 'status',
      code: 'unchanged',
      message: '現在と異なる対応ステータスを選んでください。',
    },
  ],
} as const;

describe('DefaultReportCaseWorkflow.changeStatus の可否と理由の要否', () => {
  test.each(REPORT_CASE_STATUSES.map((status) => [status] as const))(
    '%sから同じ状態への変更は、案件を読まずに状態の欄の検証の誤りで拒否する',
    async (status) => {
      const { workflow, calls } = setupWorkflow({ caseRecord: caseIn(status) });

      const error = await appErrorOf(
        workflow.changeStatus(commandOf(status, status)),
      );

      expect(summaryOf(error)).toEqual(STATUS_UNCHANGED);
      expect(calls).toEqual([]);
    },
  );

  test.each(PAIRS)(
    '%sから%sへの変更は手で行え、変更後の状態を返す',
    async (from, to) => {
      const { workflow, calls } = setupWorkflow({ caseRecord: caseIn(from) });

      const result = await workflow.changeStatus(commandOf(from, to));

      expect(result).toEqual({ status: to });
      expect(calls).toEqual(['find', 'prepare', 'changeStatus']);
    },
  );

  test.each(PROGRESS_PAIRS)(
    '%sから%sへの変更は理由を省略でき、理由を渡さずに確定する',
    async (from, to) => {
      const { workflow, prepared, statusChanges } = setupWorkflow({
        caseRecord: caseIn(from),
      });

      await workflow.changeStatus(commandOf(from, to, '   '));

      expect(prepared[0]?.reason).toBeUndefined();
      expect('reason' in (prepared[0] ?? {})).toBe(false);
      expect(statusChanges[0]?.reason).toBeUndefined();
    },
  );

  test.each(REASON_REQUIRED_PAIRS)(
    '%sから%sへの変更(完了への変更と再開)は理由が必須で、空なら案件を読まずに拒否する',
    async (from, to) => {
      const { workflow, calls } = setupWorkflow({ caseRecord: caseIn(from) });

      const error = await appErrorOf(
        workflow.changeStatus(commandOf(from, to, ' \n ')),
      );

      expect(summaryOf(error)).toEqual(reasonRejected('required'));
      expect(calls).toEqual([]);
    },
  );

  test.each(PAIRS)(
    '%sから%sへの変更は500書記素を超える理由を拒否し、500書記素は受け付ける',
    async (from, to) => {
      const tooLong = setupWorkflow({ caseRecord: caseIn(from) });
      const error = await appErrorOf(
        tooLong.workflow.changeStatus(commandOf(from, to, '👍'.repeat(501))),
      );
      expect(summaryOf(error)).toEqual(reasonRejected('too-long'));
      expect(tooLong.calls).toEqual([]);

      const atLimit = setupWorkflow({ caseRecord: caseIn(from) });
      await atLimit.workflow.changeStatus(
        commandOf(from, to, '👍'.repeat(500)),
      );
      expect(atLimit.statusChanges).toHaveLength(1);
    },
  );
});

describe('DefaultReportCaseWorkflow.changeStatus の案件の照合', () => {
  test('案件が無ければreport_case_not_foundを返し、監査ログを準備しない', async () => {
    const { workflow, calls, found } = setupWorkflow({ caseRecord: undefined });

    const error = await appErrorOf(
      workflow.changeStatus(commandOf('open', 'in_progress')),
    );

    expect(summaryOf(error)).toEqual(CASE_NOT_FOUND);
    expect(found).toEqual([CASE_ID]);
    expect(calls).toEqual(['find']);
  });

  test.each([
    ['open', 'in_progress', 'in_progress'],
    ['in_progress', 'open', 'resolved'],
    ['resolved', 'open', 'rejected'],
    ['open', 'resolved', 'in_progress'],
  ] as const)(
    '変更前の状態%s(変更後%s)が案件の状態%sと違えば競合を返し、書き込まない',
    async (from, to, current) => {
      const { workflow, calls } = setupWorkflow({
        caseRecord: caseIn(current),
      });

      const error = await appErrorOf(
        workflow.changeStatus(commandOf(from, to)),
      );

      expect(summaryOf(error)).toEqual(STATE_CONFLICT);
      expect(calls).toEqual(['find']);
    },
  );

  test('対象への参照を消した案件も手で変更できる', async () => {
    const { workflow, statusChanges } = setupWorkflow({
      caseRecord: detachedCaseOf(),
    });

    await workflow.changeStatus(commandOf('open', 'rejected'));

    expect(statusChanges).toHaveLength(1);
  });
});

describe('DefaultReportCaseWorkflow.changeStatus の監査ログと書き込み', () => {
  test('未対応⇄対応中は状態の変更として前後の状態を記録し、理由があれば前後の空白を除いて渡す', async () => {
    const { workflow, prepared } = setupWorkflow({
      caseRecord: caseIn('in_progress'),
    });

    await workflow.changeStatus(
      commandOf('in_progress', 'open', `  ${REASON}  `),
    );

    expect(prepared).toEqual([
      {
        operatorAdminId: ADMIN_ID,
        action: 'report.status-change',
        targetIds: [CASE_ID],
        reason: REASON,
        detail: { fromStatus: 'in_progress', toStatus: 'open' },
        occurredAt: AT,
      },
    ]);
  });

  test.each([
    ['resolved', 'open'],
    ['rejected', 'in_progress'],
  ] as const)(
    '再開(%sから%s)は状態の変更として前後の状態を記録する',
    async (from, to) => {
      const { workflow, prepared } = setupWorkflow({
        caseRecord: caseIn(from),
      });

      await workflow.changeStatus(commandOf(from, to));

      expect(prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'report.status-change',
          targetIds: [CASE_ID],
          reason: REASON,
          detail: { fromStatus: from, toStatus: to },
          occurredAt: AT,
        },
      ]);
    },
  );

  test.each([
    ['open', 'resolved'],
    ['in_progress', 'resolved'],
    ['rejected', 'resolved'],
  ] as const)(
    '手での対応済(%sから%s)は対応済の操作種別に措置なし・手での変更の印・変更前の状態を記録する',
    async (from, to) => {
      const { workflow, prepared } = setupWorkflow({
        caseRecord: caseIn(from),
      });

      await workflow.changeStatus(commandOf(from, to));

      expect(prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'report.resolve',
          targetIds: [CASE_ID],
          reason: REASON,
          detail: { resolution: 'none', mode: 'manual', fromStatus: from },
          occurredAt: AT,
        },
      ]);
    },
  );

  test.each([
    ['open', 'rejected'],
    ['in_progress', 'rejected'],
    ['resolved', 'rejected'],
  ] as const)(
    '手での却下(%sから%s)は却下の操作種別に手での変更の印と変更前の状態を記録する',
    async (from, to) => {
      const { workflow, prepared } = setupWorkflow({
        caseRecord: caseIn(from),
      });

      await workflow.changeStatus(commandOf(from, to));

      expect(prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'report.reject',
          targetIds: [CASE_ID],
          reason: REASON,
          detail: { mode: 'manual', fromStatus: from },
          occurredAt: AT,
        },
      ]);
    },
  );

  test('書き込みの単位へ案件・前後の状態・理由・日時と準備した監査ログを渡す', async () => {
    const { workflow, statusChanges, preparedEntries } = setupWorkflow({
      caseRecord: caseIn('resolved'),
    });

    await workflow.changeStatus(commandOf('resolved', 'open', ` ${REASON} `));

    expect(
      statusChanges.map(({ caseId, from, to, reason, at }) => ({
        caseId,
        from,
        to,
        reason,
        at,
      })),
    ).toEqual([
      {
        caseId: CASE_ID,
        from: 'resolved',
        to: 'open',
        reason: REASON,
        at: AT,
      },
    ]);
    expect(preparedEntries).toHaveLength(1);
    expect(statusChanges[0]?.audit).toBe(preparedEntries[0]);
  });

  test.each([
    ['conflict', STATE_CONFLICT],
    ['open-case-exists', OPEN_CASE_EXISTS],
    ['not-found', CASE_NOT_FOUND],
  ] as const)(
    '書き込みの単位の結果%sを想定内の失敗に変える',
    async (statusChangeResult, expected) => {
      const { workflow, calls } = setupWorkflow({
        caseRecord: caseIn('resolved'),
        statusChangeResult,
      });

      const error = await appErrorOf(
        workflow.changeStatus(commandOf('resolved', 'in_progress')),
      );

      expect(summaryOf(error)).toEqual(expected);
      expect(calls).not.toContain('dispatch');
    },
  );

  test('書き込みの単位の想定外の例外はそのまま投げる', async () => {
    const writeError = new Error('D1_ERROR: 想定外');
    const { workflow } = setupWorkflow({
      caseRecord: caseIn('open'),
      writeError,
    });

    expect(
      await rejectionOf(
        workflow.changeStatus(commandOf('open', 'in_progress')),
      ),
    ).toBe(writeError);
  });

  test.each(PAIRS)(
    '%sから%sへの手での変更は当事者への通知を依頼しない',
    async (from, to) => {
      const { workflow, dispatched, closings } = setupWorkflow({
        caseRecord: caseIn(from),
      });

      await workflow.changeStatus(commandOf(from, to));

      expect(dispatched).toEqual([]);
      expect(closings).toEqual([]);
    },
  );

  test('確定の後のログには識別子と変更後の状態だけを出し、理由を出さない', async () => {
    const { workflow } = setupWorkflow({ caseRecord: caseIn('open') });

    await workflow.changeStatus(commandOf('open', 'rejected'));

    expect(logs.records()).toEqual([
      {
        level: 'info',
        properties: {
          caseId: CASE_ID,
          operatorAdminId: ADMIN_ID,
          status: 'rejected',
        },
      },
    ]);
    expect(JSON.stringify(logs.records())).not.toContain(REASON);
  });
});
