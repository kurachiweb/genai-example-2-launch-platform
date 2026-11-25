import { describe, expect, test } from 'bun:test';

import type { ReportCaseStatus } from '../../../common-lib/reporting/report-case-rules.ts';
import {
  computeResponseTime,
  DECISION_TARGET_MS,
  inquiryDeadline,
  isInquiryOverdue,
  START_TARGET_MS,
} from './response-time.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const STARTED_AT = new Date('2026-11-02T03:00:00.000Z');

function after(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

describe('目標の期間', () => {
  test('確認開始の目標は24時間で、判断の目標は9日である', () => {
    expect(START_TARGET_MS).toBe(24 * HOUR_MS);
    expect(DECISION_TARGET_MS).toBe(9 * DAY_MS);
  });
});

describe('computeResponseTimeの確認開始の目標', () => {
  test('未対応で起点からちょうど24時間なら超過にならない', () => {
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'open',
      completedAt: undefined,
      now: after(STARTED_AT, START_TARGET_MS),
    });

    expect(result.alerts).toEqual([]);
    expect(result.elapsedMs).toBe(START_TARGET_MS);
  });

  test('未対応で起点から24時間を1ミリ秒でも超えれば確認開始の超過になる', () => {
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'open',
      completedAt: undefined,
      now: after(STARTED_AT, START_TARGET_MS + 1),
    });

    expect(result.alerts).toEqual(['start-overdue']);
  });

  test('金曜日の夜の起点から土曜日の夜までの24時間を超えれば、土日をまたいでも超過になる', () => {
    const fridayNight = new Date('2026-11-06T13:00:00.000Z');

    const justBefore = computeResponseTime({
      startedAt: fridayNight,
      status: 'open',
      completedAt: undefined,
      now: new Date('2026-11-07T13:00:00.000Z'),
    });
    const justAfter = computeResponseTime({
      startedAt: fridayNight,
      status: 'open',
      completedAt: undefined,
      now: new Date('2026-11-07T13:00:00.001Z'),
    });

    expect(justBefore.alerts).toEqual([]);
    expect(justAfter.alerts).toEqual(['start-overdue']);
  });

  test.each<ReportCaseStatus>(['in_progress', 'resolved', 'rejected'])(
    '状態が%sなら24時間を超えても確認開始の超過にならない',
    (status) => {
      const now = after(STARTED_AT, 2 * DAY_MS);
      const result = computeResponseTime({
        startedAt: STARTED_AT,
        status,
        completedAt: status === 'in_progress' ? undefined : now,
        now,
      });

      expect(result.alerts).not.toContain('start-overdue');
    },
  );
});

describe('computeResponseTimeの判断の目標(未完了)', () => {
  test('対応中で起点からちょうど9日なら超過にならず、経過は現在までになる', () => {
    const now = after(STARTED_AT, DECISION_TARGET_MS);
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'in_progress',
      completedAt: undefined,
      now,
    });

    expect(result).toEqual({
      startedAt: STARTED_AT,
      completedAt: null,
      elapsedMs: DECISION_TARGET_MS,
      alerts: [],
    });
  });

  test('対応中で起点から9日を超えれば判断の超過になる', () => {
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'in_progress',
      completedAt: undefined,
      now: after(STARTED_AT, DECISION_TARGET_MS + 1),
    });

    expect(result.alerts).toEqual(['decision-overdue']);
  });

  test('未対応で起点から9日を超えれば確認開始と判断の両方の超過になる', () => {
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'open',
      completedAt: undefined,
      now: after(STARTED_AT, DECISION_TARGET_MS + 1),
    });

    expect(result.alerts).toEqual(['start-overdue', 'decision-overdue']);
  });
});

describe('computeResponseTimeの判断の目標(完了)', () => {
  test.each<ReportCaseStatus>(['resolved', 'rejected'])(
    '%sで起点からちょうど9日で完了していれば超過にならず、経過は完了までになる',
    (status) => {
      const completedAt = after(STARTED_AT, DECISION_TARGET_MS);
      const result = computeResponseTime({
        startedAt: STARTED_AT,
        status,
        completedAt,
        now: after(STARTED_AT, 30 * DAY_MS),
      });

      expect(result).toEqual({
        startedAt: STARTED_AT,
        completedAt,
        elapsedMs: DECISION_TARGET_MS,
        alerts: [],
      });
    },
  );

  test.each<ReportCaseStatus>(['resolved', 'rejected'])(
    '%sで起点から9日を超えて完了していれば判断の超過になる',
    (status) => {
      const completedAt = after(STARTED_AT, DECISION_TARGET_MS + 1);
      const result = computeResponseTime({
        startedAt: STARTED_AT,
        status,
        completedAt,
        now: after(STARTED_AT, DECISION_TARGET_MS + 1),
      });

      expect(result.alerts).toEqual(['decision-overdue']);
      expect(result.elapsedMs).toBe(DECISION_TARGET_MS + 1);
    },
  );

  test('9日以内に完了していれば、現在が9日を過ぎていても超過にならない', () => {
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'resolved',
      completedAt: after(STARTED_AT, 2 * DAY_MS),
      now: after(STARTED_AT, 20 * DAY_MS),
    });

    expect(result.alerts).toEqual([]);
    expect(result.elapsedMs).toBe(2 * DAY_MS);
  });
});

describe('computeResponseTimeの完了から戻した案件', () => {
  test('完了の日時が渡されても未完了の状態なら現在までの経過を数え、起点を変えない', () => {
    const now = after(STARTED_AT, DECISION_TARGET_MS + HOUR_MS);
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'in_progress',
      completedAt: after(STARTED_AT, DAY_MS),
      now,
    });

    expect(result).toEqual({
      startedAt: STARTED_AT,
      completedAt: null,
      elapsedMs: DECISION_TARGET_MS + HOUR_MS,
      alerts: ['decision-overdue'],
    });
  });

  test('未対応へ戻した案件は24時間を超えていれば確認開始の超過になる', () => {
    const result = computeResponseTime({
      startedAt: STARTED_AT,
      status: 'open',
      completedAt: after(STARTED_AT, HOUR_MS),
      now: after(STARTED_AT, 2 * DAY_MS),
    });

    expect(result.completedAt).toBeNull();
    expect(result.elapsedMs).toBe(2 * DAY_MS);
    expect(result.alerts).toEqual(['start-overdue']);
  });
});

describe('computeResponseTimeの完了の日時が無い完了した案件', () => {
  test.each<ReportCaseStatus>(['resolved', 'rejected'])(
    '%sで完了の日時が得られなければ経過は不明になり、超過を示さない',
    (status) => {
      const result = computeResponseTime({
        startedAt: STARTED_AT,
        status,
        completedAt: undefined,
        now: after(STARTED_AT, 400 * DAY_MS),
      });

      expect(result).toEqual({
        startedAt: STARTED_AT,
        completedAt: null,
        elapsedMs: null,
        alerts: [],
      });
    },
  );
});

describe('照会の期限', () => {
  const sentAt = new Date('2026-11-05T22:30:00.000Z');

  test('期限は送信から7×24時間の後になる', () => {
    expect(inquiryDeadline(sentAt)).toEqual(
      new Date('2026-11-12T22:30:00.000Z'),
    );
  });

  test('期限ちょうどまでは超過にならない', () => {
    expect(isInquiryOverdue(sentAt, sentAt)).toBe(false);
    expect(isInquiryOverdue(sentAt, new Date('2026-11-12T22:30:00.000Z'))).toBe(
      false,
    );
  });

  test('期限を1ミリ秒でも過ぎれば超過になる', () => {
    expect(isInquiryOverdue(sentAt, new Date('2026-11-12T22:30:00.001Z'))).toBe(
      true,
    );
  });
});
