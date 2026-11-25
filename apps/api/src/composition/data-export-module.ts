import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type ArchiveDownloadService,
  StoreArchiveDownloadService,
} from '../application/data-export/archive-download-service.ts';
import { ArchiveExpiryJob } from '../application/data-export/jobs/archive-expiry-job.ts';
import { GenerationRecoveryJob } from '../application/data-export/jobs/generation-recovery-job.ts';
import {
  type DataExportReader,
  StoreDataExportReader,
} from '../application/data-export/data-export-reader.ts';
import type { DataExportRequestLimits } from '../application/data-export/data-export-request-ports.ts';
import {
  type DataExportRequestService,
  StoreDataExportRequestService,
} from '../application/data-export/data-export-request-service.ts';
import { DATA_EXPORT_TYPES } from '../application/data-export/data-export-types.ts';
import { CounterDataExportRequestLimits } from '../infrastructure/data-export/counter-data-export-request-limits.ts';

// 要求の記録・保存先・通知・失敗の確定・エラートラッキングへの送信(createDataExportPlatformModule)と、本人の確認・厳密カウンタ・メッセージの送信は他のモジュールの束縛を使う
export const DATA_EXPORT_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'api-data-export',
  bindings: new ContainerModule(({ bind }) => {
    bind<DataExportRequestLimits>(DATA_EXPORT_TYPES.DataExportRequestLimits).to(
      CounterDataExportRequestLimits,
    );
    bind<DataExportRequestService>(
      DATA_EXPORT_TYPES.DataExportRequestService,
    ).to(StoreDataExportRequestService);
    bind<DataExportReader>(DATA_EXPORT_TYPES.DataExportReader).to(
      StoreDataExportReader,
    );
    bind<ArchiveDownloadService>(DATA_EXPORT_TYPES.ArchiveDownloadService).to(
      StoreArchiveDownloadService,
    );
    bind<ScheduledJobHandler>(DATA_EXPORT_TYPES.ArchiveExpiryJob).to(
      ArchiveExpiryJob,
    );
    bind<ScheduledJobHandler>(DATA_EXPORT_TYPES.GenerationRecoveryJob).to(
      GenerationRecoveryJob,
    );
  }),
};
