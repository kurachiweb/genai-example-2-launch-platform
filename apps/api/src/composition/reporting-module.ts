import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import type {
  ReportCaseStore,
  ReportCaseWriter,
  ReportCategoryStore,
  ReportNoticeStore,
  ReportSubmissionStore,
} from '../application/reporting/ports.ts';
import { REPORTING_TYPES } from '../application/reporting/reporting-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import type { ModerationWriteParticipant } from '../infrastructure/moderation/moderation-write-participant.ts';
import { D1ReportCaseStatements } from '../infrastructure/reporting/d1-report-case-statements.ts';
import { D1ReportCaseStore } from '../infrastructure/reporting/d1-report-case-store.ts';
import { D1ReportCaseWriter } from '../infrastructure/reporting/d1-report-case-writer.ts';
import { D1ReportCategoryStore } from '../infrastructure/reporting/d1-report-category-store.ts';
import { D1ReportNoticeStore } from '../infrastructure/reporting/d1-report-notice-store.ts';
import { D1ReportSubmissionStore } from '../infrastructure/reporting/d1-report-submission-store.ts';
import { ReportCaseClosingParticipant } from '../infrastructure/reporting/report-case-closing-participant.ts';
import { ReporterWithdrawalSyncHandler } from '../infrastructure/reporting/reporter-withdrawal-sync-handler.ts';

// 退会の論理削除の文(REPORTING_PLATFORM_MODULE)は共通の束縛を使う
export const REPORTING_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'reporting',
  bindings: new ContainerModule(({ bind }) => {
    bind<ReportSubmissionStore>(REPORTING_TYPES.ReportSubmissionStore).to(
      D1ReportSubmissionStore,
    );
    bind<ReportCaseStore>(REPORTING_TYPES.ReportCaseStore).to(
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
  }),
};
