import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { MEDIA_TYPES } from '../../core/media/identifiers.ts';
import type {
  MediaEraser,
  MediaFiles,
  MediaFileStore,
  MediaObjectStore,
  MediaQuarantine,
  UploadReceiver,
} from '../../core/media/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';
import { D1MediaFileStore } from './d1-media-file-store.ts';
import { MediaFileEraser } from './media-eraser.ts';
import { MediaFilesService } from './media-files-service.ts';
import { MediaQuarantineService } from './media-quarantine-service.ts';
import { R2MediaObjectStore } from './r2-media-object-store.ts';
import { MediaUploadReceiver } from './upload-receiver.ts';

// 用途の登録表はアプリごとに登録する用途が違うため、各アプリのメディアのモジュールが束縛する
export function createMediaPlatformModule(
  appName: LoggingOptions['appName'],
): Omit<AppModule, 'routes'> {
  return {
    name: 'media-platform',
    bindings: new ContainerModule(({ bind }) => {
      bind<MediaFileStore>(MEDIA_TYPES.MediaFileStore)
        .to(D1MediaFileStore)
        .inSingletonScope();
      bind<MediaObjectStore>(MEDIA_TYPES.MediaObjectStore)
        .to(R2MediaObjectStore)
        .inSingletonScope();
      bind<MediaEraser>(MEDIA_TYPES.MediaEraser)
        .toDynamicValue(
          (context) =>
            new MediaFileEraser({
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
      bind<MediaFiles>(MEDIA_TYPES.MediaFiles)
        .toDynamicValue(
          (context) =>
            new MediaFilesService({
              files: context.get<MediaFileStore>(MEDIA_TYPES.MediaFileStore),
              objects: context.get<MediaObjectStore>(
                MEDIA_TYPES.MediaObjectStore,
              ),
              eraser: context.get<MediaEraser>(MEDIA_TYPES.MediaEraser),
              appName,
            }),
        )
        .inSingletonScope();
      bind<MediaQuarantine>(MEDIA_TYPES.MediaQuarantine)
        .toDynamicValue(
          (context) =>
            new MediaQuarantineService({
              files: context.get<MediaFileStore>(MEDIA_TYPES.MediaFileStore),
              publisher: context.get<MessagePublisher>(
                PLATFORM_TYPES.MessagePublisher,
              ),
              appName,
            }),
        )
        .inSingletonScope();
      bind<UploadReceiver>(MEDIA_TYPES.UploadReceiver)
        .toDynamicValue(
          (context) =>
            new MediaUploadReceiver({
              files: context.get<MediaFileStore>(MEDIA_TYPES.MediaFileStore),
              objects: context.get<MediaObjectStore>(
                MEDIA_TYPES.MediaObjectStore,
              ),
              publisher: context.get<MessagePublisher>(
                PLATFORM_TYPES.MessagePublisher,
              ),
              ids: context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
              appName,
            }),
        )
        .inSingletonScope();
    }),
  };
}
