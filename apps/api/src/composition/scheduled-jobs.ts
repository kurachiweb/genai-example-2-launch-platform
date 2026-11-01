import type { ScheduledJobDefinition } from '../../lib/core/scheduling/cron-registry.ts';
import type { ScheduledRunBudget } from '../../lib/core/scheduling/run-budget.ts';
import { SEARCH_TYPES } from '../../lib/core/search/identifiers.ts';
import { API_EMAIL_TYPES } from '../application/email/email-cleanup-job.ts';
import { MEDIA_JOB_TYPES } from '../application/media/media-daily-jobs.ts';

export const SCHEDULED_JOBS: readonly ScheduledJobDefinition[] = [
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
];

// 4:21の起動には複数のドメインのジョブが順に集まるため、1回の起動の合計の所要時間に予算を置き、超過を警告する。ジョブの無い時刻の予算は誤りにならない
export const SCHEDULED_RUN_BUDGETS: readonly ScheduledRunBudget[] = [
  { at: { hour: 4, minute: 21 }, maxTotalDurationMs: 300_000 },
];
