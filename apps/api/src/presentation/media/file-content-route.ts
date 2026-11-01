import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { attachmentDisposition } from '../../../lib/core/media/file-name.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import {
  type MediaFileView,
  readLocationsOf,
} from '../../../lib/core/media/media-file.ts';
import type {
  MediaFiles,
  MediaObjectStore,
  StoredObject,
} from '../../../lib/core/media/ports.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import { storageUnavailable } from '../../../lib/workers/media/media-operation-errors.ts';
import type {
  FileAccessAuthorizer,
  FileAccessCaller,
} from '../../application/media/file-access-authorizer.ts';
import { FILE_ACCESS_TYPES } from '../../application/media/file-access-policies.ts';
import type { CallerKind } from '../gateway/gateway-headers.ts';
import {
  createNotFoundError,
  type InternalHonoEnv,
} from '../gateway/internal-only.ts';
import { readInternalCaller } from '../gateway/internal-request.ts';

export const FILE_CONTENT_ROUTE_PATH = '/media/files/:fileId';

const FILE_ID_SCHEMA = z.ulid();

// application層の判定は内部経路の呼び出し元の型を読み込めないため、対応をここで型として結ぶ
const FILE_ACCESS_CALLERS = Object.freeze({
  client: 'client',
  admin: 'admin',
} as const satisfies Record<CallerKind, FileAccessCaller>);

const logger = getAppLogger(['api', 'media', 'download']);

function isAvailable(file: MediaFileView): boolean {
  return file.stored && file.deletedAt === null && !file.eraseRequested;
}

function callerOf<E extends PlatformEnv>(
  c: Context<InternalHonoEnv<E>>,
): FileAccessCaller {
  const caller = readInternalCaller(c.req.raw);
  if (caller === undefined) {
    throw new Error('内部経路の呼び出し元がありません');
  }
  return FILE_ACCESS_CALLERS[caller];
}

async function fromStorage<T>(
  fileId: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logger.warn('非公開ファイルの保存先を読めませんでした', { fileId, error });
    throw storageUnavailable();
  }
}

async function findAvailableFile(
  files: MediaFiles,
  fileId: string,
): Promise<MediaFileView | undefined> {
  const file = (await fromStorage(fileId, () => files.findMany([fileId]))).get(
    fileId,
  );
  return file !== undefined && isAvailable(file) ? file : undefined;
}

async function readContent(
  objects: MediaObjectStore,
  file: MediaFileView,
): Promise<StoredObject | undefined> {
  for (const location of readLocationsOf(file)) {
    const stored = await fromStorage(file.id, () =>
      objects.get(location, file.objectKey),
    );
    if (stored !== undefined) {
      return stored;
    }
  }
  logger.warn('保存済みのファイルのオブジェクトがどの保存先にもありません', {
    fileId: file.id,
    storage: file.storage,
  });
  return undefined;
}

// 閲覧できない理由を応答から推測されないよう、識別子の形式・記録の状態・判定の拒否・オブジェクトの欠落を同じ404にする
export function registerFileContentRoutes<E extends PlatformEnv>(
  app: Hono<InternalHonoEnv<E>>,
): void {
  app.get(FILE_CONTENT_ROUTE_PATH, async (c) => {
    const principal = await c.var.session.requireAuthenticated();
    const fileId = c.req.param('fileId');
    if (!FILE_ID_SCHEMA.safeParse(fileId).success) {
      throw createNotFoundError();
    }
    const container = c.get('container');
    const file = await findAvailableFile(
      container.get<MediaFiles>(MEDIA_TYPES.MediaFiles),
      fileId,
    );
    if (file === undefined) {
      throw createNotFoundError();
    }
    const allowed = await container
      .get<FileAccessAuthorizer>(FILE_ACCESS_TYPES.FileAccessAuthorizer)
      .canAccess({ caller: callerOf(c), principal, file });
    if (!allowed) {
      throw createNotFoundError();
    }
    const stored = await readContent(
      container.get<MediaObjectStore>(MEDIA_TYPES.MediaObjectStore),
      file,
    );
    if (stored === undefined) {
      throw createNotFoundError();
    }
    return c.body(stored.body, 200, {
      'Content-Type': stored.contentType ?? file.contentType,
      'Content-Disposition': attachmentDisposition(file.originalFileName),
      'Content-Length': String(stored.size),
      'X-Content-Type-Options': 'nosniff',
    });
  });
}
