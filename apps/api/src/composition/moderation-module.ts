import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type AdminCommentReader,
  DefaultAdminCommentReader,
} from '../application/moderation/admin-comment-reader.ts';
import {
  type AdminProductReader,
  DefaultAdminProductReader,
} from '../application/moderation/admin-product-reader.ts';
import {
  type AdminRatingReader,
  DefaultAdminRatingReader,
} from '../application/moderation/admin-rating-reader.ts';
import {
  type AdminUserReader,
  DefaultAdminUserReader,
} from '../application/moderation/admin-user-reader.ts';
import {
  type AdministrativeWithdrawalService,
  DefaultAdministrativeWithdrawalService,
} from '../application/moderation/administrative-withdrawal-service.ts';
import {
  type CommentModerationService,
  DefaultCommentModerationService,
} from '../application/moderation/comment-moderation-service.ts';
import {
  DefaultImageModerationService,
  type ImageModerationService,
} from '../application/moderation/image-moderation-service.ts';
import { ModerationMaintenanceJob } from '../application/moderation/jobs/moderation-maintenance-job.ts';
import { WeeklyStatisticsJob } from '../application/moderation/jobs/weekly-statistics-job.ts';
import {
  EmailModerationNotifier,
  type ModerationNotifier,
} from '../application/moderation/moderation-notifier.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import {
  InMemoryPendingModerationRecord,
  type PendingModerationRecord,
} from '../application/moderation/pending-moderation-record.ts';
import type {
  EngagementModerationWriter,
  ImageModerationWriter,
  ModerationIncidentReporter,
  WeeklyStatisticsStore,
} from '../application/moderation/ports.ts';
import {
  DefaultProductModerationService,
  type ProductModerationService,
} from '../application/moderation/product-moderation-service.ts';
import {
  DefaultQuarantinedImageReader,
  type QuarantinedImageReader,
} from '../application/moderation/quarantined-image-reader.ts';
import {
  DefaultRatingModerationService,
  type RatingModerationService,
} from '../application/moderation/rating-moderation-service.ts';
import {
  DefaultUserModerationService,
  type UserModerationService,
} from '../application/moderation/user-moderation-service.ts';
import {
  DefaultWeeklyStatisticsReader,
  type WeeklyStatisticsReader,
} from '../application/moderation/weekly-statistics-reader.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { ControlEngagementModerationWriter } from '../infrastructure/moderation/control-engagement-moderation-writer.ts';
import { ControlImageModerationWriter } from '../infrastructure/moderation/control-image-moderation-writer.ts';
import { D1ModerationStatements } from '../infrastructure/moderation/d1-moderation-statements.ts';
import { D1WeeklyStatisticsStore } from '../infrastructure/moderation/d1-weekly-statistics-store.ts';
import {
  createModerationWriteParticipants,
  type ModerationWriteParticipants,
} from '../infrastructure/moderation/moderation-write-participant.ts';
import { ProductModerationRecordSyncHandler } from '../infrastructure/moderation/product-moderation-record-sync-handler.ts';
import { SentryModerationIncidentReporter } from '../infrastructure/moderation/sentry-moderation-incident-reporter.ts';
import { UserModerationRecordSyncHandler } from '../infrastructure/moderation/user-moderation-record-sync-handler.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import { resolverOf } from './container-resolver.ts';
import { MODERATION_WRITE_PARTICIPANTS } from './moderation-write-participants.ts';

// 措置の記録のストア(MODERATION_PLATFORM_MODULE)と、利用者・プロダクト・コメント・評価・画像の操作口と監査ログの準備、統計の集計が読む利用者・プロダクト・マッチ・収益の照会は他のモジュールの束縛を使う
export const MODERATION_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'moderation',
  bindings: new ContainerModule(({ bind }) => {
    // 処理単位のコンテナの既定はTransientのため、措置のユースケースと同期の処理が同じ保留中の措置を読めるよう処理単位で1つにする
    bind<PendingModerationRecord>(MODERATION_TYPES.PendingModerationRecord)
      .to(InMemoryPendingModerationRecord)
      .inSingletonScope();
    bind<ModerationIncidentReporter>(
      MODERATION_TYPES.ModerationIncidentReporter,
    ).to(SentryModerationIncidentReporter);
    bind<D1ModerationStatements>(MODERATION_TYPES.ModerationStatements).to(
      D1ModerationStatements,
    );
    bind<ModerationWriteParticipants>(
      MODERATION_TYPES.ModerationWriteParticipants,
    )
      .toDynamicValue((context) =>
        createModerationWriteParticipants(
          MODERATION_WRITE_PARTICIPANTS,
          resolverOf(context),
        ),
      )
      .inSingletonScope();
    bind<ImageModerationWriter>(MODERATION_TYPES.ImageModerationWriter).to(
      ControlImageModerationWriter,
    );
    bind<EngagementModerationWriter>(
      MODERATION_TYPES.EngagementModerationWriter,
    ).to(ControlEngagementModerationWriter);
    bind<UserLifecycleSyncHandler>(
      MODERATION_TYPES.UserModerationRecordSyncHandler,
    ).to(UserModerationRecordSyncHandler);
    bind<ProductLifecycleSyncHandler>(
      MODERATION_TYPES.ProductModerationRecordSyncHandler,
    ).to(ProductModerationRecordSyncHandler);
    bind<UserModerationService>(MODERATION_TYPES.UserModerationService).to(
      DefaultUserModerationService,
    );
    bind<AdministrativeWithdrawalService>(
      MODERATION_TYPES.AdministrativeWithdrawalService,
    ).to(DefaultAdministrativeWithdrawalService);
    bind<ProductModerationService>(
      MODERATION_TYPES.ProductModerationService,
    ).to(DefaultProductModerationService);
    bind<CommentModerationService>(
      MODERATION_TYPES.CommentModerationService,
    ).to(DefaultCommentModerationService);
    bind<RatingModerationService>(MODERATION_TYPES.RatingModerationService).to(
      DefaultRatingModerationService,
    );
    bind<ImageModerationService>(MODERATION_TYPES.ImageModerationService).to(
      DefaultImageModerationService,
    );
    bind<ModerationNotifier>(MODERATION_TYPES.ModerationNotifier).to(
      EmailModerationNotifier,
    );
    bind<AdminUserReader>(MODERATION_TYPES.AdminUserReader).to(
      DefaultAdminUserReader,
    );
    bind<AdminProductReader>(MODERATION_TYPES.AdminProductReader).to(
      DefaultAdminProductReader,
    );
    bind<AdminCommentReader>(MODERATION_TYPES.AdminCommentReader).to(
      DefaultAdminCommentReader,
    );
    bind<AdminRatingReader>(MODERATION_TYPES.AdminRatingReader).to(
      DefaultAdminRatingReader,
    );
    bind<QuarantinedImageReader>(MODERATION_TYPES.QuarantinedImageReader).to(
      DefaultQuarantinedImageReader,
    );
    bind<ScheduledJobHandler>(MODERATION_TYPES.ModerationMaintenanceJob).to(
      ModerationMaintenanceJob,
    );
    bind<WeeklyStatisticsStore>(MODERATION_TYPES.WeeklyStatisticsStore).to(
      D1WeeklyStatisticsStore,
    );
    bind<ScheduledJobHandler>(MODERATION_TYPES.WeeklyStatisticsJob).to(
      WeeklyStatisticsJob,
    );
    bind<WeeklyStatisticsReader>(MODERATION_TYPES.WeeklyStatisticsReader).to(
      DefaultWeeklyStatisticsReader,
    );
  }),
};
