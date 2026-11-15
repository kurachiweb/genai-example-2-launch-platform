import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import { MEDIA_TYPES } from '../../core/media/identifiers.ts';
import type {
  MediaEraser,
  MediaFiles,
  MediaFileStore,
  MediaObjectStore,
  MediaQuarantine,
  UploadReceiver,
} from '../../core/media/ports.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1MediaFileStore } from './d1-media-file-store.ts';
import { MediaFileEraser } from './media-eraser.ts';
import { MediaFilesService } from './media-files-service.ts';
import { createMediaPlatformModule } from './media-platform-module.ts';
import { MediaQuarantineService } from './media-quarantine-service.ts';
import { R2MediaObjectStore } from './r2-media-object-store.ts';
import {
  fileIdOf,
  insertFile,
  readReasons,
} from './testing/media-file-store-fixtures.ts';
import { clearMediaState } from './testing/media-operations-fixtures.ts';
import {
  createHookedQueue,
  relocateMessagesOf,
} from './testing/media-quarantine-fixtures.ts';
import {
  acceptedFileOf,
  pngBytes,
  uploadInputOf,
} from './testing/upload-receiver-fixtures.ts';
import { MediaUploadReceiver } from './upload-receiver.ts';

const MEDIA_PLATFORM_MODULE = createMediaPlatformModule('api');

function createContainer(jobsQueue: Queue<QueueEnvelope>): Container {
  return createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: jobsQueue },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-media-platform',
        clientIp: undefined,
      },
    },
    [MEDIA_PLATFORM_MODULE],
  );
}

beforeEach(async () => {
  await clearMediaState();
});

describe('createMediaPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      MEDIA_PLATFORM_MODULE,
      createMediaPlatformModule('event'),
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(MEDIA_PLATFORM_MODULE.name).toBe('media-platform');
    expect('routes' in MEDIA_PLATFORM_MODULE).toBe(false);
  });

  test('処理単位のコンテナから3つの操作・受付処理・物理削除・リポジトリ・オブジェクトストアを解決する', () => {
    const container = createContainer(createHookedQueue().queue);

    expect(container.get<MediaFiles>(MEDIA_TYPES.MediaFiles)).toBeInstanceOf(
      MediaFilesService,
    );
    expect(
      container.get<MediaQuarantine>(MEDIA_TYPES.MediaQuarantine),
    ).toBeInstanceOf(MediaQuarantineService);
    expect(container.get<MediaEraser>(MEDIA_TYPES.MediaEraser)).toBeInstanceOf(
      MediaFileEraser,
    );
    expect(
      container.get<UploadReceiver>(MEDIA_TYPES.UploadReceiver),
    ).toBeInstanceOf(MediaUploadReceiver);
    expect(
      container.get<MediaFileStore>(MEDIA_TYPES.MediaFileStore),
    ).toBeInstanceOf(D1MediaFileStore);
    expect(
      container.get<MediaObjectStore>(MEDIA_TYPES.MediaObjectStore),
    ).toBeInstanceOf(R2MediaObjectStore);
  });

  test('1つの処理単位では同じインスタンスを使い回し、処理単位をまたいで共有しない', () => {
    const first = createContainer(createHookedQueue().queue);
    const second = createContainer(createHookedQueue().queue);

    expect(first.get(MEDIA_TYPES.MediaFiles)).toBe(
      first.get(MEDIA_TYPES.MediaFiles),
    );
    expect(first.get(MEDIA_TYPES.MediaFileStore)).toBe(
      first.get(MEDIA_TYPES.MediaFileStore),
    );
    expect(first.get(MEDIA_TYPES.MediaFiles)).not.toBe(
      second.get(MEDIA_TYPES.MediaFiles),
    );
  });

  test('解決した操作は処理単位のD1・R2・Queueで読み書きする', async () => {
    const hooked = createHookedQueue();
    const container = createContainer(hooked.queue);
    await insertFile(1);

    const outcome = await container
      .get<UploadReceiver>(MEDIA_TYPES.UploadReceiver)
      .receive(uploadInputOf(pngBytes(640, 480)));
    await container
      .get<MediaQuarantine>(MEDIA_TYPES.MediaQuarantine)
      .addReason([fileIdOf(1)], 'admin_action');
    const uploaded = acceptedFileOf(outcome);
    const views = await container
      .get<MediaFiles>(MEDIA_TYPES.MediaFiles)
      .findMany([uploaded.fileId, fileIdOf(1)]);

    expect(views.get(uploaded.fileId)).toMatchObject({ stored: true });
    expect(views.get(fileIdOf(1))).toMatchObject({
      quarantineReasons: ['admin_action'],
    });
    expect((await readReasons()).map((row) => row.fileId)).toEqual([
      fileIdOf(1),
    ]);
    expect(relocateMessagesOf(hooked.sent)).toEqual([[fileIdOf(1)]]);
  });
});
