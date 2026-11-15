import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type {
  ModerateImageBody,
  PurgeImageCacheBody,
  RelocateFilesBody,
} from '../../lib/core/media/media-messages.ts';
import type {
  MediaFileStore,
  MediaObjectStore,
} from '../../lib/core/media/ports.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMediaPlatformModule } from '../../lib/workers/media/media-platform-module.ts';
import type { MessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import { EVENT_MEDIA_HANDLER_TYPES } from '../application/media/media-handler-types.ts';
import { ModerateImageHandler } from '../application/media/moderate-image-handler.ts';
import { parseModerationConfig } from '../application/media/moderation-config.ts';
import {
  EVENT_MEDIA_TYPES,
  type FileRelocator,
  type ImageCachePurger,
  type MediaIncidentReporter,
  type ModerationImageRenderer,
  type ModerationProvider,
} from '../application/media/ports.ts';
import { PurgeImageCacheHandler } from '../application/media/purge-image-cache-handler.ts';
import { RelocateFilesHandler } from '../application/media/relocate-files-handler.ts';
import { createModerationProvider } from '../infrastructure/media/create-moderation-provider.ts';
import { MediaFileRelocator } from '../infrastructure/media/file-relocator.ts';
import { SentryMediaIncidentReporter } from '../infrastructure/media/sentry-media-incident-reporter.ts';
import { WasmModerationImageRenderer } from '../infrastructure/media/wasm-moderation-image-renderer.ts';
import { WorkersCachePurger } from '../infrastructure/media/workers-cache-purger.ts';
import type { EventEnv } from './env-schema.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export const EVENT_MEDIA_PLATFORM_MODULE: EventAppModule =
  createMediaPlatformModule('event');

// 共通のメディアの束縛(EVENT_MEDIA_PLATFORM_MODULE)が登録されている前提で、判定・保存先の移動・パージの部品と3種のメッセージの処理を束縛する
export const EVENT_MEDIA_MODULE: EventAppModule = {
  name: 'event-media',
  bindings: new ContainerModule(({ bind }) => {
    bind<ModerationProvider>(EVENT_MEDIA_TYPES.ModerationProvider)
      .toDynamicValue((context) =>
        createModerationProvider(
          context.get<EventEnv>(PLATFORM_TYPES.Env),
          fetch,
        ),
      )
      .inSingletonScope();
    bind<ModerationImageRenderer>(EVENT_MEDIA_TYPES.ModerationImageRenderer)
      .toDynamicValue(() => new WasmModerationImageRenderer())
      .inSingletonScope();
    bind<MediaIncidentReporter>(EVENT_MEDIA_TYPES.MediaIncidentReporter).to(
      SentryMediaIncidentReporter,
    );
    bind<FileRelocator>(EVENT_MEDIA_TYPES.FileRelocator)
      .toDynamicValue(
        (context) =>
          new MediaFileRelocator({
            files: context.get<MediaFileStore>(MEDIA_TYPES.MediaFileStore),
            objects: context.get<MediaObjectStore>(
              MEDIA_TYPES.MediaObjectStore,
            ),
            publisher: context.get<MessagePublisher>(
              PLATFORM_TYPES.MessagePublisher,
            ),
          }),
      )
      .inSingletonScope();
    bind<ImageCachePurger>(EVENT_MEDIA_TYPES.ImageCachePurger).to(
      WorkersCachePurger,
    );
    bind<MessageHandler<ModerateImageBody>>(
      EVENT_MEDIA_HANDLER_TYPES.ModerateImageHandler,
    ).toDynamicValue(
      (context) =>
        new ModerateImageHandler({
          files: context.get<MediaFileStore>(MEDIA_TYPES.MediaFileStore),
          objects: context.get<MediaObjectStore>(MEDIA_TYPES.MediaObjectStore),
          renderer: context.get<ModerationImageRenderer>(
            EVENT_MEDIA_TYPES.ModerationImageRenderer,
          ),
          provider: context.get<ModerationProvider>(
            EVENT_MEDIA_TYPES.ModerationProvider,
          ),
          incidents: context.get<MediaIncidentReporter>(
            EVENT_MEDIA_TYPES.MediaIncidentReporter,
          ),
          relocator: context.get<FileRelocator>(
            EVENT_MEDIA_TYPES.FileRelocator,
          ),
          config: parseModerationConfig(
            context.get<EventEnv>(PLATFORM_TYPES.Env),
          ),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
        }),
    );
    bind<MessageHandler<RelocateFilesBody>>(
      EVENT_MEDIA_HANDLER_TYPES.RelocateFilesHandler,
    ).to(RelocateFilesHandler);
    bind<MessageHandler<PurgeImageCacheBody>>(
      EVENT_MEDIA_HANDLER_TYPES.PurgeImageCacheHandler,
    ).to(PurgeImageCacheHandler);
  }),
};
