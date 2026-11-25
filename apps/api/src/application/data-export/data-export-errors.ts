import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';

export const dataExportUnavailableError = (): AppError =>
  new AppError({
    kind: 'unavailable',
    code: 'data_export_unavailable',
    message: '要求を受け付けられませんでした。時間をおいて再度お試しください。',
  });

const ARCHIVE_RETRY_AFTER_SECONDS = 5;

// 見つからない理由を応答から推測されないよう、未登録の経路と同じ定型の形にする
export const dataExportNotFoundError = (): AppError =>
  new AppError({
    kind: 'not_found',
    code: NOT_FOUND_RESPONSE.body.error.code,
    message: NOT_FOUND_RESPONSE.body.error.message,
  });

export const dataExportArchiveUnavailableError = (): AppError =>
  new AppError({
    kind: 'unavailable',
    code: 'data_export_archive_unavailable',
    message: 'ファイルを取得できませんでした。時間をおいて再度お試しください。',
    retryAfterSeconds: ARCHIVE_RETRY_AFTER_SECONDS,
  });
