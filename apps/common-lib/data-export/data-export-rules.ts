export const DATA_EXPORT_STATUSES = Object.freeze([
  'queued',
  'generating',
  'ready',
  'expired',
  'failed',
] as const);

export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

export const DATA_EXPORT_FAILURE_KINDS = Object.freeze([
  'error',
  'too_large',
] as const);

export type DataExportFailureKind = (typeof DATA_EXPORT_FAILURE_KINDS)[number];

export type DataExportDisplayStatus =
  'pending' | 'ready' | 'expired' | 'failed';

const DISPLAY_STATUS_OF: Readonly<
  Record<DataExportStatus, DataExportDisplayStatus>
> = Object.freeze({
  queued: 'pending',
  generating: 'pending',
  ready: 'ready',
  expired: 'expired',
  failed: 'failed',
});

export const toDisplayStatus = (
  status: DataExportStatus,
): DataExportDisplayStatus => DISPLAY_STATUS_OF[status];

export const DATA_EXPORT_DISPLAY_STATUS_LABELS: Readonly<
  Record<DataExportDisplayStatus, string>
> = Object.freeze({
  pending: '作成中',
  ready: '完了',
  expired: '期限切れ',
  failed: '失敗',
});

export const DATA_EXPORT_REQUEST_LIMIT = 3;

export const DATA_EXPORT_REQUEST_WINDOW_SECONDS = 86_400;

export const DATA_EXPORT_RETENTION_DAYS = 7;

export const DATA_EXPORT_LIST_PAGE_SIZE = 20;

export const DATA_EXPORT_DOWNLOAD_PREFIX = '/_bff/exports/';

export const dataExportDownloadPathOf = (exportId: string): string =>
  `${DATA_EXPORT_DOWNLOAD_PREFIX}${encodeURIComponent(exportId)}`;
