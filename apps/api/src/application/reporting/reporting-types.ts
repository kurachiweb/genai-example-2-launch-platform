// backend-lib/core/reportingの共有部品の識別子がreporting.の接頭辞を使うため、APIサーバーの識別子はreporting.api.で分ける
const ReportSubmissionStore: unique symbol = Symbol.for(
  'reporting.api.ReportSubmissionStore',
);

const ReportCaseStore: unique symbol = Symbol.for(
  'reporting.api.ReportCaseStore',
);

const ReportCaseWriter: unique symbol = Symbol.for(
  'reporting.api.ReportCaseWriter',
);

const ReportCategoryStore: unique symbol = Symbol.for(
  'reporting.api.ReportCategoryStore',
);

const ReportNoticeStore: unique symbol = Symbol.for(
  'reporting.api.ReportNoticeStore',
);

const ReportSubmissionRateLimit: unique symbol = Symbol.for(
  'reporting.api.ReportSubmissionRateLimit',
);

const ReportIncidentReporter: unique symbol = Symbol.for(
  'reporting.api.ReportIncidentReporter',
);

const ReportTargetResolver: unique symbol = Symbol.for(
  'reporting.api.ReportTargetResolver',
);

const ReportSubmissionService: unique symbol = Symbol.for(
  'reporting.api.ReportSubmissionService',
);

const ReportCaseReader: unique symbol = Symbol.for(
  'reporting.api.ReportCaseReader',
);

const ReportCaseWorkflow: unique symbol = Symbol.for(
  'reporting.api.ReportCaseWorkflow',
);

const InfringementInquiryService: unique symbol = Symbol.for(
  'reporting.api.InfringementInquiryService',
);

const ReportNotifier: unique symbol = Symbol.for(
  'reporting.api.ReportNotifier',
);

const ReportCategoryService: unique symbol = Symbol.for(
  'reporting.api.ReportCategoryService',
);

const ReportNoticeRedispatchJob: unique symbol = Symbol.for(
  'reporting.api.ReportNoticeRedispatchJob',
);

const ReportRetentionJob: unique symbol = Symbol.for(
  'reporting.api.ReportRetentionJob',
);

const ReporterWithdrawalSyncHandler: unique symbol = Symbol.for(
  'reporting.api.ReporterWithdrawalSyncHandler',
);

const ReportCaseStatements: unique symbol = Symbol.for(
  'reporting.api.ReportCaseStatements',
);

const ReportCaseClosingParticipant: unique symbol = Symbol.for(
  'reporting.api.ReportCaseClosingParticipant',
);

export const REPORTING_TYPES = Object.freeze({
  ReportSubmissionStore,
  ReportCaseStore,
  ReportCaseWriter,
  ReportCategoryStore,
  ReportNoticeStore,
  ReportSubmissionRateLimit,
  ReportIncidentReporter,
  ReportTargetResolver,
  ReportSubmissionService,
  ReportCaseReader,
  ReportCaseWorkflow,
  InfringementInquiryService,
  ReportNotifier,
  ReportCategoryService,
  ReportNoticeRedispatchJob,
  ReportRetentionJob,
  ReporterWithdrawalSyncHandler,
  ReportCaseStatements,
  ReportCaseClosingParticipant,
});
