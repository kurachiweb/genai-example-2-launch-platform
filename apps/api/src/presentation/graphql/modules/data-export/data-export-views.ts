import {
  type DataExportDisplayStatus,
  type DataExportFailureKind,
  toDisplayStatus,
} from '../../../../../common-lib/data-export/data-export-rules.ts';
import type { DataExportView } from '../../../../application/data-export/data-export-view.ts';
import type {
  DataExport,
  DataExportFailureKind as DataExportFailureKindValue,
  DataExportStatus,
} from '../../generated/resolvers-types.ts';

const STATUS_VALUES = Object.freeze({
  pending: 'PENDING',
  ready: 'READY',
  expired: 'EXPIRED',
  failed: 'FAILED',
} as const satisfies Record<DataExportDisplayStatus, DataExportStatus>);

const FAILURE_KIND_VALUES = Object.freeze({
  error: 'ERROR',
  too_large: 'TOO_LARGE',
} as const satisfies Record<DataExportFailureKind, DataExportFailureKindValue>);

// 完了のまま有効期限を過ぎた記録は、日次のジョブが期限切れへ変えるまでの間もダウンロードできないため、期限切れと示す。
// ダウンロードのパスを付ける判定と同じ時刻で揃えるため、パスの有無から判定する
function displayStatusOf({
  record,
  downloadPath,
}: DataExportView): DataExportStatus {
  if (record.status === 'ready' && downloadPath === null) {
    return STATUS_VALUES.expired;
  }
  return STATUS_VALUES[toDisplayStatus(record.status)];
}

export function toDataExport(view: DataExportView): DataExport {
  const { record, downloadPath } = view;
  return {
    id: record.id,
    status: displayStatusOf(view),
    requestedAt: record.requestedAt,
    completedAt: record.completedAt,
    expiresAt: record.expiresAt,
    failedAt: record.failedAt,
    failureKind:
      record.failureKind === null
        ? null
        : FAILURE_KIND_VALUES[record.failureKind],
    fileName: record.fileName,
    byteSize: record.byteSize,
    downloadPath,
  };
}
