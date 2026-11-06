import type { ScheduledJobDefinition } from '../../lib/core/scheduling/cron-registry.ts';
import type { ScheduledRunBudget } from '../../lib/core/scheduling/run-budget.ts';
import { SEARCH_TYPES } from '../../lib/core/search/identifiers.ts';
import { ADMIN_TYPES } from '../application/admin/admin-types.ts';
import { API_EMAIL_TYPES } from '../application/email/email-cleanup-job.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import { GUEST_INQUIRY_RETENTION_JOB_DEFINITION } from '../application/inquiry/jobs/guest-inquiry-retention-job.ts';
import { MEDIA_JOB_TYPES } from '../application/media/media-daily-jobs.ts';
import { CHECKOUT_RECONCILIATION_JOB_DEFINITION } from '../application/payments/jobs/checkout-reconciliation-job.ts';
import { PAYMENT_HISTORY_RETENTION_JOB_DEFINITION } from '../application/payments/jobs/payment-history-retention-job.ts';
import { PENDING_CHECKOUT_SWEEP_JOB_DEFINITION } from '../application/payments/jobs/pending-checkout-sweep-job.ts';

export const SCHEDULED_JOBS: readonly ScheduledJobDefinition[] = [
  {
    name: 'identity-auth.purge-orchestrator',
    at: { hour: 4, minute: 21 },
    order: 100,
    handler: IDENTITY_TYPES.PurgeOrchestratorJob,
  },
  {
    name: 'identity-auth.credential-cleanup',
    at: { hour: 4, minute: 21 },
    order: 110,
    handler: IDENTITY_TYPES.CredentialCleanupJob,
  },
  {
    name: 'identity-auth.disposable-recheck-sweep',
    at: { hour: 4, minute: 21 },
    order: 120,
    handler: IDENTITY_TYPES.DisposableRecheckSweepJob,
  },
  {
    name: 'admin-foundation.credential-cleanup',
    at: { hour: 4, minute: 21 },
    order: 200,
    handler: ADMIN_TYPES.AdminCredentialCleanupJob,
  },
  {
    name: 'admin-foundation.audit-log-retention',
    at: { hour: 4, minute: 21 },
    order: 210,
    handler: ADMIN_TYPES.AuditLogRetentionJob,
  },
  GUEST_INQUIRY_RETENTION_JOB_DEFINITION,
  PENDING_CHECKOUT_SWEEP_JOB_DEFINITION,
  PAYMENT_HISTORY_RETENTION_JOB_DEFINITION,
  {
    name: 'media-pipeline.expired-file-erasure',
    at: { hour: 4, minute: 21 },
    order: 810,
    handler: MEDIA_JOB_TYPES.ExpiredFileErasureJob,
  },
  {
    name: 'media-pipeline.moderation-requeue',
    at: { hour: 4, minute: 21 },
    order: 820,
    handler: MEDIA_JOB_TYPES.ModerationRequeueJob,
  },
  {
    name: 'media-pipeline.location-reconciliation',
    at: { hour: 4, minute: 21 },
    order: 830,
    handler: MEDIA_JOB_TYPES.LocationReconciliationJob,
  },
  {
    name: 'email-delivery.cleanup',
    at: { hour: 4, minute: 21 },
    order: 900,
    handler: API_EMAIL_TYPES.EmailCleanupJob,
  },
  {
    name: 'content-processing.keyword-reextraction',
    at: { hour: 4, minute: 21 },
    order: 2300,
    handler: SEARCH_TYPES.ReextractionJob,
  },
  CHECKOUT_RECONCILIATION_JOB_DEFINITION,
  // 4:21のメールの後始末と、送り直したイベントの波及処理による抑止記録の削除が同じ起動で重ならないよう、12時間離す
  {
    name: 'identity-auth.lifecycle-redispatch',
    at: { hour: 16, minute: 21 },
    order: 100,
    handler: IDENTITY_TYPES.LifecycleRedispatchJob,
  },
];

// 4:21の起動には複数のドメインのジョブが順に集まるため、1回の起動の合計の所要時間に予算を置き、超過を警告する。ジョブの無い時刻の予算は誤りにならない
export const SCHEDULED_RUN_BUDGETS: readonly ScheduledRunBudget[] = [
  { at: { hour: 4, minute: 21 }, maxTotalDurationMs: 300_000 },
];
