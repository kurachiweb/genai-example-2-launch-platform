import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';

const MILLISECONDS_PER_SECOND = 1000;

export const DATA_EXPORT_PAGE_TITLE = 'データエクスポート';

export const DATA_EXPORT_REQUESTED_AT_LABEL = '要求日時';

export const DATA_EXPORT_COMPLETED_AT_LABEL = '完了日時';

export const DATA_EXPORT_EXPIRES_AT_LABEL = '有効期限';

export const DATA_EXPORT_FILE_NAME_LABEL = 'ファイル名';

export const DATA_EXPORT_SIZE_LABEL = '大きさ';

export const DATA_EXPORT_FAILED_AT_LABEL = '失敗日時';

export const DATA_EXPORT_DOWNLOAD_UNTIL_SUFFIX = 'までダウンロードできます';

export const dataExportDownloadLabel = (sizeLabel: string | null): string =>
  sizeLabel === null ? 'ダウンロード' : `ダウンロード(${sizeLabel})`;

export const DATA_EXPORT_EXPIRED_MESSAGE =
  '有効期限を過ぎたため削除しました。必要な場合はもう一度要求してください。';

export const DATA_EXPORT_FAILED_MESSAGE =
  'エクスポートに失敗しました。もう一度要求してください。';

export const DATA_EXPORT_TOO_LARGE_MESSAGE =
  'データが大きすぎるためエクスポートできませんでした。';

export const DATA_EXPORT_CONTACT_LINK_LABEL = 'お問い合わせ';

export const DATA_EXPORT_CONTACT_REQUEST_SUFFIX = 'ください。';

export const DATA_EXPORT_EMPTY_MESSAGE = 'まだエクスポートを要求していません。';

export const DATA_EXPORT_LOAD_ERROR_MESSAGE =
  'エクスポートの一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

export const DATA_EXPORT_LOAD_MORE_LABEL = 'さらに表示';

export const DATA_EXPORT_LOADING_MORE_LABEL = '読み込み中';

export const DATA_EXPORT_AUTO_REFRESH_DESCRIPTION = `オンの間は${String(LIVE_REFRESH_INTERVAL_MS / MILLISECONDS_PER_SECOND)}秒ごとに一覧を取り直し、作成中の要求の状態を反映します。`;
