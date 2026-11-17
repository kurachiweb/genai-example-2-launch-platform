import type {
  DecisionSourceRegistration,
  LaunchSummarySource,
  ProductLockSource,
  RelaunchConditionSource,
} from '../application/product/decision-sources.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../application/week-tournament/week-tournament-api-types.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../application/year-tournament/year-tournament-api-types.ts';

// 次回のローンチの予約を禁止する条件を加える機能が、登録をここへ追記する
export const RELAUNCH_CONDITION_SOURCES: readonly DecisionSourceRegistration<RelaunchConditionSource>[] =
  [
    {
      name: 'tournament-week.result-pending',
      order: 1500,
      source: WEEK_TOURNAMENT_API_TYPES.WeekRelaunchConditionSource,
    },
    {
      name: 'tournament-year.result-pending',
      order: 1700,
      source: YEAR_TOURNAMENT_API_TYPES.YearRelaunchConditionSource,
    },
  ];

// ローンチ日・カテゴリの変更と削除を固定する条件を加える機能が、登録をここへ追記する
export const PRODUCT_LOCK_SOURCES: readonly DecisionSourceRegistration<ProductLockSource>[] =
  [
    {
      name: 'tournament-week.bracket-lock',
      order: 1500,
      source: WEEK_TOURNAMENT_API_TYPES.WeekProductLockSource,
    },
    {
      name: 'tournament-year.bracket-lock',
      order: 1700,
      source: YEAR_TOURNAMENT_API_TYPES.YearProductLockSource,
    },
  ];

// ローンチ履歴の結果の要約と受賞を加える機能が、登録をここへ追記する
export const LAUNCH_SUMMARY_SOURCES: readonly DecisionSourceRegistration<LaunchSummarySource>[] =
  [
    {
      name: 'tournament-week.launch-summary',
      order: 1500,
      source: WEEK_TOURNAMENT_API_TYPES.WeekLaunchSummarySource,
    },
    {
      name: 'tournament-year.launch-summary',
      order: 1700,
      source: YEAR_TOURNAMENT_API_TYPES.YearLaunchSummarySource,
    },
  ];
