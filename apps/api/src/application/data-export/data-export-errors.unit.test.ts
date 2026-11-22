import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import {
  dataExportArchiveUnavailableError,
  dataExportNotFoundError,
  dataExportUnavailableError,
} from './data-export-errors.ts';

describe('データエクスポートの想定内の失敗', () => {
  test('要求を受け付けられない失敗は503のコードdata_export_unavailableで、再試行の秒数を持たない', () => {
    const error = dataExportUnavailableError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe('unavailable');
    expect(error.code).toBe('data_export_unavailable');
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  test('見つからない失敗は存在を明かさず、未登録の経路と同じ定型のコードと文言になる', () => {
    const error = dataExportNotFoundError();

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(NOT_FOUND_RESPONSE.body.error.code);
    expect(error.message).toBe(NOT_FOUND_RESPONSE.body.error.message);
  });

  test('ファイルを取得できない失敗は503のコードdata_export_archive_unavailableで、5秒後の再試行を示す', () => {
    const error = dataExportArchiveUnavailableError();

    expect(error.kind).toBe('unavailable');
    expect(error.code).toBe('data_export_archive_unavailable');
    expect(error.retryAfterSeconds).toBe(5);
  });
});
