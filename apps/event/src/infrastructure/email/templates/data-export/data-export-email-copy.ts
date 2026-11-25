import {
  DATA_EXPORT_REQUEST_LIMIT,
  DATA_EXPORT_REQUEST_WINDOW_SECONDS,
  type DataExportFailureKind,
} from '../../../../../common-lib/data-export/data-export-rules.ts';

const SECONDS_PER_HOUR = 3600;

export const ARCHIVE_READY_SUBJECT = 'データエクスポートの準備ができました';

export const ARCHIVE_FAILED_SUBJECT = 'データエクスポートに失敗しました';

export const ARCHIVE_READY_LEAD =
  'ご要求いただいたデータエクスポートの準備ができました。';

export const ARCHIVE_READY_GUIDE =
  '下のボタンからダウンロードページを開き、ログインしてダウンロードしてください。';

export const DOWNLOAD_PAGE_ACTION_LABEL = 'ダウンロードページを開く';

export const CONTACT_ACTION_LABEL = 'お問い合わせ';

export const EXPORT_PAGE_LINK_LABEL = 'データエクスポートのページを開く';

export const RE_REQUEST_GUIDE = `もう一度要求する場合は、次のページから操作してください。失敗した要求も、${String(DATA_EXPORT_REQUEST_WINDOW_SECONDS / SECONDS_PER_HOUR)}時間に${String(DATA_EXPORT_REQUEST_LIMIT)}回までの要求の回数に含まれます。`;

const FAILURE_LEADS: Readonly<Record<DataExportFailureKind, string>> =
  Object.freeze({
    error:
      'データエクスポートに失敗しました。準備中に問題が発生し、ZIPファイルを作成できませんでした。',
    too_large:
      'データエクスポートに失敗しました。データが大きすぎるため、ZIPファイルを作成できませんでした。',
  });

const FAILURE_CONTACT_GUIDES: Readonly<Record<DataExportFailureKind, string>> =
  Object.freeze({
    error: 'ご不明な点がある場合は、下のボタンからお問い合わせください。',
    too_large: 'お手数ですが、下のボタンからお問い合わせください。',
  });

export function archiveFailedLead(reason: DataExportFailureKind): string {
  return FAILURE_LEADS[reason];
}

export function archiveFailedContactGuide(
  reason: DataExportFailureKind,
): string {
  return FAILURE_CONTACT_GUIDES[reason];
}
