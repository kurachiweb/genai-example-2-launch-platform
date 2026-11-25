import type { ResultNoticeSupplementRegistration } from '../../lib/core/notifications/result-notice-supplements.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from '../application/year-tournament/event-year-tournament-types.ts';

// 勝敗結果の通知に追記を加える機能が、登録をここへ追記する。nameは'<spec名>.<名詞句>'、orderは同じ種別の中で重複させない
export const RESULT_NOTICE_SUPPLEMENTS: readonly ResultNoticeSupplementRegistration[] =
  Object.freeze([
    {
      name: 'tournament-week.entry-deadline',
      kinds: ['qualifier'],
      order: 1500,
      provider: EVENT_WEEK_TOURNAMENT_TYPES.WeekEntrySupplementProvider,
    },
    {
      name: 'tournament-year.entry-deadline',
      kinds: ['week'],
      order: 1700,
      provider: EVENT_YEAR_TOURNAMENT_TYPES.YearEntrySupplementProvider,
    },
  ]);
