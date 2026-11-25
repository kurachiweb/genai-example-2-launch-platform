import { describe, expect, test } from 'bun:test';

import { REPORTING_TYPES } from './reporting-types.ts';

const PORT_NAMES = [
  'ReportSubmissionStore',
  'ReportCaseStore',
  'ReportNoticeCaseReader',
  'ReportCaseWriter',
  'ReportCategoryStore',
  'ReportNoticeStore',
  'ReportSubmissionRateLimit',
  'ReportIncidentReporter',
] as const;

const USE_CASE_NAMES = [
  'ReportTargetResolver',
  'ReportSubmissionService',
  'ReportCaseReader',
  'ReportCaseWorkflow',
  'InfringementInquiryService',
  'ReportNotifier',
  'ReportCategoryService',
] as const;

const JOB_NAMES = ['ReportNoticeRedispatchJob', 'ReportRetentionJob'] as const;

const LIFECYCLE_HANDLER_NAMES = ['ReporterWithdrawalSyncHandler'] as const;

const INFRASTRUCTURE_NAMES = [
  'ReportCaseStatements',
  'ReportCaseClosingParticipant',
] as const;

const EXPECTED_NAMES = [
  ...PORT_NAMES,
  ...USE_CASE_NAMES,
  ...JOB_NAMES,
  ...LIFECYCLE_HANDLER_NAMES,
  ...INFRASTRUCTURE_NAMES,
] as const;

// 両アプリ共通の削除のストアとエクスポート(REPORTING_PLATFORM_TYPES)と、eventの物理削除の処理(EVENT_REPORTING_TYPES)のメンバー
const OTHER_REPORTING_MEMBER_NAMES = [
  'ReportErasureStore',
  'ReportErasureStatements',
  'ReportExport',
  'UserReportErasureHandler',
  'ProductReportErasureHandler',
] as const;

describe('REPORTING_TYPES', () => {
  test('apiのストアと書き込みの単位と回数制限と定型の通知のポート・ユースケース・ジョブ・退会の同期の処理・文の組み立て・措置の書き込みの参加者の識別子だけを持つ', () => {
    expect(Object.keys(REPORTING_TYPES).toSorted()).toStrictEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のreporting.api.<名前>である',
    (name) => {
      expect<symbol>(REPORTING_TYPES[name]).toBe(
        Symbol.for(`reporting.api.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(REPORTING_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('共有部品とイベントサーバーの通報の識別子とメンバーの名前を重ねない', () => {
    expect(
      Object.keys(REPORTING_TYPES).filter((name) =>
        (OTHER_REPORTING_MEMBER_NAMES as readonly string[]).includes(name),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(REPORTING_TYPES)).toBe(true);
  });
});
