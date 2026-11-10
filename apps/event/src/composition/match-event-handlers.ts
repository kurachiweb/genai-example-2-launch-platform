import type { MatchEventRegistration } from '../../lib/core/match/match-events.ts';

// マッチの予定の作成・開始・結果の確定の後にイベントサーバーで自分のデータを変える機能が、登録をここへ追記する。
// orderは機能ごとに割り当てた帯を使い、kindsを省いた登録は全ての種別のマッチで動く
export const MATCH_EVENT_HANDLERS: readonly MatchEventRegistration[] =
  Object.freeze([]);
