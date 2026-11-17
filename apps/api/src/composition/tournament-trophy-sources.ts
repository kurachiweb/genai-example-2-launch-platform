import type { TrophySourceRegistration } from '../application/tournament/trophy-source.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../application/week-tournament/week-tournament-api-types.ts';

// プロダクト詳細のトロフィーの区画に受賞を加える機能が、登録をここへ追記する
export const TOURNAMENT_TROPHY_SOURCES: readonly TrophySourceRegistration[] = [
  {
    name: 'tournament-week.week-trophies',
    order: 20,
    source: WEEK_TOURNAMENT_API_TYPES.WeekTrophySource,
  },
];
