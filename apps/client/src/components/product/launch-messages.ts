// ペアリング済みは予定と同じ「キックオフ予定」、終了は予選の結果(won・lost)で文言を選ぶ
export const LAUNCH_STATUS_LABELS = Object.freeze({
  scheduled: 'キックオフ予定',
  in_progress: '予選マッチ中',
  won: 'ディレクトリ掲載',
  lost: '予選敗北',
  canceled: '取消',
} as const);

export const KICKOFF_PREFIX = 'キックオフ: ';

export const LAUNCH_DATE_PREFIX = 'ローンチ日: ';

export const RELEASE_PREFIX = '解除: ';

export const WATCH_ON_TOP_LABEL = 'トップページで見る';

export const RESERVE_NEXT_LAUNCH_LABEL = '次回のローンチを予約';

export const RESCHEDULE_NOTICE = 'ローンチ日は編集画面で変更できます。';

export const PLAN_UNKNOWN_NOTICE = 'ローンチの状態を確認できませんでした。';

export const EARLIEST_LAUNCH_DATE_NOTICE = Object.freeze({
  before: 'このプロダクトは',
  after: '以降のローンチ日を選べます。',
});
