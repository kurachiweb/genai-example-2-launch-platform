import type {
  DecisionSourceRegistration,
  LaunchSummarySource,
  ProductLockSource,
  RelaunchConditionSource,
} from '../application/product/decision-sources.ts';

// 次回のローンチの予約を禁止する条件を加える機能が、登録をここへ追記する
export const RELAUNCH_CONDITION_SOURCES: readonly DecisionSourceRegistration<RelaunchConditionSource>[] =
  [];

// ローンチ日・カテゴリの変更と削除を固定する条件を加える機能が、登録をここへ追記する
export const PRODUCT_LOCK_SOURCES: readonly DecisionSourceRegistration<ProductLockSource>[] =
  [];

// ローンチ履歴の結果の要約と受賞を加える機能が、登録をここへ追記する
export const LAUNCH_SUMMARY_SOURCES: readonly DecisionSourceRegistration<LaunchSummarySource>[] =
  [];
