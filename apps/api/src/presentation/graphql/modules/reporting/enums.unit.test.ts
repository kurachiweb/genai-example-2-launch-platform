import { describe, expect, test } from 'bun:test';

import { RESPONSE_TIME_ALERT_LABELS } from '../../../../../common-lib/reporting/report-labels.ts';
import {
  REPORT_CASE_STATUSES as CASE_STATUSES,
  REPORT_RESOLUTIONS as RESOLUTIONS,
} from '../../../../../common-lib/reporting/report-case-rules.ts';
import { REPORT_TARGET_KINDS as TARGET_KINDS } from '../../../../../common-lib/reporting/report-rules.ts';
import {
  graphqlReportCaseStatusOf,
  graphqlReportResolutionOf,
  graphqlReportTargetKindOf,
  graphqlResponseTimeAlertOf,
  REPORT_CASE_STATUSES,
  REPORT_TARGET_KINDS,
} from './enums.ts';

describe('通報のGraphQLの列挙型とユースケースの値の写し', () => {
  test('対象の種類と対応ステータスの入力の表は、GraphQLの値からユースケースの値へ1対1に写す', () => {
    expect(REPORT_TARGET_KINDS).toEqual({
      USER: 'user',
      PRODUCT: 'product',
      COMMENT: 'comment',
    });
    expect(REPORT_CASE_STATUSES).toEqual({
      OPEN: 'open',
      IN_PROGRESS: 'in_progress',
      RESOLVED: 'resolved',
      REJECTED: 'rejected',
    });
  });

  test.each(TARGET_KINDS.map((kind) => [kind] as const))(
    '対象の種類%sをGraphQLの値に写し、入力の表で元に戻る',
    (kind) => {
      expect(REPORT_TARGET_KINDS[graphqlReportTargetKindOf(kind)]).toBe(kind);
    },
  );

  test.each(CASE_STATUSES.map((status) => [status] as const))(
    '対応ステータス%sをGraphQLの値に写し、入力の表で元に戻る',
    (status) => {
      expect(REPORT_CASE_STATUSES[graphqlReportCaseStatusOf(status)]).toBe(
        status,
      );
    },
  );

  test('措置をGraphQLの値に写す', () => {
    expect(RESOLUTIONS.map(graphqlReportResolutionOf)).toEqual([
      'PRODUCT_HIDE',
      'COMMENT_HIDE',
      'USER_SUSPEND',
      'NONE',
    ]);
  });

  test('対応期間の目標の超過をGraphQLの値に写す', () => {
    expect(
      Object.keys(RESPONSE_TIME_ALERT_LABELS).map((alert) =>
        graphqlResponseTimeAlertOf(
          alert as keyof typeof RESPONSE_TIME_ALERT_LABELS,
        ),
      ),
    ).toEqual(['START_OVERDUE', 'DECISION_OVERDUE']);
  });

  test('表は実行時に書き換えられない', () => {
    expect(Object.isFrozen(REPORT_TARGET_KINDS)).toBe(true);
    expect(Object.isFrozen(REPORT_CASE_STATUSES)).toBe(true);
  });
});
