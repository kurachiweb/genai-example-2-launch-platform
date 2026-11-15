import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import type { DirectoryItemMetricSource } from '../application/directory/item-metric-sources.ts';
import { CommentAnonymizationJob } from '../application/engagement/comment-anonymization-job.ts';
import { ThreadQueryCommentCountMetricSource } from '../application/engagement/comment-count-metric-source.ts';
import {
  type CommentReader,
  StoreCommentReader,
} from '../application/engagement/comment-reader.ts';
import {
  type CommentService,
  StoreCommentService,
} from '../application/engagement/comment-service.ts';
import {
  DirectoryEngagementTargetResolver,
  type EngagementTargetResolver,
} from '../application/engagement/engagement-target-resolver.ts';
import { ENGAGEMENT_TYPES } from '../application/engagement/engagement-types.ts';
import type {
  CommentWriter,
  EngagementIncidentReporter,
  RatingWriter,
} from '../application/engagement/ports.ts';
import {
  type RatingService,
  StoreRatingService,
} from '../application/engagement/rating-service.ts';
import {
  type CommentModerationControl,
  D1CommentModerationControl,
} from '../infrastructure/engagement/comment-moderation-control.ts';
import { D1CommentWriter } from '../infrastructure/engagement/d1-comment-writer.ts';
import { D1RatingWriter } from '../infrastructure/engagement/d1-rating-writer.ts';
import { SentryEngagementIncidentReporter } from '../infrastructure/engagement/sentry-engagement-incident-reporter.ts';
import { EngagementWithdrawalSyncHandler } from '../infrastructure/engagement/engagement-withdrawal-sync-handler.ts';
import {
  D1RatingModerationControl,
  type RatingModerationControl,
} from '../infrastructure/engagement/rating-moderation-control.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';

// コメントと評価のストア・文の部品(ENGAGEMENT_PLATFORM_MODULE)とプロダクトの照会(PRODUCT_PLATFORM_MODULE)は各モジュールの束縛を使う
export const ENGAGEMENT_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'engagement',
  bindings: new ContainerModule(({ bind }) => {
    bind<EngagementTargetResolver>(
      ENGAGEMENT_TYPES.EngagementTargetResolver,
    ).to(DirectoryEngagementTargetResolver);
    bind<CommentWriter>(ENGAGEMENT_TYPES.CommentWriter).to(D1CommentWriter);
    bind<CommentService>(ENGAGEMENT_TYPES.CommentService).to(
      StoreCommentService,
    );
    bind<CommentReader>(ENGAGEMENT_TYPES.CommentReader).to(StoreCommentReader);
    bind<RatingWriter>(ENGAGEMENT_TYPES.RatingWriter).to(D1RatingWriter);
    bind<RatingService>(ENGAGEMENT_TYPES.RatingService).to(StoreRatingService);
    bind<CommentModerationControl>(
      ENGAGEMENT_TYPES.CommentModerationControl,
    ).to(D1CommentModerationControl);
    bind<RatingModerationControl>(ENGAGEMENT_TYPES.RatingModerationControl).to(
      D1RatingModerationControl,
    );
    bind<DirectoryItemMetricSource>(
      ENGAGEMENT_TYPES.CommentCountMetricSource,
    ).to(ThreadQueryCommentCountMetricSource);
    bind<UserLifecycleSyncHandler>(
      ENGAGEMENT_TYPES.EngagementWithdrawalSyncHandler,
    ).to(EngagementWithdrawalSyncHandler);
    bind<ScheduledJobHandler>(ENGAGEMENT_TYPES.CommentAnonymizationJob).to(
      CommentAnonymizationJob,
    );
    bind<EngagementIncidentReporter>(
      ENGAGEMENT_TYPES.EngagementIncidentReporter,
    ).to(SentryEngagementIncidentReporter);
  }),
};
