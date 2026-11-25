import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { ReportCaseClosingCommand } from './ports.ts';
import {
  ADMIN_ID,
  appErrorOf,
  AT,
  CASE_CLOSED,
  CASE_ID,
  CASE_NOT_FOUND,
  captureLogs,
  closedCaseOf,
  detachedCaseOf,
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

const commandOf = (reason: string = REASON): ReportCaseClosingCommand => ({
  caseId: CASE_ID,
  operator: { adminId: ADMIN_ID },
  at: AT,
  reason,
});

const OPERATIONS = [['resolveWithoutMeasure'], ['reject']] as const;

type Operation = (typeof OPERATIONS)[number][0];

const run = (
  harness: ReturnType<typeof setupWorkflow>,
  operation: Operation,
  command: ReportCaseClosingCommand = commandOf(),
) =>
  operation === 'reject'
    ? harness.workflow.reject(command)
    : harness.workflow.resolveWithoutMeasure(command);

const closingInputsOf = (harness: ReturnType<typeof setupWorkflow>) =>
  harness.closings.map(
    ({ caseId, to, resolution, reason, posterNotice, at }) => ({
      caseId,
      to,
      resolution,
      reason,
      posterNotice,
      at,
    }),
  );

describe('DefaultReportCaseWorkflow の措置なしの対応済・却下の検証', () => {
  test.each(OPERATIONS)(
    '%sは理由が空なら案件を読まずに拒否する',
    async (operation) => {
      const harness = setupWorkflow();

      const error = await appErrorOf(run(harness, operation, commandOf(' ')));

      expect(summaryOf(error)).toEqual(reasonRejected('required'));
      expect(harness.calls).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    '%sは500書記素を超える理由を拒否し、500書記素は受け付ける',
    async (operation) => {
      const tooLong = setupWorkflow();
      const error = await appErrorOf(
        run(tooLong, operation, commandOf('あ'.repeat(501))),
      );
      expect(summaryOf(error)).toEqual(reasonRejected('too-long'));
      expect(tooLong.calls).toEqual([]);

      const atLimit = setupWorkflow();
      await run(atLimit, operation, commandOf('あ'.repeat(500)));
      expect(atLimit.closings).toHaveLength(1);
    },
  );

  test.each(OPERATIONS)(
    '%sは案件が無ければreport_case_not_foundを返す',
    async (operation) => {
      const harness = setupWorkflow({ caseRecord: undefined });

      const error = await appErrorOf(run(harness, operation));

      expect(summaryOf(error)).toEqual(CASE_NOT_FOUND);
      expect(harness.found).toEqual([CASE_ID]);
      expect(harness.calls).toEqual(['find']);
    },
  );

  test.each([
    ['resolveWithoutMeasure', 'resolved'],
    ['resolveWithoutMeasure', 'rejected'],
    ['reject', 'resolved'],
    ['reject', 'rejected'],
  ] as const)(
    '%sは完了(%s)した案件を拒否し、監査ログを準備しない',
    async (operation, status) => {
      const harness = setupWorkflow({ caseRecord: closedCaseOf(status) });

      const error = await appErrorOf(run(harness, operation));

      expect(summaryOf(error)).toEqual(CASE_CLOSED);
      expect(harness.calls).toEqual(['find']);
    },
  );
});

describe('DefaultReportCaseWorkflow.resolveWithoutMeasure', () => {
  test.each([['open'], ['in_progress']] as const)(
    '%sの案件の監査ログに措置なし・操作の印・変更前の状態を記録し、対応済を返す',
    async (status) => {
      const harness = setupWorkflow({ caseRecord: openCaseOf({ status }) });

      const result = await harness.workflow.resolveWithoutMeasure(
        commandOf(`  ${REASON}  `),
      );

      expect(result).toEqual({ status: 'resolved' });
      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'report.resolve',
          targetIds: [CASE_ID],
          reason: REASON,
          detail: { resolution: 'none', mode: 'operation', fromStatus: status },
          occurredAt: AT,
        },
      ]);
    },
  );

  test('書き込みの単位へ措置なしの完了を渡し、投稿者への通知をnoneにする', async () => {
    const harness = setupWorkflow();

    await harness.workflow.resolveWithoutMeasure(commandOf());

    expect(closingInputsOf(harness)).toEqual([
      {
        caseId: CASE_ID,
        to: 'resolved',
        resolution: 'none',
        reason: REASON,
        posterNotice: 'none',
        at: AT,
      },
    ]);
    expect(harness.preparedEntries).toHaveLength(1);
    expect(harness.closings[0]?.audit).toBe(harness.preparedEntries[0]);
  });

  test('対象への参照を消した案件も措置なしで対応済にでき、投稿者への通知はnoneにする', async () => {
    const harness = setupWorkflow({ caseRecord: detachedCaseOf() });

    await harness.workflow.resolveWithoutMeasure(commandOf());

    expect(harness.closings[0]?.posterNotice).toBe('none');
  });
});

describe('DefaultReportCaseWorkflow.reject', () => {
  test.each([['open'], ['in_progress']] as const)(
    '%sの案件の監査ログに操作の印と変更前の状態を記録し、却下を返す',
    async (status) => {
      const harness = setupWorkflow({ caseRecord: openCaseOf({ status }) });

      const result = await harness.workflow.reject(commandOf(`\n${REASON} `));

      expect(result).toEqual({ status: 'rejected' });
      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'report.reject',
          targetIds: [CASE_ID],
          reason: REASON,
          detail: { mode: 'operation', fromStatus: status },
          occurredAt: AT,
        },
      ]);
    },
  );

  test('投稿者がいれば投稿者への通知を依頼待ちにして書き込みの単位へ渡す', async () => {
    const harness = setupWorkflow();

    await harness.workflow.reject(commandOf());

    expect(closingInputsOf(harness)).toEqual([
      {
        caseId: CASE_ID,
        to: 'rejected',
        resolution: null,
        reason: REASON,
        posterNotice: 'pending',
        at: AT,
      },
    ]);
    expect(harness.closings[0]?.audit).toBe(harness.preparedEntries[0]);
  });

  test('対象への参照を消した案件では投稿者への通知を送らなかった記録にする', async () => {
    const harness = setupWorkflow({ caseRecord: detachedCaseOf() });

    await harness.workflow.reject(commandOf());

    expect(harness.closings[0]?.posterNotice).toBe('skipped');
  });
});

describe('DefaultReportCaseWorkflow の措置なしの対応済・却下の確定と通知', () => {
  test.each(OPERATIONS)(
    '%sは確定の後に当事者への通知を依頼する',
    async (operation) => {
      const harness = setupWorkflow();

      await run(harness, operation);

      expect(harness.calls).toEqual(['find', 'prepare', 'close', 'dispatch']);
      expect(harness.dispatched).toEqual([CASE_ID]);
    },
  );

  test.each([
    ['resolveWithoutMeasure', 'conflict', STATE_CONFLICT],
    ['resolveWithoutMeasure', 'not-found', CASE_NOT_FOUND],
    ['reject', 'conflict', STATE_CONFLICT],
    ['reject', 'not-found', CASE_NOT_FOUND],
  ] as const)(
    '%sは書き込みの単位の結果%sを想定内の失敗に変え、通知を依頼しない',
    async (operation, closeResult, expected) => {
      const harness = setupWorkflow({ closeResult });

      const error = await appErrorOf(run(harness, operation));

      expect(summaryOf(error)).toEqual(expected);
      expect(harness.dispatched).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    '%sは書き込みの単位の想定外の例外をそのまま投げ、通知を依頼しない',
    async (operation) => {
      const writeError = new Error('D1_ERROR: 想定外');
      const harness = setupWorkflow({ writeError });

      expect(await rejectionOf(run(harness, operation))).toBe(writeError);
      expect(harness.dispatched).toEqual([]);
    },
  );

  test.each([
    ['resolveWithoutMeasure', 'resolved'],
    ['reject', 'rejected'],
  ] as const)(
    '%sは通知の依頼の例外を警告のログで握り、完了した状態(%s)を返す',
    async (operation, status) => {
      const dispatchError = new Error('メールの送信を依頼できませんでした');
      const harness = setupWorkflow({ dispatchError });

      const result = await run(harness, operation);

      expect(result).toEqual({ status });
      expect(logs.records()).toEqual([
        {
          level: 'info',
          properties: { caseId: CASE_ID, operatorAdminId: ADMIN_ID, status },
        },
        {
          level: 'warning',
          properties: { caseId: CASE_ID, error: dispatchError },
        },
      ]);
    },
  );

  test.each([
    ['resolveWithoutMeasure', 'resolved'],
    ['reject', 'rejected'],
  ] as const)(
    '%sのログには識別子と完了の状態(%s)だけを出し、理由を出さない',
    async (operation, status) => {
      const harness = setupWorkflow();

      await run(harness, operation);

      expect(logs.records()).toEqual([
        {
          level: 'info',
          properties: { caseId: CASE_ID, operatorAdminId: ADMIN_ID, status },
        },
      ]);
      expect(JSON.stringify(logs.records())).not.toContain(REASON);
    },
  );
});
