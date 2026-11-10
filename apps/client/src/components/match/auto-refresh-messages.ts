import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

const MILLISECONDS_PER_SECOND = 1000;

export const AUTO_REFRESH_LABEL = '自動更新';

export const AUTO_REFRESH_DESCRIPTION = `オンの間は${countFormat.format(LIVE_REFRESH_INTERVAL_MS / MILLISECONDS_PER_SECOND)}秒ごとにUpvote数を取り直し、残り時間と演出を動かします。`;
