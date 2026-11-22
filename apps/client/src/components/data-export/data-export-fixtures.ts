import { dataExportDownloadPathOf } from '../../../common-lib/data-export/data-export-rules.ts';
import type { DataExportFieldsFragment } from '../../graphql/generated/graphql.ts';

export const EXPORT_REQUESTED_AT = '2026-09-15T07:40:00.000Z';

export const EXPORT_COMPLETED_AT = '2026-09-15T07:55:00.000Z';

export const EXPORT_EXPIRES_AT = '2026-09-22T07:55:00.000Z';

export const EXPORT_FAILED_AT = '2026-09-15T08:10:00.000Z';

// 閲覧者のタイムゾーンをAsia/Tokyo・ロケールをja-JPにした時の表示
export const EXPORT_REQUESTED_AT_TEXT = '2026年9月15日(火) 16:40';

export const EXPORT_COMPLETED_AT_TEXT = '2026年9月15日(火) 16:55';

export const EXPORT_EXPIRES_AT_TEXT = '2026年9月22日(火) 16:55';

export const EXPORT_FAILED_AT_TEXT = '2026年9月15日(火) 17:10';

export const EXPORT_FILE_NAME = 'launch-stadium-export-20260915.zip';

export const EXPORT_BYTE_SIZE = 1_572_864;

export const EXPORT_SIZE_TEXT = '1.5MB';

const ULID_PREFIX = '01JD0EXP0RT0000000000000';

export const dataExportIdOf = (index: number): string =>
  `${ULID_PREFIX}${String(index).padStart(2, '0')}`;

const baseExportOf = (
  index: number,
  overrides: Partial<DataExportFieldsFragment>,
): DataExportFieldsFragment => ({
  id: dataExportIdOf(index),
  status: 'PENDING',
  failureKind: null,
  requestedAt: EXPORT_REQUESTED_AT,
  completedAt: null,
  expiresAt: null,
  failedAt: null,
  fileName: null,
  byteSize: null,
  downloadPath: null,
  ...overrides,
});

export const pendingExportOf = (
  index: number,
  overrides: Partial<DataExportFieldsFragment> = {},
): DataExportFieldsFragment => baseExportOf(index, overrides);

export const readyExportOf = (
  index: number,
  overrides: Partial<DataExportFieldsFragment> = {},
): DataExportFieldsFragment =>
  baseExportOf(index, {
    status: 'READY',
    completedAt: EXPORT_COMPLETED_AT,
    expiresAt: EXPORT_EXPIRES_AT,
    fileName: EXPORT_FILE_NAME,
    byteSize: EXPORT_BYTE_SIZE,
    downloadPath: dataExportDownloadPathOf(dataExportIdOf(index)),
    ...overrides,
  });

export const expiredExportOf = (
  index: number,
  overrides: Partial<DataExportFieldsFragment> = {},
): DataExportFieldsFragment =>
  baseExportOf(index, {
    status: 'EXPIRED',
    completedAt: EXPORT_COMPLETED_AT,
    expiresAt: EXPORT_EXPIRES_AT,
    fileName: EXPORT_FILE_NAME,
    byteSize: EXPORT_BYTE_SIZE,
    ...overrides,
  });

export const failedExportOf = (
  index: number,
  failureKind: DataExportFieldsFragment['failureKind'] = 'ERROR',
  overrides: Partial<DataExportFieldsFragment> = {},
): DataExportFieldsFragment =>
  baseExportOf(index, {
    status: 'FAILED',
    failureKind,
    failedAt: EXPORT_FAILED_AT,
    ...overrides,
  });
