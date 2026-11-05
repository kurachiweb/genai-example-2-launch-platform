import { LIVE_REFRESH_INTERVAL_MS } from '../query/live-refresh.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

const MILLISECONDS_PER_SECOND = 1000;

export const INQUIRY_ATTACHMENTS_LABEL = '添付ファイル';

export const INQUIRY_AUTO_REFRESH_LABEL = '自動更新';

export const INQUIRY_AUTO_REFRESH_DESCRIPTION = `オンの間は${countFormat.format(LIVE_REFRESH_INTERVAL_MS / MILLISECONDS_PER_SECOND)}秒ごとに新しいメッセージと対応ステータスを表示します。`;
