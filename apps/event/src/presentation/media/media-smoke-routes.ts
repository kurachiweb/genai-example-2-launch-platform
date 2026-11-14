import type { Context, Hono } from 'hono';

import { UPLOAD_FILE_NAME_HEADER } from '../../../common-lib/media/upload-protocol.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type {
  MediaFiles,
  MediaQuarantine,
  UploadReceiver,
} from '../../../lib/core/media/ports.ts';
import { MEDIA_SMOKE_PURPOSE } from '../../../lib/core/media/upload-purpose.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  EVENT_MEDIA_TYPES,
  type ModerationFindingsReader,
} from '../../application/media/ports.ts';
import {
  createSmokeNotFoundError,
  createSmokeUnauthenticatedError,
  matchesSmokeToken,
} from '../smoke/smoke-access.ts';

export const MEDIA_SMOKE_IMAGES_PATH = '/internal/media/smoke/images';

export interface MediaSmokeEnv {
  readonly MEDIA_SMOKE_TOKEN?: string;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

type SmokeContext<E extends PlatformEnv & MediaSmokeEnv> = Context<
  PlatformHonoEnv<E>
>;

async function authorize<E extends PlatformEnv & MediaSmokeEnv>(
  c: SmokeContext<E>,
): Promise<void> {
  const token = c.env.MEDIA_SMOKE_TOKEN;
  if (token === undefined || token === '') {
    throw createSmokeNotFoundError();
  }
  if (!(await matchesSmokeToken(c.req.header('Authorization'), token))) {
    throw createSmokeUnauthenticatedError();
  }
}

// 運用者のトークンで他の用途のファイルを読んだり変えたりできないよう、動作確認の用途のファイルだけを対象にする
async function findSmokeFile<E extends PlatformEnv & MediaSmokeEnv>(
  c: SmokeContext<E>,
  fileId: string,
): Promise<MediaFileView> {
  const file = (
    await c
      .get('container')
      .get<MediaFiles>(MEDIA_TYPES.MediaFiles)
      .findMany([fileId])
  ).get(fileId);
  if (file?.purpose !== MEDIA_SMOKE_PURPOSE.name) {
    throw createSmokeNotFoundError();
  }
  return file;
}

function quarantineOf<E extends PlatformEnv & MediaSmokeEnv>(
  c: SmokeContext<E>,
): MediaQuarantine {
  return c.get('container').get<MediaQuarantine>(MEDIA_TYPES.MediaQuarantine);
}

export function registerMediaSmokeRoutes<E extends PlatformEnv & MediaSmokeEnv>(
  app: Hono<PlatformHonoEnv<E>>,
): void {
  app.post(MEDIA_SMOKE_IMAGES_PATH, async (c) => {
    await authorize(c);
    const outcome = await c
      .get('container')
      .get<UploadReceiver>(MEDIA_TYPES.UploadReceiver)
      .receive({
        purpose: MEDIA_SMOKE_PURPOSE,
        uploader: { kind: 'system' },
        contentLength: c.req.header('Content-Length') ?? null,
        contentType: c.req.header('Content-Type') ?? null,
        fileNameHeader: c.req.header(UPLOAD_FILE_NAME_HEADER) ?? null,
        body: c.req.raw.body,
      });
    if (!outcome.ok) {
      throw new AppError(outcome.rejection);
    }
    return c.json({ data: outcome.file }, 201, NO_STORE);
  });

  app.get(`${MEDIA_SMOKE_IMAGES_PATH}/:fileId`, async (c) => {
    await authorize(c);
    const file = await findSmokeFile(c, c.req.param('fileId'));
    const findings = await c
      .get('container')
      .get<ModerationFindingsReader>(EVENT_MEDIA_TYPES.ModerationFindingsReader)
      .findingsOf(file.id);
    return c.json(
      {
        data: {
          moderationStatus: file.moderationStatus,
          location: file.location,
          quarantineReasons: file.quarantineReasons,
          findings,
        },
      },
      200,
      NO_STORE,
    );
  });

  app.post(`${MEDIA_SMOKE_IMAGES_PATH}/:fileId/quarantine`, async (c) => {
    await authorize(c);
    const file = await findSmokeFile(c, c.req.param('fileId'));
    await quarantineOf(c).addReason([file.id], 'admin_action');
    return c.body(null, 202, NO_STORE);
  });

  app.post(`${MEDIA_SMOKE_IMAGES_PATH}/:fileId/release`, async (c) => {
    await authorize(c);
    const file = await findSmokeFile(c, c.req.param('fileId'));
    await quarantineOf(c).removeReason([file.id], 'admin_action');
    return c.body(null, 202, NO_STORE);
  });

  app.delete(`${MEDIA_SMOKE_IMAGES_PATH}/:fileId`, async (c) => {
    await authorize(c);
    const file = await findSmokeFile(c, c.req.param('fileId'));
    await c
      .get('container')
      .get<MediaFiles>(MEDIA_TYPES.MediaFiles)
      .eraseNow([file.id]);
    return c.body(null, 202, NO_STORE);
  });
}
