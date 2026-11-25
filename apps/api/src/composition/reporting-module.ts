import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { DefaultInfringementInquiryService } from '../application/reporting/infringement-inquiry-service.ts';
import { ReportNoticeRedispatchJob } from '../application/reporting/jobs/report-notice-redispatch-job.ts';
import { ReportRetentionJob } from '../application/reporting/jobs/report-retention-job.ts';
import type {
  InfringementInquiryService,
  ReportCaseReader,
  ReportCaseStore,
  ReportCaseWorkflow,
  ReportCaseWriter,
  ReportCategoryService,
  ReportCategoryStore,
  ReportIncidentReporter,
  ReportNoticeCaseReader,
  ReportNoticeStore,
  ReportNotifier,
  ReportSubmissionRateLimit,
  ReportSubmissionService,
  ReportSubmissionStore,
  ReportTargetResolver,
} from '../application/reporting/ports.ts';
import { DefaultReportCaseReader } from '../application/reporting/report-case-reader.ts';
import { DefaultReportCaseWorkflow } from '../application/reporting/report-case-workflow.ts';
import { DefaultReportCategoryService } from '../application/reporting/report-category-service.ts';
import { EmailReportNotifier } from '../application/reporting/report-notifier.ts';
import { DefaultReportSubmissionService } from '../application/reporting/report-submission-service.ts';
import { DirectoryReportTargetResolver } from '../application/reporting/report-target-resolver.ts';
import { REPORTING_TYPES } from '../application/reporting/reporting-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import type { ModerationWriteParticipant } from '../infrastructure/moderation/moderation-write-participant.ts';
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

// 退会の論理削除の文と保持期間の削除のストア(REPORTING_PLATFORM_MODULE)、措置のユースケース(MODERATION_MODULE)、監査ログ・利用者・プロダクト・コメントの照会とメールの送信は他のモジュールの束縛を使う
export const REPORTING_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'reporting',
  bindings: new ContainerModule(({ bind }) => {
    bind<ReportSubmissionStore>(REPORTING_TYPES.ReportSubmissionStore).to(
      D1ReportSubmissionStore,
    );
    bind<ReportCaseStore>(REPORTING_TYPES.ReportCaseStore).to(
      D1ReportCaseStore,
    );
    bind<ReportNoticeCaseReader>(REPORTING_TYPES.ReportNoticeCaseReader).to(
      D1ReportCaseStore,
    );
    bind<ReportCategoryStore>(REPORTING_TYPES.ReportCategoryStore).to(
      D1ReportCategoryStore,
    );
    bind<D1ReportCaseStatements>(REPORTING_TYPES.ReportCaseStatements).to(
      D1ReportCaseStatements,
    );
    bind<ReportCaseWriter>(REPORTING_TYPES.ReportCaseWriter).to(
      D1ReportCaseWriter,
    );
    bind<ModerationWriteParticipant>(
      REPORTING_TYPES.ReportCaseClosingParticipant,
    ).to(ReportCaseClosingParticipant);
    bind<ReportNoticeStore>(REPORTING_TYPES.ReportNoticeStore).to(
      D1ReportNoticeStore,
    );
    bind<UserLifecycleSyncHandler>(
      REPORTING_TYPES.ReporterWithdrawalSyncHandler,
    ).to(ReporterWithdrawalSyncHandler);
    bind<ReportSubmissionRateLimit>(
      REPORTING_TYPES.ReportSubmissionRateLimit,
    ).to(CounterReportSubmissionRateLimit);
    bind<ReportIncidentReporter>(REPORTING_TYPES.ReportIncidentReporter).to(
      SentryReportIncidentReporter,
    );
    bind<ReportTargetResolver>(REPORTING_TYPES.ReportTargetResolver).to(
      DirectoryReportTargetResolver,
    );
    bind<ReportSubmissionService>(REPORTING_TYPES.ReportSubmissionService).to(
      DefaultReportSubmissionService,
    );
    bind<ReportCaseReader>(REPORTING_TYPES.ReportCaseReader).to(
      DefaultReportCaseReader,
    );
    bind<ReportCaseWorkflow>(REPORTING_TYPES.ReportCaseWorkflow).to(
      DefaultReportCaseWorkflow,
    );
    bind<InfringementInquiryService>(
      REPORTING_TYPES.InfringementInquiryService,
    ).to(DefaultInfringementInquiryService);
    bind<ReportNotifier>(REPORTING_TYPES.ReportNotifier).to(
      EmailReportNotifier,
    );
    bind<ReportCategoryService>(REPORTING_TYPES.ReportCategoryService).to(
      DefaultReportCategoryService,
    );
    bind<ScheduledJobHandler>(REPORTING_TYPES.ReportNoticeRedispatchJob).to(
      ReportNoticeRedispatchJob,
    );
    bind<ScheduledJobHandler>(REPORTING_TYPES.ReportRetentionJob).to(
      ReportRetentionJob,
    );
  }),
};
