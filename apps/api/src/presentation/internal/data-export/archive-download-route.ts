import type { Hono } from 'hono';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../../../lib/core/data-export/identifiers.ts';
import type {
  DataExportIncidentReporter,
  DataExportRecord,
  ExportArchiveStorage,
  StoredArchive,
} from '../../../../lib/core/data-export/ports.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { attachmentDisposition } from '../../../../lib/core/media/file-name.ts';
import type { PlatformEnv } from '../../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../../lib/workers/http/hono-env.ts';
import type { ArchiveDownloadService } from '../../../application/data-export/archive-download-service.ts';
import { dataExportArchiveUnavailableError } from '../../../application/data-export/data-export-errors.ts';
import { DATA_EXPORT_TYPES } from '../../../application/data-export/data-export-types.ts';
import {
  createNotFoundError,
  type InternalHonoEnv,
} from '../../gateway/internal-only.ts';
import { readInternalCaller } from '../../gateway/internal-request.ts';

const ARCHIVE_DOWNLOAD_ROUTE_PATH = '/data-exports/:exportId/archive';

const ARCHIVE_CONTENT_TYPE = 'application/zip';

type RequestContainer = PlatformHonoEnv<PlatformEnv>['Variables']['container'];

const logger = getAppLogger(['api', 'presentation', 'data-export']);

async function openArchive(
  storage: ExportArchiveStorage,
  exportId: string,
  objectKey: string,
): Promise<StoredArchive | undefined> {
  try {
    return await storage.open(objectKey);
  } catch (error) {
    logger.warn('データエクスポートの保存先を読めませんでした', {
      exportId,
      error,
    });
    throw dataExportArchiveUnavailableError();
  }
}

// 保存時のメタデータが欠けていても、ZIPの添付として受け取らせる
function responseHeadersOf(
  archive: StoredArchive,
  fileName: string | null,
): Record<string, string> {
  const { contentType, contentDisposition, cacheControl } = archive.meta;
  return {
    'Content-Type': contentType ?? ARCHIVE_CONTENT_TYPE,
    'Content-Disposition':
      contentDisposition ?? attachmentDisposition(fileName ?? 'export.zip'),
    'Content-Length': String(archive.size),
    'X-Content-Type-Options': 'nosniff',
    ...(cacheControl === undefined ? {} : { 'Cache-Control': cacheControl }),
  };
}

async function openRecordArchive(
  container: RequestContainer,
  record: DataExportRecord,
): Promise<StoredArchive> {
  const archive =
    record.objectKey === null
      ? undefined
      : await openArchive(
          container.get<ExportArchiveStorage>(
            DATA_EXPORT_PLATFORM_TYPES.ExportArchiveStorage,
          ),
          record.id,
          record.objectKey,
        );
  if (archive === undefined) {
    container
      .get<DataExportIncidentReporter>(
        DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter,
      )
      .report({ kind: 'archive-missing', exportId: record.id });
    throw createNotFoundError();
  }
  return archive;
}

// 本人の期限内の完了以外は、記録の状態・他の利用者のID・オブジェクトの欠落を区別させず同じ404にする
export function registerArchiveDownloadRoutes<E extends PlatformEnv>(
  app: Hono<InternalHonoEnv<E>>,
): void {
  app.get(ARCHIVE_DOWNLOAD_ROUTE_PATH, async (c) => {
    if (readInternalCaller(c.req.raw) !== 'client') {
      throw createNotFoundError();
    }
    const container = c.get('container');
    const record = await container
      .get<ArchiveDownloadService>(DATA_EXPORT_TYPES.ArchiveDownloadService)
      .authorize(c.var.session, c.req.param('exportId'));
    const archive = await openRecordArchive(container, record);
    return c.body(
      archive.body,
      200,
      responseHeadersOf(archive, record.fileName),
    );
  });
}
