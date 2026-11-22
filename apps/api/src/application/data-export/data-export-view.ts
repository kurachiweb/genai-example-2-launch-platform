import { dataExportDownloadPathOf } from '../../../common-lib/data-export/data-export-rules.ts';
import type { DataExportRecord } from '../../../lib/core/data-export/ports.ts';

export interface DataExportView {
  readonly record: DataExportRecord;
  // 完了で有効期限の前のときだけ持つ
  readonly downloadPath: string | null;
}

export function toDataExportView(
  record: DataExportRecord,
  now: Date,
): DataExportView {
  const downloadable =
    record.status === 'ready' &&
    record.expiresAt !== null &&
    record.expiresAt.getTime() > now.getTime();
  return {
    record,
    downloadPath: downloadable ? dataExportDownloadPathOf(record.id) : null,
  };
}
