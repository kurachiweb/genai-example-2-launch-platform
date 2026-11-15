// 見出しの印は翻訳しない
export const LIVE_MATCH_BADGE = 'LIVE';

// 種別の印は対戦カードと同じmatchStageLabelの文字列を受ける
export const liveMatchTitle = (stageLabel: string): string =>
  `${stageLabel}を戦っています`;

export const LIVE_MATCH_OWNER_DESCRIPTION =
  'サポーターの応援が集まっています。';

export const LIVE_MATCH_VIEWER_DESCRIPTION = 'Upvoteで応援しましょう！';
