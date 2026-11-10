import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

const MILLISECONDS_PER_SECOND = 1000;

export const AUTO_REFRESH_LABEL = '自動更新';

export const AUTO_REFRESH_DESCRIPTION = `オンの間は${countFormat.format(LIVE_REFRESH_INTERVAL_MS / MILLISECONDS_PER_SECOND)}秒ごとにUpvote数を取り直し、残り時間と演出を動かします。`;

export const GUEST_HERO_TITLE =
  '1対1のマッチでローンチ。必ず半分は勝者になる。';

export const GUEST_HERO_DESCRIPTION =
  '同じカテゴリのプロダクトと1日限りの対戦。サポーターのUpvoteで勝てばディレクトリに掲載され、Product of the Weekへの道が開きます。';

export const GUEST_HERO_REGISTER_LABEL = '登録してローンチする';
