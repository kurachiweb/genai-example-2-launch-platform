import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import {
  InMemoryPendingModerationRecord,
  type PendingModerationRecord,
} from '../application/moderation/pending-moderation-record.ts';
import type {
  EngagementModerationWriter,
  ImageModerationWriter,
  ModerationIncidentReporter,
} from '../application/moderation/ports.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { ControlEngagementModerationWriter } from '../infrastructure/moderation/control-engagement-moderation-writer.ts';
import { ControlImageModerationWriter } from '../infrastructure/moderation/control-image-moderation-writer.ts';
import { D1ModerationStatements } from '../infrastructure/moderation/d1-moderation-statements.ts';
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

// 措置の記録のストア(MODERATION_PLATFORM_MODULE)と、利用者・プロダクト・コメント・評価・画像の操作口と監査ログの準備は他のモジュールの束縛を使う
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
  }),
};
