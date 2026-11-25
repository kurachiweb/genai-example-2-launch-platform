import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { moderationError } from '../moderation/moderation-errors.ts';
import type { ReportCaseClosingCommand } from './ports.ts';
import {
  readReportCaseClosingPayload,
  REPORT_CASE_CLOSING_PARTICIPATION,
} from './report-case-closing-participation.ts';
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
  MEASURE_ALREADY_APPLIED,
  OWNER_ID,
  openCaseOf,
  PRODUCT_ID,
  REASON,
  reasonRejected,
  rejectionOf,
  setupWorkflow,
  STATE_CONFLICT,
  summaryOf,
  TARGET_UNAVAILABLE,
} from './testing/report-case-workflow-harness.ts';

const COMMENT_ID = '01JQ0CMT000000000000000001';

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

const TARGETS = [
  ['product', PRODUCT_ID, 'product.hide'],
  ['comment', COMMENT_ID, 'comment.hide'],
  ['user', OWNER_ID, 'user.suspend'],
] as const;

describe('DefaultReportCaseWorkflow.resolveWithMeasure の検証', () => {
  test('理由が空なら案件を読まずに拒否する', async () => {
    const harness = setupWorkflow();

    const error = await appErrorOf(
      harness.workflow.resolveWithMeasure(commandOf(' ')),
    );

    expect(summaryOf(error)).toEqual(reasonRejected('required'));
    expect(harness.calls).toEqual([]);
  });

  test('500書記素を超える理由を拒否し、500書記素は受け付ける', async () => {
    const tooLong = setupWorkflow();
    const error = await appErrorOf(
      tooLong.workflow.resolveWithMeasure(commandOf('あ'.repeat(501))),
    );
    expect(summaryOf(error)).toEqual(reasonRejected('too-long'));
    expect(tooLong.calls).toEqual([]);

    const atLimit = setupWorkflow();
    await atLimit.workflow.resolveWithMeasure(commandOf('あ'.repeat(500)));
    expect(atLimit.measures).toHaveLength(1);
  });

  test('案件が無ければreport_case_not_foundを返し、上流を呼ばない', async () => {
    const harness = setupWorkflow({ caseRecord: undefined });

    const error = await appErrorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(summaryOf(error)).toEqual(CASE_NOT_FOUND);
    expect(harness.calls).toEqual(['find']);
  });

  test.each([['resolved'], ['rejected']] as const)(
    '完了(%s)した案件を拒否し、監査ログを準備せず上流を呼ばない',
    async (status) => {
      const harness = setupWorkflow({ caseRecord: closedCaseOf(status) });

      const error = await appErrorOf(
        harness.workflow.resolveWithMeasure(commandOf()),
      );

      expect(summaryOf(error)).toEqual(CASE_CLOSED);
      expect(harness.calls).toEqual(['find']);
    },
  );

  test('対象への参照を消した案件では上流を呼ばずに対象の不在を返す', async () => {
    const harness = setupWorkflow({ caseRecord: detachedCaseOf() });

    const error = await appErrorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(summaryOf(error)).toEqual(TARGET_UNAVAILABLE);
    expect(harness.calls).toEqual(['find']);
    expect(harness.measures).toEqual([]);
  });
});

describe('DefaultReportCaseWorkflow.resolveWithMeasure の上流の呼び出し', () => {
  test.each(TARGETS)(
    '対象が%sなら%sではなく対象の種類の措置(%s)のユースケースを1回呼ぶ',
    async (kind, targetId, measure) => {
      const harness = setupWorkflow({
        caseRecord: openCaseOf({ targetKind: kind, targetId }),
      });

      await harness.workflow.resolveWithMeasure(commandOf());

      expect(harness.measures.map((call) => call.measure)).toEqual([measure]);
      expect(harness.measures[0]?.command.targetId).toBe(targetId);
    },
  );

  test.each([['open'], ['in_progress']] as const)(
    '%sの案件の監査ログに措置・操作の印・変更前の状態を記録する',
    async (status) => {
      const harness = setupWorkflow({
        caseRecord: openCaseOf({
          status,
          targetKind: 'comment',
          targetId: COMMENT_ID,
        }),
      });

      await harness.workflow.resolveWithMeasure(commandOf(`  ${REASON}  `));

      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'report.resolve',
          targetIds: [CASE_ID],
          reason: REASON,
          detail: {
            resolution: 'comment.hide',
            mode: 'operation',
            fromStatus: status,
          },
          occurredAt: AT,
        },
      ]);
    },
  );

  test('上流へ対象・正規化した理由・操作者・日時と、種類と完了の値だけの参加を渡す', async () => {
    const harness = setupWorkflow();

    await harness.workflow.resolveWithMeasure(commandOf(`\n${REASON} `));

    const command = harness.measures[0]?.command;
    expect(command).toEqual({
      targetId: PRODUCT_ID,
      reason: REASON,
      operator: { adminId: ADMIN_ID },
      at: AT,
      participation: {
        kind: REPORT_CASE_CLOSING_PARTICIPATION,
        payload: {
          caseId: CASE_ID,
          to: 'resolved',
          resolution: 'product.hide',
          reason: REASON,
          posterNotice: 'none',
          at: AT,
          audit: harness.preparedEntries[0],
        },
      },
    });
    expect((command?.participation?.payload as { audit: unknown }).audit).toBe(
      harness.preparedEntries[0],
    );
    expect(
      readReportCaseClosingPayload(
        command?.participation ?? { kind: '', payload: null },
      ),
    ).toBeDefined();
  });

  test('成功の後は書き込みの単位を使わず、追加の書き込みをせずに通知を依頼して対応済を返す', async () => {
    const harness = setupWorkflow();

    const result = await harness.workflow.resolveWithMeasure(commandOf());

    expect(result).toEqual({ status: 'resolved' });
    expect(harness.calls).toEqual([
      'find',
      'prepare',
      'product.hide',
      'dispatch',
    ]);
    expect(harness.closings).toEqual([]);
    expect(harness.statusChanges).toEqual([]);
    expect(harness.dispatched).toEqual([CASE_ID]);
  });

  test('通知の依頼の例外を警告のログで握り、対応済を返す。ログには識別子だけを出す', async () => {
    const dispatchError = new Error('メールの送信を依頼できませんでした');
    const harness = setupWorkflow({ dispatchError });

    const result = await harness.workflow.resolveWithMeasure(commandOf());

    expect(result).toEqual({ status: 'resolved' });
    expect(logs.records()).toEqual([
      {
        level: 'info',
        properties: {
          caseId: CASE_ID,
          operatorAdminId: ADMIN_ID,
          status: 'resolved',
        },
      },
      {
        level: 'warning',
        properties: { caseId: CASE_ID, error: dispatchError },
      },
    ]);
    expect(JSON.stringify(logs.records())).not.toContain(REASON);
  });
});

describe('DefaultReportCaseWorkflow.resolveWithMeasure の上流の結果の振り分け', () => {
  test('上流が変化なし(措置済み)を返したらreport_measure_already_appliedを返し、通知しない', async () => {
    const harness = setupWorkflow({
      measureOutcome: { changed: false, actionId: null },
    });

    const error = await appErrorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(summaryOf(error)).toEqual(MEASURE_ALREADY_APPLIED);
    expect(harness.calls).toEqual(['find', 'prepare', 'product.hide']);
  });

  test('状態は変わったが措置の記録のIDが無ければ、案件の完了も確定していないため想定外の失敗にし、通知しない', async () => {
    const harness = setupWorkflow({
      measureOutcome: { changed: true, actionId: null },
    });

    const error = await rejectionOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
    expect(harness.dispatched).toEqual([]);
    expect(logs.records()).toEqual([
      { level: 'error', properties: { caseId: CASE_ID } },
    ]);
  });

  test.each([
    ['product', PRODUCT_ID, 'product_not_found'],
    ['comment', COMMENT_ID, 'comment_not_found'],
    ['user', OWNER_ID, 'user_not_found'],
  ] as const)(
    '対象が%sの上流の不在(%s)をreport_target_unavailableに変え、案件を読み直さない',
    async (kind, targetId, code) => {
      const harness = setupWorkflow({
        caseRecord: openCaseOf({ targetKind: kind, targetId }),
        measureError: moderationError(code),
      });

      const error = await appErrorOf(
        harness.workflow.resolveWithMeasure(commandOf()),
      );

      expect(summaryOf(error)).toEqual(TARGET_UNAVAILABLE);
      expect(harness.found).toEqual([CASE_ID]);
      expect(harness.dispatched).toEqual([]);
    },
  );

  test('上流の確定の失敗の後に案件が無ければreport_case_not_foundを返す', async () => {
    const harness = setupWorkflow({
      measureError: new Error('D1_ERROR: NOT NULL constraint failed'),
      reloadedCase: undefined,
    });

    const error = await appErrorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(summaryOf(error)).toEqual(CASE_NOT_FOUND);
    expect(harness.found).toEqual([CASE_ID, CASE_ID]);
    expect(harness.dispatched).toEqual([]);
  });

  test.each([['resolved'], ['rejected']] as const)(
    '上流の確定の失敗の後に案件が完了(%s)していれば競合を返す',
    async (status) => {
      const harness = setupWorkflow({
        measureError: new Error('D1_ERROR: NOT NULL constraint failed'),
        reloadedCase: closedCaseOf(status),
      });

      const error = await appErrorOf(
        harness.workflow.resolveWithMeasure(commandOf()),
      );

      expect(summaryOf(error)).toEqual(STATE_CONFLICT);
      expect(harness.dispatched).toEqual([]);
    },
  );

  test.each([
    ['D1のエラー', new Error('D1_ERROR: 想定外')],
    ['上流の競合', moderationError('account_state_conflict')],
  ] as const)(
    '上流の確定の失敗(%s)の後に案件が未完了のままなら上流のエラーをそのまま投げる',
    async (_label, measureError) => {
      const harness = setupWorkflow({
        caseRecord: openCaseOf({ targetKind: 'user', targetId: OWNER_ID }),
        measureError,
      });

      const error = await rejectionOf(
        harness.workflow.resolveWithMeasure(commandOf()),
      );

      expect(error).toBe(measureError);
      expect(harness.found).toEqual([CASE_ID, CASE_ID]);
      expect(harness.dispatched).toEqual([]);
    },
  );

  test('上流の確定の失敗の後の読み直しも失敗したら上流のエラーを投げる', async () => {
    const measureError = new Error('D1_ERROR: 想定外');
    const harness = setupWorkflow({
      measureError,
      reloadError: new Error('D1_ERROR: 読み直しの失敗'),
    });

    const error = await rejectionOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(error).toBe(measureError);
    expect(harness.dispatched).toEqual([]);
  });
});
