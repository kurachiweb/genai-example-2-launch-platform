import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { ArchiveGenerationService } from '../application/data-export/archive-generation-service.ts';
import { EVENT_DATA_EXPORT_TYPES } from '../application/data-export/event-data-export-types.ts';
import { ExportFileResolver } from '../application/data-export/export-file-resolver.ts';
import { ExportSnapshotCollector } from '../application/data-export/export-snapshot-collector.ts';
import { GenerateArchiveHandler } from '../application/data-export/generate-archive-handler.ts';
import { GenerationWatchdogHandler } from '../application/data-export/generation-watchdog-handler.ts';
import { AccountSourceReader } from '../application/data-export/sources/account-source-reader.ts';
import { CorrespondenceSourceReader } from '../application/data-export/sources/correspondence-source-reader.ts';
import { ProductActivitySourceReader } from '../application/data-export/sources/product-activity-source-reader.ts';
import type { EventEnv } from './env-schema.ts';

// データエクスポートの共通の束縛(createDataExportPlatformModule('event'))と上流の出力用の部品の束縛が登録されている前提で、データの収集と生成の部品を束縛する
export const EVENT_DATA_EXPORT_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-data-export',
  bindings: new ContainerModule(({ bind }) => {
    bind<AccountSourceReader>(EVENT_DATA_EXPORT_TYPES.AccountSourceReader).to(
      AccountSourceReader,
    );
    bind<ProductActivitySourceReader>(
      EVENT_DATA_EXPORT_TYPES.ProductActivitySourceReader,
    ).to(ProductActivitySourceReader);
    bind<CorrespondenceSourceReader>(
      EVENT_DATA_EXPORT_TYPES.CorrespondenceSourceReader,
    ).to(CorrespondenceSourceReader);
    bind<ExportFileResolver>(EVENT_DATA_EXPORT_TYPES.ExportFileResolver).to(
      ExportFileResolver,
    );
    bind<ExportSnapshotCollector>(
      EVENT_DATA_EXPORT_TYPES.ExportSnapshotCollector,
    ).to(ExportSnapshotCollector);
    bind<ArchiveGenerationService>(
      EVENT_DATA_EXPORT_TYPES.ArchiveGenerationService,
    ).to(ArchiveGenerationService);
    bind<GenerateArchiveHandler>(
      EVENT_DATA_EXPORT_TYPES.GenerateArchiveHandler,
    ).to(GenerateArchiveHandler);
    bind<GenerationWatchdogHandler>(
      EVENT_DATA_EXPORT_TYPES.GenerationWatchdogHandler,
    ).to(GenerationWatchdogHandler);
  }),
};
