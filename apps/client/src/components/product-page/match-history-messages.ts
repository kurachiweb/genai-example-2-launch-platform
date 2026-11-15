export const MATCH_HISTORY_TITLE = 'マッチ履歴とコメント';

// ディレクトリの一覧の項目のコメント数のリンクが移動する先
export const MATCH_HISTORY_HEADING_ID = 'launches-heading';

// 開催中のマッチの区画の見出しのid
export const LIVE_MATCH_HEADING_ID = 'live-match-heading';

// 数は表示設定で整えた文字列を受ける
export const matchHistoryCountLabel = (
  launchCount: string,
  matchCount: string,
): string => `${launchCount}ローンチ・${matchCount}マッチ`;

export const launchBlockTitle = (number: number): string =>
  `第${number.toString()}回ローンチ`;

export const launchMatchesLabel = (number: number): string =>
  `${launchBlockTitle(number)}のマッチ`;

export const LIVE_QUALIFIER_NOTICE =
  '予選マッチが行われています。勝敗はフルタイム後にここへ表示されます。';

export const WATCH_LIVE_MATCH_LABEL = 'マッチを見る';

export const KICKOFF_SUFFIX = 'にキックオフします。';

export const OWNER_KICKOFF_NOTE =
  '当日はトップページで対戦が始まります。リンクを共有して応援を呼びかけましょう。';

export const GUEST_KICKOFF_NOTE =
  'まだ終了したマッチはありません。当日はトップページで対戦が始まります。';

export const SHARE_LINK_LABEL = 'リンクをコピーして応援を呼びかける';

export const WATCH_TODAY_ON_TOP_LABEL = 'トップページで本日のマッチを見る';

export const VERSUS_MARK = 'vs';

export const OPPONENT_PREFIX = '対戦相手:';

export const NO_OPPONENT_LABEL = '対戦相手なし';

// 数は表示設定で整えた文字列を受ける。自分の数を先にする
export const scoreLabel = (own: string, opponent: string): string =>
  `${own}対${opponent}`;

export const voteRatioLabel = (own: string, opponent: string): string =>
  `Upvote数の比率: ${scoreLabel(own, opponent)}`;

export const OUTCOME_LABELS = Object.freeze({
  won: '勝利',
  bye: '不戦勝',
  early: '不戦勝',
  lost: '敗北',
  'both-lost': '両者敗北',
} as const);

export const CLOSE_MATCH_LABEL = '接戦';

export const CLOSE_WIN_NOTE = '同点・最終Upvote時間が早く勝利';

export const CLOSE_LOSS_NOTE = '同点・最終Upvote時間の差で敗北';

export const supportersToggleLabel = (count: string): string =>
  `サポーター${count}人`;
