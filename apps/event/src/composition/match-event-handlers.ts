import type { MatchEventRegistration } from '../../lib/core/match/match-events.ts';
import { EVENT_DIRECTORY_TYPES } from '../application/directory/event-directory-types.ts';
import { EVENT_MATCH_TYPES } from '../application/match/event-match-types.ts';

// マッチの予定の作成・開始・結果の確定の後にイベントサーバーで自分のデータを変える機能が、登録をここへ追記する。
// orderは機能ごとに割り当てた帯を使い、kindsを省いた登録は全ての種別のマッチで動く
export const MATCH_EVENT_HANDLERS: readonly MatchEventRegistration[] =
  Object.freeze([
    {
      name: 'match-engine.qualifier-outcome',
      events: ['decided'],
      kinds: ['qualifier'],
      order: 1100,
      handler: EVENT_MATCH_TYPES.QualifierOutcomeHandler,
    },
    {
      name: 'directory-discovery.qualifier-listing',
      events: ['decided'],
      kinds: ['qualifier'],
      order: 1200,
      handler: EVENT_DIRECTORY_TYPES.QualifierListingHandler,
    },
  ]);
