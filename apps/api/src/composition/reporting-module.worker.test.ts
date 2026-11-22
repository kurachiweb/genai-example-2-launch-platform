import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../../lib/core/scheduling/run-budget.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { D1ModerationRecordStore } from '../../lib/workers/moderation/d1-moderation-record-store.ts';
import { newRecordOf } from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import { DefaultInfringementInquiryService } from '../application/reporting/infringement-inquiry-service.ts';
import {
  REPORT_NOTICE_REDISPATCH_JOB_DEFINITION,
  ReportNoticeRedispatchJob,
} from '../application/reporting/jobs/report-notice-redispatch-job.ts';
import {
  REPORT_RETENTION_JOB_DEFINITION,
  ReportRetentionJob,
} from '../application/reporting/jobs/report-retention-job.ts';
import { DefaultReportCaseReader } from '../application/reporting/report-case-reader.ts';
import { DefaultReportCaseWorkflow } from '../application/reporting/report-case-workflow.ts';
import { toReportCaseClosingParticipation } from '../application/reporting/report-case-closing-participation.ts';
import { DefaultReportCategoryService } from '../application/reporting/report-category-service.ts';
import { EmailReportNotifier } from '../application/reporting/report-notifier.ts';
import { DefaultReportSubmissionService } from '../application/reporting/report-submission-service.ts';
import { DirectoryReportTargetResolver } from '../application/reporting/report-target-resolver.ts';
import { REPORTING_TYPES } from '../application/reporting/reporting-types.ts';
import type { ModerationWriteParticipants } from '../infrastructure/moderation/moderation-write-participant.ts';
import { CounterReportSubmissionRateLimit } from '../infrastructure/reporting/counter-report-submission-rate-limit.ts';
import { D1ReportCaseStatements } from '../infrastructure/reporting/d1-report-case-statements.ts';
import { D1ReportCaseStore } from '../infrastructure/reporting/d1-report-case-store.ts';
import { D1ReportCaseWriter } from '../infrastructure/reporting/d1-report-case-writer.ts';
import { D1ReportCategoryStore } from '../infrastructure/reporting/d1-report-category-store.ts';
import { D1ReportNoticeStore } from '../infrastructure/reporting/d1-report-notice-store.ts';
import { D1ReportSubmissionStore } from '../infrastructure/reporting/d1-report-submission-store.ts';
import { ReportCaseClosingParticipant } from '../infrastructure/reporting/report-case-closing-participant.ts';
import { ReporterWithdrawalSyncHandler } from '../infrastructure/reporting/reporter-withdrawal-sync-handler.ts';
import { SentryReportIncidentReporter } from '../infrastructure/reporting/sentry-report-incident-reporter.ts';
import {
  AT,
  clearReportCaseWrites,
  db,
  measureClosingOf,
  openCaseOf,
  productIdOf,
  readCase,
  seed,
} from '../infrastructure/reporting/testing/report-case-write-fixtures.ts';
import { MODERATION_MODULE } from './moderation-module.ts';
import { MODERATION_WRITE_PARTICIPANTS } from './moderation-write-participants.ts';
import { MODULES } from './modules.ts';
import { REPORTING_MODULE } from './reporting-module.ts';
import { SCHEDULED_JOBS, SCHEDULED_RUN_BUDGETS } from './scheduled-jobs.ts';

const INVOCATION_KINDS = ['fetch', 'scheduled'] as const;

const IMPLEMENTATIONS = [
  ['ReportSubmissionStore', D1ReportSubmissionStore],
  ['ReportCaseStore', D1ReportCaseStore],
  ['ReportNoticeCaseReader', D1ReportCaseStore],
  ['ReportCategoryStore', D1ReportCategoryStore],
  ['ReportCaseStatements', D1ReportCaseStatements],
  ['ReportCaseWriter', D1ReportCaseWriter],
  ['ReportCaseClosingParticipant', ReportCaseClosingParticipant],
  ['ReportNoticeStore', D1ReportNoticeStore],
  ['ReporterWithdrawalSyncHandler', ReporterWithdrawalSyncHandler],
  ['ReportSubmissionRateLimit', CounterReportSubmissionRateLimit],
  ['ReportIncidentReporter', SentryReportIncidentReporter],
  ['ReportTargetResolver', DirectoryReportTargetResolver],
  ['ReportSubmissionService', DefaultReportSubmissionService],
  ['ReportCaseReader', DefaultReportCaseReader],
  ['ReportCaseWorkflow', DefaultReportCaseWorkflow],
  ['InfringementInquiryService', DefaultInfringementInquiryService],
  ['ReportNotifier', EmailReportNotifier],
  ['ReportCategoryService', DefaultReportCategoryService],
  ['ReportNoticeRedispatchJob', ReportNoticeRedispatchJob],
  ['ReportRetentionJob', ReportRetentionJob],
] as const;

const DAILY_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

const MODERATION_RECORD_ID = '01JF0MACT00000000000000007';

function createContainer(
  kind: (typeof INVOCATION_KINDS)[number] = 'fetch',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

beforeEach(async () => {
  await clearReportCaseWrites();
});

describe('APIサーバーのモジュールの一覧への通報の束縛の登録', () => {
  test('apiの通報のモジュールを、措置のモジュールの後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(REPORTING_MODULE.name).toBe('reporting');
    expect(names.filter((name) => name === 'reporting')).toHaveLength(1);
    expect(MODULES.indexOf(REPORTING_MODULE)).toBeGreaterThan(
      MODULES.indexOf(MODERATION_MODULE),
    );
  });

  test('解決を確かめる識別子は、REPORTING_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(REPORTING_TYPES).toSorted(),
    );
  });

  test('措置の書き込みの参加者の登録口に、案件の完了の参加者を1つ登録する', () => {
    expect(
      MODERATION_WRITE_PARTICIPANTS.filter(
        ({ kind, participant }) =>
          kind === 'content-reporting.report-case-closing' ||
          participant === REPORTING_TYPES.ReportCaseClosingParticipant,
      ),
    ).toStrictEqual([
      {
        kind: 'content-reporting.report-case-closing',
        participant: REPORTING_TYPES.ReportCaseClosingParticipant,
      },
    ]);
  });
});

describe('定期実行の一覧への通報のジョブの登録', () => {
  test('通知の送り直しと保持期間の削除のジョブの定義を、そのまま定期実行の一覧に1つずつ載せる', () => {
    expect(
      SCHEDULED_JOBS.filter(({ name }) =>
        name.startsWith('content-reporting.'),
      ),
    ).toStrictEqual([
      REPORT_NOTICE_REDISPATCH_JOB_DEFINITION,
      REPORT_RETENTION_JOB_DEFINITION,
    ]);
    expect(REPORT_NOTICE_REDISPATCH_JOB_DEFINITION).toStrictEqual({
      name: 'content-reporting.notice-redispatch',
      at: { hour: 4, minute: 21 },
      order: 2000,
      handler: REPORTING_TYPES.ReportNoticeRedispatchJob,
    });
    expect(REPORT_RETENTION_JOB_DEFINITION).toStrictEqual({
      name: 'content-reporting.report-retention',
      at: { hour: 4, minute: 21 },
      order: 2010,
      handler: REPORTING_TYPES.ReportRetentionJob,
    });
  });

  test('4:21の起動(21 12 * * *)では、他の機能のジョブとorderが重ならず、UGC管理の保守(1910)の後・キーワードの再抽出(2300)の前に送り直し(2000)・保持期間の削除(2010)の順で動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(DAILY_CRON)
      .map(({ name, order }) => ({ name, order }));
    const index = jobs.findIndex(
      ({ name }) => name === 'content-reporting.notice-redispatch',
    );

    expect(DAILY_CRON).toBe('21 12 * * *');
    expect(new Set(jobs.map(({ order }) => order)).size).toBe(jobs.length);
    expect(jobs.slice(index - 1, index + 3)).toEqual([
      { name: 'ugc-moderation.maintenance', order: 1910 },
      { name: 'content-reporting.notice-redispatch', order: 2000 },
      { name: 'content-reporting.report-retention', order: 2010 },
      { name: 'content-processing.keyword-reextraction', order: 2300 },
    ]);
  });

  test('4:21の起動の合計の所要時間の予算(300秒)の表を変えず、他の機能のジョブと共有する', () => {
    expect(
      createRunBudgetTable(SCHEDULED_RUN_BUDGETS).budgetFor(DAILY_CRON)
        ?.maxTotalDurationMs,
    ).toBe(300_000);
    expect(
      SCHEDULED_RUN_BUDGETS.filter(
        ({ at }) => at.hour === 4 && at.minute === 21,
      ),
    ).toStrictEqual([
      { at: { hour: 4, minute: 21 }, maxTotalDurationMs: 300_000 },
    ]);
  });
});

describe.each(INVOCATION_KINDS)(
  'APIサーバーの通報のストア・ユースケース・ジョブと同期の処理の束縛(%s)',
  (kind) => {
    test.each(IMPLEMENTATIONS)(
      '処理単位のコンテナから%sを実装に解決する',
      (name, implementation) => {
        expect(
          createContainer(kind).get<unknown>(REPORTING_TYPES[name]),
        ).toBeInstanceOf(implementation);
      },
    );
  },
);

describe('措置の書き込みの参加者の解決', () => {
  test('措置の参加の部品が案件の完了の参加者を解決し、措置の記録と同じ一括の書き込みで案件を措置による対応済にして措置の記録のIDを残す', async () => {
    await seed([openCaseOf(1)]);
    const participants = createContainer().get<ModerationWriteParticipants>(
      MODERATION_TYPES.ModerationWriteParticipants,
    );

    const statements = await participants.statementsFor(
      toReportCaseClosingParticipation(measureClosingOf(1)),
      {
        actionId: MODERATION_RECORD_ID,
        action: 'product.hide',
        targetId: productIdOf(1),
        occurredAt: AT,
      },
    );
    await db.batch([
      new D1ModerationRecordStore(db).insertStatement(
        newRecordOf(1, {
          id: MODERATION_RECORD_ID,
          action: 'product.hide',
          targetId: productIdOf(1),
          productId: productIdOf(1),
          occurredAt: AT,
        }),
      ),
      ...statements,
    ]);

    await expect(readCase(1)).resolves.toMatchObject({
      status: 'resolved',
      closedAt: AT,
      resolution: 'product.hide',
      resolutionActionId: MODERATION_RECORD_ID,
    });
  });
});
